"""Provisioning tests use tiny fixture trees and a fake executor, never installs."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('provision_worktree', Path(__file__).with_name('provision-worktree.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source, self.target, self.codec = [self.root / name for name in ('source', 'target', 'codec')]
        for root in (self.source, self.target, self.codec):
            root.mkdir()
            self.put(root / 'pnpm-lock.yaml', 'node pin')
            self.put(root / 'package.json', '{}')
            for deps in module.NODE_DEPS:
                parent = Path(deps).parent
                if str(parent) != '.':
                    self.put(root / parent / 'package.json', '{}')
                if root != self.target:
                    (root / deps).mkdir(parents=True)
            for relative, _ in module.RUNTIMES:
                for name in ('pixi.toml', 'pixi.lock'):
                    self.put(root / relative / name, 'python pin')
                if root != self.target:
                    for binary in (('python', 'R', 'Rscript') if relative.endswith('bio-baseline') else ('python',)):
                        self.put(root / relative / '.pixi/envs/default/bin' / binary, 'fake executable')
        self.calls = []

    def put(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def execute(self, args, **options):
        self.calls.append(args)
        self.assertTrue(options['check'])
        if args[0] == '/bin/cp':
            self.assertEqual(args[1], '-cR')
            shutil.copytree(args[2], args[3])
        return subprocess.CompletedProcess(args, 0)

    def provision(self, **options):
        return module.provision(self.source, self.target, run=self.execute,
                                free_bytes=lambda _: 45 * module.GIB, **options)

    def test_clones_both_pinned_runtimes_then_probes_imports_in_target(self):
        shutil.rmtree(self.source / 'packages/omb-investigate/format-runtime/.pixi')
        destinations = self.provision(codec_source=self.codec)
        self.assertEqual(len(destinations), 5)
        self.assertEqual(len(self.calls), 9)
        self.assertEqual(self.calls[4][2], str(self.codec / 'packages/omb-investigate/format-runtime/.pixi'))
        for args in self.calls[5:7]:
            self.assertTrue(args[0].startswith(str(self.target)))
            self.assertEqual(args[1:3], ['-I', '-c'])
        self.assertIn('openpyxl,defusedxml', self.calls[6][-1])
        self.assertIn('lifelines', self.calls[5][-1])
        self.assertEqual(Path(self.calls[7][0]).name, 'R')
        self.assertEqual(Path(self.calls[8][0]).name, 'Rscript')
        self.assertIn('library(survival); library(data.table)', self.calls[8][-1])

    def test_missing_codec_and_mismatched_pins_fail_before_any_copy(self):
        shutil.rmtree(self.source / 'packages/omb-investigate/format-runtime/.pixi')
        with self.assertRaisesRegex(RuntimeError, 'pinned runtime executable is missing'):
            self.provision()
        self.put(self.codec / 'packages/omb-investigate/format-runtime/pixi.lock', 'different')
        with self.assertRaisesRegex(RuntimeError, 'pinned dependency mismatch'):
            self.provision(codec_source=self.codec)
        self.assertEqual(self.calls, [])

    def test_symlinked_target_parent_cannot_escape_worktree(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.put(outside / 'amani-studio/package.json', '{}')
        shutil.rmtree(self.target / 'apps')
        (self.target / 'apps').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'target path escapes worktree'):
            self.provision()
        self.assertEqual(self.calls, [])
        self.assertFalse((outside / 'amani-studio/node_modules').exists())

    def test_source_must_not_contain_its_clone_destination(self):
        shutil.rmtree(self.source / 'node_modules')
        (self.source / 'node_modules').symlink_to(self.target, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'dependency source and destination overlap'):
            self.provision()
        self.assertEqual(self.calls, [])

    def test_missing_analysis_r_is_refused_before_copy(self):
        (self.source / 'packages/bio-baseline/.pixi/envs/default/bin/Rscript').unlink()
        with self.assertRaisesRegex(RuntimeError, 'pinned runtime executable is missing'):
            self.provision()
        self.assertEqual(self.calls, [])

    def test_failed_r_library_probe_refuses_success(self):
        def execute(args, **options):
            if Path(args[0]).name == 'Rscript':
                raise subprocess.CalledProcessError(1, args)
            return self.execute(args, **options)
        with self.assertRaises(subprocess.CalledProcessError):
            module.provision(self.source, self.target, run=execute, free_bytes=lambda _: 45 * module.GIB)

    def test_node_lock_mismatch_fails_before_copy(self):
        self.put(self.target / 'pnpm-lock.yaml', 'changed')
        with self.assertRaisesRegex(RuntimeError, 'pinned dependency mismatch'):
            self.provision()
        self.assertEqual(self.calls, [])

    def test_refuses_existing_destination_without_overwriting(self):
        (self.target / 'node_modules').mkdir()
        with self.assertRaisesRegex(RuntimeError, 'fresh dependency destination required'):
            self.provision()
        self.assertEqual(self.calls, [])

    def test_disk_floor_is_checked_before_copy(self):
        with self.assertRaisesRegex(RuntimeError, 'less than 40 GiB'):
            module.provision(self.source, self.target, run=self.execute, free_bytes=lambda _: 39 * module.GIB)
        self.assertEqual(self.calls, [])

    def test_failed_target_import_probe_refuses_success(self):
        def execute(args, **options):
            if args[-1].startswith('import openpyxl'):
                raise subprocess.CalledProcessError(1, args)
            return self.execute(args, **options)
        with self.assertRaises(subprocess.CalledProcessError):
            module.provision(self.source, self.target, run=execute, free_bytes=lambda _: 45 * module.GIB)


if __name__ == '__main__':
    unittest.main()
