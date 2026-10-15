import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-live-release.test.ts'],testTimeout:240000,pool:'forks',maxWorkers:1}});
