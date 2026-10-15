import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-live-batch.test.ts'],testTimeout:7200000,pool:'forks',maxWorkers:1}});
