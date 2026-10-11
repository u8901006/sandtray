// Test-level time budgets scale with the host (R1, 2026-09-27): the hosted CI runner has 2 vCPU and renders WebGL in
// software, so whole tests run 3-7x slower than on the development machine. E2E_TIME_SCALE only widens how long a test
// may run; it never changes an assertion, an expect() wait or a product deadline. Unset means 1 (local runs unchanged).
const raw=process.env.E2E_TIME_SCALE??'1';
export const timeScale=Number(raw);
if(!Number.isFinite(timeScale)||timeScale<1||timeScale>5)throw new Error(`E2E_TIME_SCALE must be a number from 1 to 5, got ${JSON.stringify(raw)}`);
export const budget=(ms:number)=>Math.round(ms*timeScale);
