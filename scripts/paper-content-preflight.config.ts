import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-content-preflight.test.ts'],testTimeout:30000,pool:'forks',maxWorkers:1}});
