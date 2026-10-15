"""Run serial, temporary guard mutations; never run concurrently with a build or test suite."""
import json, os, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[3]
PKG = ROOT / 'packages/omb-launcher'
NODE = '/opt/homebrew/opt/node@24/bin/node'
CASES = [
    ('signature', 'packages/omb-launcher/src/signing.ts', "|| !verify(null,", "|| false && !verify(null,", 'packages/omb-launcher/test/certify.test.ts'),
    ('request-binding', 'packages/omb-launcher/src/signing.ts', 'v.requestHash !== requestHash', 'false', 'packages/omb-launcher/test/certify.test.ts'),
    ('schema-fields', 'packages/omb-launcher/src/certify.ts', "Object.keys(v).sort().join(',') !== expected", 'false', 'packages/omb-launcher/test/certify.test.ts'),
    ('decoded-cap', 'packages/omb-launcher/src/certify.ts', 'total > CERTIFY_BYTES_CAP', 'false', 'packages/omb-launcher/test/certify.test.ts'),
    ('os-separation', 'packages/omb-launcher/src/certify.ts', "options.separated && options.store.separation === 'os-users'", 'true', 'packages/omb-launcher/test/certify.test.ts'),
    ('gate-authentication', 'packages/omb-launcher/src/certify.ts', 'if (board.rejected)', 'if (false)', 'packages/omb-launcher/test/certify.test.ts'),
    ('native-code-binding', 'packages/omb-investigate/src/native-store.ts', ' || native.tuple.frozenCodeHash !== request.look.frozenCodeHash', '', 'packages/omb-investigate/test/native-store.test.ts'),
    ('native-ceiling', 'packages/omb-investigate/src/native-store.ts', ' || out.claimCeiling !== "requires-certification"', '', 'packages/omb-investigate/test/native-store.test.ts'),
    ('receiver-cap', 'packages/omb-investigate/src/launcher-certification.ts', "!request.osUserSeparation || request.degraded || result.separation !== 'OS-user separation'", 'false', 'packages/omb-investigate/test/launcher-certification.test.ts'),
    ('sudo-audit', 'packages/omb-launcher/src/verify.ts', 'lines[0]!.trim() !== `(_ombcert) NOPASSWD: ${commandList}`', 'false', 'packages/omb-launcher/test/templates.test.ts'),
    ('named-byte-cap', 'packages/omb-launcher/src/authority.ts', '[...inventory.values()].reduce((n,b)=>n+b.length,0)>CERTIFY_BYTES_CAP', 'false', 'packages/omb-launcher/test/authority.test.ts'),
    ('ticket-mac', 'packages/omb-launcher/src/authority.ts', "!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(this.mac(body),'hex'))", 'false', 'packages/omb-launcher/test/authority.test.ts'),
    ('ticket-expiry', 'packages/omb-launcher/src/authority.ts', 't.expires<this.o.now()', 'false', 'packages/omb-launcher/test/authority.test.ts'),
    ('ticket-execution', 'packages/omb-launcher/src/authority.ts', "||r.executionId!==state.look!.executionId", '', 'packages/omb-launcher/test/authority.test.ts'),
    ('authority-look-input', 'packages/omb-launcher/src/authority.ts', '||look.inputManifestHash!==p.inputHash', '', 'packages/omb-launcher/test/authority.test.ts'),
    ('native-receiver-cap', 'packages/omb-investigate/src/launcher-native.ts', "r.degraded||!r.osUserSeparation||result.separation!=='OS-user separation'", 'false', 'packages/omb-investigate/test/launcher-native.test.ts'),
]
logdir = PKG / '.scratch/mutations'
logdir.mkdir(parents=True, exist_ok=True)
results = []
for name, relative, before, after, test in CASES:
    file = ROOT / relative
    original = file.read_bytes()
    source = original.decode()
    if source.count(before) != 1:
        raise RuntimeError(f'{name}: expected exactly one mutation site')
    try:
        file.write_text(source.replace(before, after))
        run = subprocess.run([NODE, str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', test, '--maxWorkers=1'], cwd=ROOT, env={**os.environ, 'PATH': '/opt/homebrew/opt/node@24/bin:' + os.environ['PATH']}, capture_output=True, timeout=120)
        output = (run.stdout + run.stderr).decode(errors='replace')
        (logdir / f'{name}.log').write_text(output)
        killed = run.returncode != 0 and ' FAIL ' in output and 'AssertionError' in output
        results.append({'mutation': name, 'file': relative, 'test': test, 'exitCode': run.returncode, 'killedByAssertion': killed})
        print(f'{name}: {"killed" if killed else "SURVIVED OR HARNESS ERROR"}', flush=True)
    finally:
        file.write_bytes(original)
report = {'schema': 'omb-launcher/guard-mutations/v1', 'results': results, 'killed': sum(r['killedByAssertion'] for r in results), 'total': len(results)}
(PKG / 'WIRE-MUTATIONS.json').write_text(json.dumps(report, indent=2) + '\n')
if report['killed'] != report['total']:
    raise SystemExit(1)
