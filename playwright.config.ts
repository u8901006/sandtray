import {defineConfig} from '@playwright/test';
import {budget} from './tests/e2e/budget';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const workerPort=Number(process.env.E2E_WORKER_PORT??'8787');
export default defineConfig({
 testDir:'tests/e2e',timeout:budget(30000),workers:1,reporter:[['list'],['json',{outputFile:'test-results/results.json'}]],
 // L07-2B C4: direct API calls in E2E act as the current two-tray client; the web app sends the same header itself.
 use:{baseURL:'http://127.0.0.1:5173',extraHTTPHeaders:{'X-Sandtray-Protocol':'2'},viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure',
 launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
 webServer:[{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},{command:`npm run dev:worker -- --port ${workerPort}`,url:`http://127.0.0.1:${workerPort}/api/health`,reuseExistingServer:!process.env.CI,env:{WRANGLER_SEND_METRICS:'false',X_LOCAL_OBSERVABILITY:'false'}}],
});

