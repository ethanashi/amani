#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runToolsGauntlet, type ToolsGauntletRequest } from './arm.ts';
/** Host JSON configuration, never a worker-selected file. The pilot dispatch remains reserved. */
export async function main(argv: string[]): Promise<number> {
  if (argv.length !== 2 || argv[0] !== 'run-host-config') throw new Error('usage: cli.ts run-host-config HOST_CONFIG.json (not pilot dispatch)');
  const request = JSON.parse(readFileSync(realpathSync(argv[1]!), 'utf8')) as ToolsGauntletRequest;
  request.adapter.now = () => new Date().getTime();
  const result = await runToolsGauntlet(request);
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.certification === 'written' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 2; });
