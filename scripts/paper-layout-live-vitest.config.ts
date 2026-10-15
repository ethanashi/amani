import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-layout-live.test.ts'],testTimeout:1500000,pool:'forks',maxWorkers:1}});
