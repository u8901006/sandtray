import {defineConfig} from '@playwright/test';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
// L07-2B C4 (2026-09-30): harness requests act as the current two-tray client (X-Sandtray-Protocol: 2); the gate itself is covered
// by tests/runtime/protocol-capability-gate.spec.ts, which sends requests without it.
export default defineConfig({testDir:'tests/runtime',testMatch:'**/*.spec.ts',globalSetup:'./tests/runtime/global-setup.ts',timeout:30000,workers:1,reporter:[['list'],['json',{outputFile:'test-results-runtime/results.json'}]],outputDir:'test-results-runtime',use:{baseURL:'http://127.0.0.1:8788',extraHTTPHeaders:{'X-Sandtray-Protocol':'2'},launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'npm run build && node tools/verification/runtime-server.mjs',url:'http://127.0.0.1:8788/api/health',reuseExistingServer:false,env:{WRANGLER_SEND_METRICS:'false'}}});
