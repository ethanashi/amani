#!/usr/bin/env node
import { main } from '../../omb-certify/src/cli.ts';
import { regular } from './files.ts';
import { taskExecutor, type EnvironmentReceipt } from './environment.ts';
const [receiptFile, ...args] = process.argv.slice(2);
try {
  if (!receiptFile) throw new Error('host runtime receipt required');
  const receipt = JSON.parse(regular(receiptFile).toString()) as EnvironmentReceipt;
  process.exitCode = await main(args, (state, signal) => taskExecutor(state, receipt, signal));
} catch (error) { process.stderr.write(String(error) + '\n'); process.exitCode = 2; }
