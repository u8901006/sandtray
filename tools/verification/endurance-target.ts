/** Validate an external endurance target before Playwright can issue any session writes. */
export function normalizeStagingOrigin(raw?: string): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ENDURANCE_ORIGIN must be a valid HTTPS origin');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ENDURANCE_ORIGIN must be a bare HTTPS origin without credentials, path, query, or fragment');
  }
  return url.origin;
}

// 2026-09-28: the Worker only accepts a 64-char lowercase hex session token (auth.ts authenticate). A looser check let a
// pasted requestId UUID through, and the run then failed after launch with 401 on the first room create.
export function assertStagingSessionCookie(raw?: string): void {
  if (!raw || !/^sandtray_session=[a-f0-9]{64}$/.test(raw)) {
    throw new Error('External endurance requires ENDURANCE_SESSION_COOKIE in sandtray_session=<token> form, where <token> is the 64-character hex value of the sandtray_session cookie (not a requestId or UUID)');
  }
}

export function assertStagingHealthMode(body: unknown): void {
  const mode = body && typeof body === 'object' && 'mode' in body
    ? (body as {mode?: unknown}).mode
    : undefined;
  if (mode !== 'staging') {
    throw new Error('Refusing external endurance writes: /api/health mode must be staging');
  }
}
