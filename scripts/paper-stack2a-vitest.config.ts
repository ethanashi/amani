/** Explicit opt-in artifact build; not part of the ordinary root test inventory. */
import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/paper-stack2a-sample.test.ts'],testTimeout:180000,hookTimeout:180000,pool:'forks',maxWorkers:1}});
