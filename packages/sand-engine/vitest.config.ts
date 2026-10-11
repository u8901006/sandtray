import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// G33/T12：sand-engine 專用 unit 設定。root `npm test` 的 include 是 tests/**，
// 本套件測試由 `npm test -w @sandtray/sand-engine`（或本檔）獨立執行，root check 分母不變。
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
