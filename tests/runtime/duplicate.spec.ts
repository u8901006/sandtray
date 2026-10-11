import {test, expect, type APIRequestContext, type Page} from '@playwright/test';

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

// Read only messages received after this send: an earlier ACK must not mask rejection.
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

test('A09: changed payload with the same operation ID is rejected without mutation; original retry returns its ACK', async ({request, playwright, browser}) => {
  await request.post('/__test/login', {data: {name: 'therapist'}});
  const {id} = await (await post(request, '/api/rooms', {retentionMode: 'session-only', policyVersion: 'dev-v1'})).json();
  const {token} = await (await post(request, `/api/rooms/${id}/invites`)).json();
  const clientApi = await playwright.request.newContext({baseURL: origin});
  const clientContext = await browser.newContext();
  try {
    const {participantId} = await (await post(clientApi, '/api/invites/redeem', {token, nickname: '虛構去重測試'})).json();
    await post(request, `/api/rooms/${id}/admit`, {participantId});
    await clientContext.addCookies((await clientApi.storageState()).cookies);
    const page = await clientContext.newPage();
    expect(await attach(page, id)).toBe(true);
    const {sessionEpoch, controlEpoch} = await (await clientApi.get(`/api/rooms/${id}/info`)).json();
    const envelope = {protocolVersion: 1, sessionEpoch, controlEpoch};
    const transform = {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1};
    expect((await exchange(page, {...envelope, type: 'object.create', operationId: crypto.randomUUID(),
      objectId: 'duplicate-rock', assetId: 'DEV_ROCK', assetVersion: 'dev-v1', transform})).type).toBe('operation.ack');
    expect((await exchange(page, {...envelope, type: 'object.lock.acquire', operationId: crypto.randomUUID(),
      objectId: 'duplicate-rock', actions: ['translate']})).type).toBe('operation.ack');
    const lease = await page.evaluate(() => (window as any).events.filter((event: any) => event.type === 'lock.changed' && event.lease).at(-1).lease);
    const command = {...envelope, type: 'object.transform.commit', operationId: crypto.randomUUID(),
      objectId: 'duplicate-rock', expectedObjectRevision: 0, leaseId: lease.leaseId, fencingToken: lease.fencingToken,
      transform: {...transform, position: [1, 0, 0]}};
    const originalAck = await exchange(page, command);
    expect(originalAck.type).toBe('operation.ack');
    const before = await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
    expect(before.sceneRevision).toBe(2);
    expect(before.objects[0].transform.position).toEqual([1, 0, 0]);

    const rejected = await exchange(page, {...command, transform: {...transform, position: [2, 0, 0]}});
    expect(rejected.type).toBe('operation.rejected');
    expect(rejected.code).toBe('INVALID_PAYLOAD');
    const after = await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
    expect(after.sceneRevision).toBe(before.sceneRevision);
    expect(after.objects).toEqual(before.objects);

    expect(await exchange(page, command)).toEqual(originalAck);
    const retried = await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
    expect(retried.sceneRevision).toBe(before.sceneRevision);
    expect(retried.objects).toEqual(before.objects);
  } finally {
    await post(clientApi, `/api/rooms/${id}/close`);
    await clientContext.close();
    await clientApi.dispose();
  }
});

