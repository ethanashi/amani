import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-stack2b-sample.test.ts'],testTimeout:240000,hookTimeout:240000,pool:'forks',maxWorkers:1}});
