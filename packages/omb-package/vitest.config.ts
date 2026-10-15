import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['packages/omb-package/test/**/*.test.ts','packages/omb-package/test/**/*.integration.ts'],pool:'forks',maxWorkers:2,testTimeout:60_000,hookTimeout:60_000}});
