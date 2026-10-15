import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-content-recheck.test.ts'],testTimeout:120000,pool:'forks',maxWorkers:1}});
