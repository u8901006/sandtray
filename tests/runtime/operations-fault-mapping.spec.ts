import {test, expect, type APIRequestContext, type Page} from '@playwright/test';
import {outboundSchemas} from '../../packages/protocol/src/index';

// 2026-09-29 GPT-5.6-sol review remediation: (1) receipt lookup uses an index, (2) only client input errors answer
// INVALID_PAYLOAD, infrastructure faults answer SAVE_FAILED, (3) a fault after the ACK adds no second terminal response.
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

async function setup(request: APIRequestContext, playwright: any, browser: any) {
  await request.post('/__test/login', {data: {name: 'therapist'}});
  const {id} = await (await post(request, '/api/rooms', {retentionMode: 'session-only', policyVersion: 'dev-v1'})).json();
  const {token} = await (await post(request, `/api/rooms/${id}/invites`)).json();
  const clientApi = await playwright.request.newContext({baseURL: origin});
  const clientContext = await browser.newContext();
  const {participantId} = await (await post(clientApi, '/api/invites/redeem', {token, nickname: '虛構故障測試'})).json();
  await post(request, `/api/rooms/${id}/admit`, {participantId});
  await clientContext.addCookies((await clientApi.storageState()).cookies);
  const page = await clientContext.newPage();
  expect(await attach(page, id)).toBe(true);
  const {sessionEpoch, controlEpoch} = await (await clientApi.get(`/api/rooms/${id}/info`)).json();
  const create = (objectId: string) => ({protocolVersion: 1, sessionEpoch, controlEpoch, type: 'object.create', operationId: crypto.randomUUID(),
    objectId, assetId: 'DEV_ROCK', assetVersion: 'dev-v1', transform: {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1}});
  return {id, page, create, cleanup: async () => {await clientContext.close(); await clientApi.dispose();}};
}

test('operations receipt lookup by (actor, op) is served by an index, not a table scan', async ({request}) => {
  await request.post('/__test/login', {data: {name: 'therapist'}});
  const {id} = await (await post(request, '/api/rooms', {retentionMode: 'session-only', policyVersion: 'dev-v1'})).json();
  const {plan, indexes} = await (await request.get(`/__test/room/${id}/operations-plan`)).json();
  expect(indexes).toContain('operations_actor_op');
  expect(plan.join(' | ')).toMatch(/USING (COVERING )?INDEX operations_actor_op/);
  expect(plan.join(' | ')).not.toMatch(/SCAN operations/);
});

test('an infrastructure fault before commit answers SAVE_FAILED, not INVALID_PAYLOAD, and a retry succeeds', async ({request, playwright, browser}) => {
  const {id, page, create, cleanup} = await setup(request, playwright, browser);
  try {
    const cmd = create('fault-rock');
    await post(request, `/__test/room/${id}/inject-fault`, {mode: 'before-commit'});
    const rejected = await exchange(page, cmd);
    expect(rejected).toMatchObject({type: 'operation.rejected', code: 'SAVE_FAILED', operationId: cmd.operationId});
    const retry = await exchange(page, cmd);
    expect(retry.type).toBe('operation.ack');
    const bad = {...create('bad'), transform: 'not-a-transform'};
    expect(await exchange(page, bad)).toMatchObject({type: 'operation.rejected', code: 'INVALID_PAYLOAD'});
  } finally {await cleanup();}
});

test('a fault after the ACK is sent adds no rejection; the retry returns the durable receipt', async ({request, playwright, browser}) => {
  const {id, page, create, cleanup} = await setup(request, playwright, browser);
  try {
    const cmd = create('post-ack-rock');
    await post(request, `/__test/room/${id}/inject-fault`, {mode: 'after-ack'});
    const ack = await exchange(page, cmd);
    expect(ack.type).toBe('operation.ack');
    await page.waitForTimeout(500);
    const responses = await page.evaluate((op: string) => (window as any).events.filter((e: any) => e.operationId === op && (e.type === 'operation.ack' || e.type === 'operation.rejected')).map((e: any) => e.type), cmd.operationId);
    expect(responses).toEqual(['operation.ack']);
    expect(await exchange(page, cmd)).toEqual(ack);
  } finally {await cleanup();}
});
