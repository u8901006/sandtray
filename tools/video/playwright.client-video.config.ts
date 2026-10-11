import {defineConfig} from '@playwright/test';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
// 案主教學影片錄製（不是測試套件，不計入 check／E2E／runtime 結果）。沿用 runtime 的本機 Worker 與 /__test/login。
export default defineConfig({testDir:'.',testMatch:'client-guide.spec.ts',timeout:600000,workers:1,reporter:[['list']],outputDir:'../../working/video-client/pw-output',globalSetup:'../../tests/runtime/global-setup.ts',use:{baseURL:'http://127.0.0.1:8788',extraHTTPHeaders:{'X-Sandtray-Protocol':'2'},launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'npm run build && node tools/verification/runtime-server.mjs',cwd:'../..',url:'http://127.0.0.1:8788/api/health',reuseExistingServer:false,timeout:240000,env:{WRANGLER_SEND_METRICS:'false'}}});
