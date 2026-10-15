// Only selected by a locked dry-run plan; no model calls or scientific answers.
import { writeFixture } from '../../bio-baseline/test/fixtures/fake-host.ts';
const [action, root, ...args] = process.argv.slice(2);
if (action !== 'investigate' || args.join(' ') !== '--mode confirm --approve auto') throw Error('invalid fake invocation');
writeFixture(root, 'success', 'pilot-fake 1');
