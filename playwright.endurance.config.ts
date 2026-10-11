import {defineConfig,type PlaywrightTestConfig} from '@playwright/test';
import base from './playwright.runtime.config';
import {assertStagingSessionCookie,normalizeStagingOrigin} from './tools/verification/endurance-target';
// AC13 耐久獨立設定：只跑 tests/load 的 endurance-*；build 由 webServer 鏈先完成，不與 browser 並行。
// 預設 60 分鐘；smoke 以 ENDURANCE_* 環境變數縮短（見 tests/load/endurance-protocol.spec.ts 檔頭）。
// ENDURANCE_DISABLE_THROTTLING=1（C11-H3 對照實驗專用）：Chromium 啟動旗標停用隱藏分頁的
// intensive timer throttling／renderer backgrounding——僅供 G7 假說判別的對照跑，預設行為不變；
// 是否用於正式 AC13 證據跑屬 C12 裁定。
const config:PlaywrightTestConfig={...base,testDir:'tests/load',testMatch:'**/endurance-*.spec.ts',timeout:0,reporter:'list',outputDir:'test-results-endurance'};
if(process.env.ENDURANCE_DISABLE_THROTTLING==='1'){
 config.use={...config.use,launchOptions:{args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']}};
}
// G29（C25 §2.1，2026-09-18 使用者裁定交 GLM）：ENDURANCE_ORIGIN 有值＝對外部（staging）跑——
// 不起本機 webServer（runtime-server→wrangler→workerd 不啟動）、baseURL 指向該 origin；
// 未設時維持本機路徑（webServer 自起、8788）完全不變。WS 的 https→wss 由腳本
// location.origin.replace('http','ws') 自然處理，無須另改。
const stagingOrigin=normalizeStagingOrigin(process.env.ENDURANCE_ORIGIN);
if(!stagingOrigin&&process.env.ENDURANCE_SESSION_COOKIE){
 throw new Error('ENDURANCE_SESSION_COOKIE cannot be used without ENDURANCE_ORIGIN; refusing to send staging credentials to local runtime');
}
if(stagingOrigin){
 assertStagingSessionCookie(process.env.ENDURANCE_SESSION_COOKIE);
 delete config.webServer;
 delete config.globalSetup;
 config.testMatch='**/endurance-protocol.spec.ts';
 config.use={...config.use,baseURL:stagingOrigin};
}
export default defineConfig(config);
