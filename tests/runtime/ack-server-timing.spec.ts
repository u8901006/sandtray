import {test, expect, type APIRequestContext, type Page} from '@playwright/test';
import {outboundSchemas} from '../../packages/protocol/src/index';

// 2026-09-28 user ruling (AC13): staging judges ACK latency on the Room DO's ack.serverMs, because the client-side
// round trip to the Cloudflare colo (Taiwan -> SJC ~150 ms) made the 100/300 ms bounds unreachable from the client.
// This pins the field: every ack carries a non-negative integer serverMs, it validates against the outbound contract,
// and a duplicate retry still returns the original durable receipt byte-for-byte (serverMs included).
const origin = 'http://127.0.0.1:8788';
const post = (api: APIRequestContext, path: string, data: unknown = {}) =>
  api.post(path, {data, headers: {Origin: origin}});

async function attach(page: Page, roomId: string) {
  await page.goto('/');
  return page.evaluate(id => new Promise<boolean>(resolve => {
    const state = window as any;
    state.events = [];
    state.ws = new WebSocket(location.origin.replace('http', 'ws') + `/api/rooms/${id}/socket`);
    state.ws.onmessage = (event: MessageEvent) => state.events.push(JSON.parse(event.data));
    state.ws.onopen = () => resolve(true);
    state.ws.onerror = () => resolve(false);
  }), roomId);
}

async function exchange(page: Page, command: Record<string, unknown>) {
  const start = await page.evaluate(cmd => {
    const state = window as any;
    const start = state.events.length;
    state.ws.send(JSON.stringify(cmd));
    return start;
  }, command);
  const response = () => page.evaluate(({start, operationId}) =>
    (window as any).events.slice(start).find((event: any) =>
      event.operationId === operationId && (event.type === 'operation.ack' || event.type === 'operation.rejected')),
  {start, operationId: command.operationId});
  await expect.poll(response).toBeTruthy();
  return response();
}

test('AC13 ruling: every ack carries the Room DO serverMs and a retry returns the identical receipt', async ({request, playwright, browser}) => {
  await request.post('/__test/login', {data: {name: 'therapist'}});
  const {id} = await (await post(request, '/api/rooms', {retentionMode: 'session-only', policyVersion: 'dev-v1'})).json();
  const {token} = await (await post(request, `/api/rooms/${id}/invites`)).json();
  const clientApi = await playwright.request.newContext({baseURL: origin});
  const clientContext = await browser.newContext();
  try {
    const {participantId} = await (await post(clientApi, '/api/invites/redeem', {token, nickname: '虛構計時測試'})).json();
    await post(request, `/api/rooms/${id}/admit`, {participantId});
    await clientContext.addCookies((await clientApi.storageState()).cookies);
    const page = await clientContext.newPage();
    expect(await attach(page, id)).toBe(true);
    const {sessionEpoch, controlEpoch} = await (await clientApi.get(`/api/rooms/${id}/info`)).json();
    const command = {protocolVersion: 1, sessionEpoch, controlEpoch, type: 'object.create', operationId: crypto.randomUUID(),
      objectId: 'timed-rock', assetId: 'DEV_ROCK', assetVersion: 'dev-v1', transform: {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1}};
    const ack = await exchange(page, command);
    expect(ack.type).toBe('operation.ack');
    expect(Number.isInteger(ack.serverMs)).toBe(true);
    expect(ack.serverMs).toBeGreaterThanOrEqual(0);
    expect(ack.serverMs).toBeLessThan(10000);
    expect(outboundSchemas['operation.ack'].safeParse(ack).success).toBe(true);
    const retry = await exchange(page, command);
    expect(retry).toEqual(ack);
  } finally {
    await clientContext.close();
    await clientApi.dispose();
  }
});
