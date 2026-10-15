import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineResult } from './engine.ts';
import { materialize, object, pointer, type Json } from './results.ts';
import type { Task } from './task.ts';

/** Export sources that the pilot's source-only collector admits; never cache numeric answers. */
export function exportPilot(task: Task, result: EngineResult, out: string): void {
  const work = path.join(out, 'workdir'), code = path.join(work, 'code');
  mkdirSync(code, { recursive: true });
  if (result.frozen && existsSync(path.join(result.frozen, 'code'))) cpSync(path.join(result.frozen, 'code'), code, { recursive: true });
  const configDir = path.join(code, 'amani', 'config'); mkdirSync(configDir, { recursive: true });
  const resolve = materialize(task.template, result.draft, result.evidence, task);
  const refs: Record<string, { file: string; pointer: string }> = {};
  for (const [at, source] of Object.entries(resolve.sources)) {
    if (source.source.startsWith('output:')) {
      const ref = source.source.slice(7), split = ref.indexOf('#');
      const file = split < 0 ? '' : ref.slice(0, split), p = ref.slice(split + 1);
      if (file && p !== undefined) refs[at] = { file, pointer: p };
    } else {
      const key = source.source.slice(7), parts = key.split('.');
      const candidates = [{ file: 'metrics.json', pointer: '/' + parts.join('/') }, { file: 'primary.json', pointer: key === 'n_units' ? '/n_units' : '/claims/' + parts.join('/') }];
      const ref = candidates.find(r => { const source = result.evidence.outputs[r.file]; return source !== undefined && pointer(source, r.pointer) === result.evidence.metrics[key]; });
      if (ref) refs[at] = ref;
      else result.warnings.push(`pilot rerun cannot reconstruct kernel-derived metric: ${key}`);
    }
  }
  const strip = (value: Json): Json => typeof value === 'number' ? null : Array.isArray(value) ? value.map(strip) : object(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)])) : value;
  writeFileSync(path.join(configDir, 'report.json'), JSON.stringify({ skeleton: strip(resolve.report), refs }));
  cpSync(fileURLToPath(new URL('./rerender.py', import.meta.url)), path.join(code, 'amani', 'rerender.py'));
  if (result.frozen) {
    for (const [src, dest] of [['run_all.sh', 'analysis.sh'], ['run_primary.sh', 'primary.sh'], ['plan.json', 'config/plan.json']] as const) {
      if (existsSync(path.join(result.frozen, src))) cpSync(path.join(result.frozen, src), path.join(code, 'amani', dest));
    }
  }
  writeFileSync(path.join(work, 'run_all.sh'), '#!/bin/bash\nset -euo pipefail\nsource ./env.sh\nmkdir -p outputs\n' + (result.frozen ?
    'cp code/amani/config/plan.json plan.json\nprintf "#!/bin/sh\\nset -eu\\ntest -d data\\n" > prepare.sh\nif [ -f code/amani/primary.sh ]; then cp code/amani/primary.sh run_primary.sh; fi\nbash code/amani/analysis.sh\n' : '') + 'python code/amani/rerender.py\n');
  // The grader replaces env.sh with its own trusted pixi environment hook.
  writeFileSync(path.join(work, 'env.sh'), '#!/bin/sh\n# Supplied by the grader when rerunning.\n');
  const manifestFile = path.join(task.dir, 'manifest.json');
  if (existsSync(manifestFile)) {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { files: { path: string; sha256: string; bytes: number }[] };
    if (Array.isArray(m.files)) writeFileSync(path.join(out, 'inputs.sha256'), m.files.map(f => `${f.sha256}  ${f.bytes}  ${f.path}\n`).join(''));
  }
}
