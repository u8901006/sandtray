import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Browser, BrowserContext} from '@playwright/test';

export type StagingProbeConfig = {
  origin: string;
  expectedHost: string;
  /** The complete value is retained only in memory; never print it. */
  sessionCookie: string;
  roomId: string;
  assetId: string;
  assetVersion: string;
};

export const EXPECTED_HTML_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";
export const STAGING_PROBE_MIN_BYTES = 2 * 1024 * 1024;
const REQUIRED_ENV = [
  'STAGING_PROBE_ORIGIN',
  'STAGING_PROBE_EXPECTED_HOST',
  'STAGING_PROBE_SESSION_COOKIE',
  'STAGING_PROBE_ROOM_ID',
  'STAGING_PROBE_ASSET_ID',
  'STAGING_PROBE_ASSET_VERSION',
] as const;

function requireSafeIdentifier(value: string | undefined, name: string): string {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`${name} must match the worker route identifier format (1-128 letters, digits, underscore, or hyphen).`);
  }
  return value;
}

export function loadStagingProbeConfig(env: Record<string, string | undefined>): StagingProbeConfig {
  const missing = REQUIRED_ENV.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required staging probe settings: ${missing.join(', ')}.`);

  const rawOrigin = env.STAGING_PROBE_ORIGIN!;
  const rawExpectedHost = env.STAGING_PROBE_EXPECTED_HOST!;
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error('STAGING_PROBE_ORIGIN must be a bare HTTPS origin.');
  }
  const expectedHost = rawExpectedHost.toLowerCase();
  const hasStageLabel = expectedHost.split('.').some(label => /(^|-)(staging|stage|stg|qa|uat|preprod|preview)(-|$)/.test(label));
  const validHost = expectedHost.length <= 253
    && expectedHost === rawExpectedHost
    && expectedHost.split('.').length >= 2
    && expectedHost.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    && isIP(expectedHost) === 0
    && !/(^|\.)(localhost|local|internal|test)$/.test(expectedHost)
    && hasStageLabel;
  if (!validHost) throw new Error('STAGING_PROBE_EXPECTED_HOST must be the exact expected host DNS name with an explicit staging/test label (staging, stage, stg, qa, uat, preprod, or preview), without a port.');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || rawOrigin !== parsed.origin) {
    throw new Error('STAGING_PROBE_ORIGIN must be a bare HTTPS origin with no credentials, path, query, fragment, or explicit port.');
  }
  if (parsed.hostname !== expectedHost) {
    throw new Error('STAGING_PROBE_ORIGIN does not match the expected host in STAGING_PROBE_EXPECTED_HOST.');
  }

  const cookie = env.STAGING_PROBE_SESSION_COOKIE!;
  if (!/^sandtray_session=[a-f0-9]{64}$/.test(cookie)) {
    throw new Error('STAGING_PROBE_SESSION_COOKIE must contain exactly the current 64-character lowercase-hex sandtray_session token, without attributes.');
  }

  return {
    origin: parsed.origin,
    expectedHost,
    sessionCookie: cookie,
    roomId: requireSafeIdentifier(env.STAGING_PROBE_ROOM_ID, 'STAGING_PROBE_ROOM_ID'),
    assetId: requireSafeIdentifier(env.STAGING_PROBE_ASSET_ID, 'STAGING_PROBE_ASSET_ID'),
    assetVersion: requireSafeIdentifier(env.STAGING_PROBE_ASSET_VERSION, 'STAGING_PROBE_ASSET_VERSION'),
  };
}

export function buildPrivateAssetProbePath(config: StagingProbeConfig): string {
  return `/api/assets/${encodeURIComponent(config.assetId)}/${encodeURIComponent(config.assetVersion)}/model.glb?roomId=${encodeURIComponent(config.roomId)}`;
}

export function formatProbeStart(config: StagingProbeConfig, startedAt = new Date()): string {
	return `L04 staging browser probe START at=${startedAt.toISOString()} origin=${config.origin} host=${config.expectedHost} asset=${config.assetId} version=${config.assetVersion}`;
}

function normalizedHeaderName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedPolicy(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function inspectProbeHeaders(headers: Record<string, string>, kind: 'document' | 'health' | 'asset'): {ok: boolean; issues: string[]} {
  const entries = Object.entries(headers);
  const issues: string[] = [];
  if (entries.some(([name, value]) => /adguard/i.test(`${name} ${value}`))) issues.push('AdGuard fingerprint detected');
  if (entries.some(([name]) => /^permissions-policy(?:-report-only)?$/i.test(name.trim()))) issues.push('unexpected Permissions-Policy header');

  const cspEntries = entries.filter(([name]) => /^content-security-policy(?:-.+)?$/i.test(normalizedHeaderName(name)));
  if (kind === 'document') {
    const enforced = cspEntries.filter(([name]) => normalizedHeaderName(name) === 'content-security-policy');
    if (enforced.length !== 1 || normalizedPolicy(enforced[0]?.[1] ?? '') !== normalizedPolicy(EXPECTED_HTML_CSP)) {
      issues.push('document CSP does not match the deployed baseline');
    }
    if (cspEntries.some(([name]) => normalizedHeaderName(name) !== 'content-security-policy')) {
      issues.push('unexpected additional CSP header');
    }
  } else if (cspEntries.length) {
    issues.push(`unexpected CSP header on ${kind} response`);
  }
  return {ok: issues.length === 0, issues};
}

export function assertStagingHealth(status: number, body: unknown): void {
  if (status !== 200 || !body || typeof body !== 'object' || (body as {mode?: unknown}).mode !== 'staging') {
    throw new Error('staging health gate requires HTTP 200 and mode=staging.');
  }
}

export async function installSessionCookieAfterStagingHealth(
  context: {addCookies(cookies: Array<{name: string; value: string; url: string; httpOnly: boolean; secure: boolean; sameSite: 'Lax'}>): Promise<void>},
  config: StagingProbeConfig,
  status: number,
  body: unknown,
): Promise<void> {
  assertStagingHealth(status, body);
  const value = config.sessionCookie.slice('sandtray_session='.length);
  await context.addCookies([{name: 'sandtray_session', value, url: config.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
}

class ProbeBlockedError extends Error {}
class ProbeTimeoutError extends Error {}

function ensureCleanResponseHeaders(headers: Record<string, string>, kind: 'document' | 'health' | 'asset'): void {
  const result = inspectProbeHeaders(headers, kind);
  if (!result.ok) throw new ProbeBlockedError(`${kind} response headers blocked: ${result.issues.join('; ')}.`);
}

function ensureSameOriginUrl(url: string, origin: string, kind: string): void {
  let responseOrigin = '';
  try {
    responseOrigin = new URL(url).origin;
  } catch {
    // Keep the error generic; response URLs are not emitted into logs.
  }
  if (responseOrigin !== origin) throw new ProbeBlockedError(`${kind} response did not remain on the confirmed staging origin.`);
}

function ensureSameOriginResponse(response: {url(): string}, origin: string, kind: string): void {
  ensureSameOriginUrl(response.url(), origin, kind);
}

type RequestFenceState = {crossOriginBlocked: boolean};

async function installSameOriginRequestFence(
  context: BrowserContext,
  origin: string,
  emit: (line: string) => void,
): Promise<RequestFenceState> {
  const state: RequestFenceState = {crossOriginBlocked: false};
  await context.route('**/*', async route => {
    let requestOrigin = '';
    try {
      requestOrigin = new URL(route.request().url()).origin;
    } catch {
      // Non-HTTP URLs are blocked as non-same-origin without logging their value.
    }
    if (requestOrigin !== origin) {
      state.crossOriginBlocked = true;
      emit('CROSS_ORIGIN_REQUEST_BLOCKED=true');
      await route.abort();
      return;
    }
    await route.fallback();
  });
  return state;
}

function ensureNoCrossOriginRequest(state: RequestFenceState): void {
  if (state.crossOriginBlocked) {
    throw new ProbeBlockedError('browser attempted a cross-origin request; it was blocked before network dispatch.');
  }
}

export async function runStagingProbeSession(
  config: StagingProbeConfig,
  browser: Pick<Browser, 'newContext'>,
  emit: (line: string) => void = line => console.log(line),
): Promise<void> {
  const injectedConsoleSignal = {detected: false};
  const ensureNoConsoleInjection = () => {
    if (injectedConsoleSignal.detected) {
      throw new ProbeBlockedError('browser console reported an AdGuard or Permissions-Policy injection signal.');
    }
  };
  const attachInjectionWatch = (page: {on(event: 'console', callback: (message: {text(): string}) => void): void}) => {
    page.on('console', message => {
      if (/adguard|permissions-policy/i.test(message.text())) injectedConsoleSignal.detected = true;
    });
  };

  const documentContext = await browser.newContext({javaScriptEnabled: false, serviceWorkers: 'block'});
  try {
    const requestFence = await installSameOriginRequestFence(documentContext, config.origin, emit);
    const page = await documentContext.newPage();
    attachInjectionWatch(page);
    let response;
    try {
      response = await page.goto(`${config.origin}/`, {waitUntil: 'domcontentloaded', timeout: 20_000});
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw error;
      throw new ProbeBlockedError('staging document request failed before an HTTP response.');
    }
    ensureNoCrossOriginRequest(requestFence);
    if (!response || response.status() !== 200) throw new ProbeBlockedError('staging document did not return HTTP 200.');
    ensureSameOriginResponse(response, config.origin, 'document');
    ensureCleanResponseHeaders(await response.allHeaders(), 'document');
    emit('DOCUMENT_CHECK=PASS csp=deployed-baseline injected-headers=none');
  } finally {
    await documentContext.close();
  }

  const context = await browser.newContext({javaScriptEnabled: true, serviceWorkers: 'block'});
  let allAssetsVerified = false;
  try {
    const requestFence = await installSameOriginRequestFence(context, config.origin, emit);
    const page = await context.newPage();
    attachInjectionWatch(page);
    let documentResponse;
    try {
      documentResponse = await page.goto(`${config.origin}/`, {waitUntil: 'domcontentloaded', timeout: 20_000});
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw error;
      throw new ProbeBlockedError('staging document request failed before an HTTP response.');
    }
    ensureNoCrossOriginRequest(requestFence);
    if (!documentResponse || documentResponse.status() !== 200) throw new ProbeBlockedError('staging document did not return HTTP 200 in the health-check context.');
    ensureSameOriginResponse(documentResponse, config.origin, 'document');
    ensureCleanResponseHeaders(await documentResponse.allHeaders(), 'document');
    ensureNoConsoleInjection();

    let healthResponse;
    try {
      healthResponse = await page.evaluate(async () => {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
        let body: unknown;
        try { body = await response.json(); } catch { body = null; }
        return {status: response.status, url: response.url, headers: Object.fromEntries(response.headers.entries()), body};
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw error;
      throw new ProbeBlockedError('staging health request failed before a complete browser response.');
    }
    ensureNoCrossOriginRequest(requestFence);
    ensureSameOriginUrl(healthResponse.url, config.origin, 'health');
    ensureCleanResponseHeaders(healthResponse.headers, 'health');
    ensureNoConsoleInjection();
    assertStagingHealth(healthResponse.status, healthResponse.body);
    await installSessionCookieAfterStagingHealth(context, config, healthResponse.status, healthResponse.body);
    ensureNoConsoleInjection();
    ensureNoCrossOriginRequest(requestFence);
    emit('STAGING_HEALTH_CHECK=PASS status=200 mode=staging session-cookie-installed-after-gate=true');

    const assetPath = buildPrivateAssetProbePath(config);
    let expectedAssetBytes: number | undefined;
    let expectedAssetSha256: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      ensureNoConsoleInjection();
      ensureNoCrossOriginRequest(requestFence);
      let result;
      try {
        result = await page.evaluate(async path => {
          const response = await fetch(path, {
            cache: 'no-store',
            credentials: 'same-origin',
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
          });
          const headers = Object.fromEntries(response.headers.entries());
          const body = await response.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', body);
          const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

          let glbContainerAndBuffersValid = false;
          if (body.byteLength >= 20 && body.byteLength % 4 === 0) {
            const view = new DataView(body);
            const magic = view.getUint32(0, true);
            const version = view.getUint32(4, true);
            const declaredLength = view.getUint32(8, true);
            let offset = 12;
            let chunkIndex = 0;
            let jsonAssetVersion: unknown;
            let glbBufferByteLength: number | undefined;
            let binChunkByteLength: number | undefined;
            let binChunkDataStart: number | undefined;
            let chunksValid = true;

            while (offset < body.byteLength) {
              if (offset + 8 > body.byteLength) { chunksValid = false; break; }
              const chunkLength = view.getUint32(offset, true);
              const chunkType = view.getUint32(offset + 4, true);
              const chunkDataStart = offset + 8;
              const chunkDataEnd = chunkDataStart + chunkLength;
              if (chunkLength % 4 !== 0 || chunkDataEnd > body.byteLength) { chunksValid = false; break; }
              if (chunkIndex === 0) {
                if (chunkType !== 0x4e4f534a) { chunksValid = false; break; }
                try {
                  const jsonText = new TextDecoder('utf-8', {fatal: true}).decode(body.slice(chunkDataStart, chunkDataEnd));
                  const json = JSON.parse(jsonText) as {asset?: {version?: unknown}; buffers?: unknown};
                  jsonAssetVersion = json.asset?.version;
                  if (json.buffers !== undefined) {
                    if (!Array.isArray(json.buffers) || json.buffers.length < 1) {
                      chunksValid = false;
                      break;
                    }
                    for (let bufferIndex = 0; bufferIndex < json.buffers.length; bufferIndex++) {
                      const bufferValue = json.buffers[bufferIndex];
                      if (!bufferValue || typeof bufferValue !== 'object' || Array.isArray(bufferValue)) {
                        chunksValid = false;
                        break;
                      }
                      const buffer = bufferValue as {byteLength?: unknown; uri?: unknown};
                      if (!Number.isSafeInteger(buffer.byteLength) || (buffer.byteLength as number) <= 0
                          || (buffer.uri !== undefined && (typeof buffer.uri !== 'string' || buffer.uri.length === 0))) {
                        chunksValid = false;
                        break;
                      }
                      if (bufferIndex === 0 && buffer.uri === undefined) {
                        glbBufferByteLength = buffer.byteLength as number;
                      }
                    }
                  }
                } catch {
                  chunksValid = false;
                  break;
                }
              } else if (chunkType === 0x4e4f534a || (chunkType === 0x004e4942 && chunkIndex !== 1)) {
                  chunksValid = false;
                  break;
              } else if (chunkType === 0x004e4942) {
                binChunkByteLength = chunkLength;
                binChunkDataStart = chunkDataStart;
              }
              offset = chunkDataEnd;
              chunkIndex += 1;
            }
            let bufferReferenceValid = true;
            if (glbBufferByteLength !== undefined) {
              if (binChunkByteLength === undefined || binChunkDataStart === undefined
                  || binChunkByteLength < glbBufferByteLength || binChunkByteLength - glbBufferByteLength > 3) {
                bufferReferenceValid = false;
              } else {
                for (let paddingOffset = glbBufferByteLength; paddingOffset < binChunkByteLength; paddingOffset++) {
                  if (view.getUint8(binChunkDataStart + paddingOffset) !== 0) {
                    bufferReferenceValid = false;
                    break;
                  }
                }
              }
            }
            glbContainerAndBuffersValid = magic === 0x46546c67 && version === 2 && declaredLength === body.byteLength
              && chunkIndex >= 1 && chunksValid && offset === body.byteLength
              && bufferReferenceValid && typeof jsonAssetVersion === 'string' && /^2\.\d+$/.test(jsonAssetVersion);
          }
          return {status: response.status, headers, bytes: body.byteLength, url: response.url, sha256, glbContainerAndBuffersValid};
        }, assetPath);
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') throw error;
        throw new ProbeBlockedError(`private GLB attempt ${attempt} failed before a complete browser response.`);
      }
      ensureNoConsoleInjection();
      ensureNoCrossOriginRequest(requestFence);
      if (new URL(result.url).origin !== config.origin) throw new ProbeBlockedError(`private GLB attempt ${attempt} left the confirmed staging origin.`);
      ensureCleanResponseHeaders(result.headers, 'asset');
      const contentLength = Number(result.headers['content-length']);
      const contentType = (result.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
      if (result.status !== 200 || contentType !== 'model/gltf-binary' || !Number.isSafeInteger(contentLength)
          || contentLength < STAGING_PROBE_MIN_BYTES || result.bytes !== contentLength) {
        throw new ProbeBlockedError(`private GLB attempt ${attempt} failed status/type/length integrity checks.`);
      }
      if (!result.glbContainerAndBuffersValid) throw new ProbeBlockedError(`private GLB attempt ${attempt} failed GLB v2 container/buffer integrity checks.`);
      if (expectedAssetBytes !== undefined && contentLength !== expectedAssetBytes) {
        throw new ProbeBlockedError('private GLB byte length changed between the three probe attempts.');
      }
      if (expectedAssetSha256 !== undefined && result.sha256 !== expectedAssetSha256) {
        throw new ProbeBlockedError('private GLB bytes changed between the three probe attempts.');
      }
      expectedAssetBytes = contentLength;
      expectedAssetSha256 = result.sha256;
      emit(`GLB attempt ${attempt}/3: status=200 content-length=${contentLength} body-bytes=${result.bytes} glb-container-buffers=valid`);
    }
    allAssetsVerified = true;
  } finally {
    await context.close();
    if (allAssetsVerified) ensureNoConsoleInjection();
  }
}

async function runProbe(config: StagingProbeConfig, registerBrowser: (close: () => Promise<void>) => void, isTimedOut: () => boolean): Promise<void> {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
  const {chromium} = await import('@playwright/test');
  if (isTimedOut()) throw new ProbeTimeoutError('probe timed out before browser launch');
  const browser = await chromium.launch({headless: true});
  registerBrowser(() => browser.close());
  if (isTimedOut()) {
    await browser.close();
    throw new ProbeTimeoutError('probe timed out during browser launch');
  }

  try {
    await runStagingProbeSession(config, browser);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  let result: 'PASS' | 'ENV_BLOCKED' | 'SETUP_ERROR' | 'TIMEOUT' = 'SETUP_ERROR';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let closeBrowser: (() => Promise<void>) | undefined;
  try {
    const config = loadStagingProbeConfig(process.env);
    console.log(formatProbeStart(config));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void closeBrowser?.().catch(() => {});
        reject(new ProbeTimeoutError('probe timed out'));
      }, 90_000);
    });
    await Promise.race([runProbe(config, close => { closeBrowser = close; }, () => timedOut), timeout]);
    result = 'PASS';
  } catch (error) {
    if (error instanceof ProbeTimeoutError || (error instanceof Error && error.name === 'TimeoutError')) {
      result = 'TIMEOUT';
      console.error('Staging browser-path probe exceeded its time limit.');
    } else if (error instanceof ProbeBlockedError || (error instanceof Error && /staging health gate/.test(error.message))) {
      result = 'ENV_BLOCKED';
      console.error(error instanceof ProbeBlockedError ? error.message : 'staging health gate did not confirm mode=staging.');
    } else if (error instanceof Error && /Missing required staging probe settings|STAGING_PROBE_/.test(error.message)) {
      result = 'SETUP_ERROR';
      console.error(error.message);
    } else {
      // Do not print raw browser/network exception text: it can contain request details.
      result = 'SETUP_ERROR';
      console.error('Staging probe setup or browser launch failed; raw exception details were suppressed.');
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  console.log(`STAGING_BROWSER_PROBE_RESULT=${result}`);
  process.exitCode = result === 'PASS' ? 0 : result === 'ENV_BLOCKED' ? 1 : result === 'SETUP_ERROR' ? 2 : 3;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
