import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { FileCache } from '../../omb-citations/src/http.ts';
import { AcademicAccess, LiteratureModels, PlanningResearch, searchEnabled, loadLiteratureContact, type LiteratureContactConfig, type NoveltyVote } from '../../omb-literature/src/index.ts';
import { Investigation, type InvestigationDeps } from '../../omb-investigate/src/investigation.ts';
import type { InvestigationSpec } from '../../omb-investigate/src/types.ts';
import { InvestigationPaused } from '../../omb-investigate/src/pause.ts';
import { privateDirectory, privateFile } from './paths.ts';

export interface HostLiteratureConfig extends LiteratureContactConfig {
  entityPairs: Array<[string, string]>;
  codexModel: string;
  claudeModel: string;
  effort?: string;
  timeoutMs?: number;
}
export interface LiteratureIO { transport?: typeof fetch; wait?: (ms: number) => Promise<void> }
/** Shared composition for library and CLI. Uses the SAME ledger journal as plan lock/look.
 * Task cards take precedence before any literature configuration, cache or model is touched. */
export function createTierCInvestigation(spec: InvestigationSpec, deps: InvestigationDeps, config?: HostLiteratureConfig, io: LiteratureIO = {}): Investigation {
  if (spec.taskPromptFile || !searchEnabled(spec.literatureMode ?? 'one-shot')) return new Investigation(spec, deps);
  if (!config || !Array.isArray(config.entityPairs) || !config.entityPairs.length || config.entityPairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(s => typeof s !== 'string' || !s.trim())) ||
    !config.codexModel?.trim() || !config.claudeModel?.trim() || (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1))) throw new Error('invalid host literature configuration');
  const root = privateDirectory(path.join(deps.paths.hostRoot, 'literature'));
  const access = new AcademicAccess({ contactEmail: loadLiteratureContact(config), cache: new FileCache(privateDirectory(path.join(root, 'cache'))), now: deps.now, ...io.wait && { wait: io.wait } });
  const models = new LiteratureModels({ workRoot: `${deps.paths.workRoot}-literature`, timeoutMs: config.timeoutMs ?? 600_000,
    codex: { adapter: deps.workers.codex, model: config.codexModel, effort: config.effort ?? 'high' },
    claude: { adapter: deps.workers.claude, model: config.claudeModel, effort: config.effort ?? 'high' } });
  const owner = { actor: 'owner', review: async (context: { question: string; searches: unknown[] }): Promise<NoveltyVote[]> => {
    const contextHash = canonicalSha256(context), dir = privateDirectory(path.join(root, canonicalSha256(spec.id)));
    const request = path.join(dir, 'novelty-review-request.json'), decision = path.join(dir, 'novelty-review.json');
    privateFile(request); privateFile(decision);
    writeFileSync(request, JSON.stringify({ investigationId: spec.id, contextHash, ...context }, null, 2), { mode: 0o600 });
    if (!existsSync(decision)) throw new InvestigationPaused('provider', `Owner novelty review required: ${request}`, 'deliverable');
    const saved = JSON.parse(readFileSync(decision, 'utf8')) as { contextHash: string; votes: NoveltyVote[] };
    if (saved.contextHash !== contextHash || !Array.isArray(saved.votes)) throw new InvestigationPaused('provider', 'Owner novelty review context changed', 'deliverable');
    return saved.votes;
  } };
  const literature = new PlanningResearch({ journal: deps.ledger.literatureJournal ?? deps.journal, now: deps.now, worker: models.worker,
    noveltyReview: models.novelty(owner), entityPairs: () => structuredClone(config.entityPairs), access, ...io.transport && { transport: io.transport } });
  return new Investigation(spec, { ...deps, literature });
}
