import { z } from 'zod';
import { id } from '../../protocol/src/index';
import { Rejected, type Connection, type RoomState } from './index';

// Server-internal candidate transitions. The adapter must authenticate identity,
// bind the permission request and persist the result before sending an ACK.
const requestSchema = z.strictObject({
  objectId: id, participantId: id,
  actions: z.array(z.enum(['translate', 'rotate', 'scale', 'animate'])).min(1).max(4)
    .refine(actions => new Set(actions).size === actions.length),
  durationMs: z.number().int().min(1000).max(3600000),
});
function requireClient(state: RoomState, connection: Connection) {
  if (state.status !== 'ACTIVE') throw new Rejected('ROOM_CLOSED');
  const p = Object.hasOwn(state.participants, connection.participantId)
    ? state.participants[connection.participantId] : undefined;
  if (!p?.admitted || p.clinicId !== state.clinicId || connection.clinicId !== state.clinicId)
    throw new Rejected('UNAUTHENTICATED');
  if (p.sessionEpoch !== state.sessionEpoch || connection.sessionEpoch !== state.sessionEpoch)
    throw new Rejected('STALE_EPOCH');
  if (p.role !== 'client') throw new Rejected('PERMISSION_DENIED');
}
export function issueGrant(state: RoomState, connection: Connection, input: unknown, now: number, grantId: string): RoomState {
  requireClient(state, connection);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || !id.safeParse(grantId).success || Object.hasOwn(state.grants, grantId) ||
      !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + parsed.data.durationMs))
    throw new Rejected('INVALID_PAYLOAD');
  const request = parsed.data;
  const target = Object.hasOwn(state.participants, request.participantId)
    ? state.participants[request.participantId] : undefined;
  if (!Object.hasOwn(state.objects, request.objectId) || !target?.admitted || target.role !== 'therapist' ||
      target.clinicId !== state.clinicId || target.sessionEpoch !== state.sessionEpoch)
    throw new Rejected('PERMISSION_DENIED');
  const next = structuredClone(state);
  for (const grant of Object.values(next.grants)) {
    if (grant.objectId === request.objectId && grant.participantId === request.participantId && grant.active) {
      grant.active = false;
      grant.version++;
    }
  }
  // Replacing approval must not retain a lease obtained under the old actions.
  if (next.leases[request.objectId]?.participantId === request.participantId)
    delete next.leases[request.objectId];
  Object.defineProperty(next.grants, grantId, { enumerable: true, configurable: true, writable: true,
    value: { id: grantId, objectId: request.objectId, participantId: request.participantId,
      actions: request.actions, version: 1, sessionEpoch: state.sessionEpoch,
      expiresAt: now + request.durationMs, active: true } });
  return next;
}
export function revokeGrant(state: RoomState, connection: Connection, objectId: string, grantId: string): RoomState {
  requireClient(state, connection);
  const grant = Object.hasOwn(state.grants, grantId) ? state.grants[grantId] : undefined;
  if (!grant || grant.objectId !== objectId) throw new Rejected('PERMISSION_DENIED');
  const next = structuredClone(state);
  if (next.grants[grantId].active) {
    next.grants[grantId].active = false;
    next.grants[grantId].version++;
    if (next.leases[objectId]?.participantId === grant.participantId) delete next.leases[objectId];
  }
  return next;
}
