"""Offline tests for the scholarly client and row verifier (finding 2: freshness and API failure).

The network is never touched: urllib's urlopen is replaced by a function that fails the test, and
each test scripts `scholarly._fetch` responses.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scholarly as S  # noqa: E402
import verify_rows as V  # noqa: E402

FAB = {
    'class': 'fabricated-doi', 'domain': 'als', 'difficulty': 'easy',
    'sentence': 'Synthetic biomarker zeta predicts survival in a fictional cohort [1].',
    'quote': 'Higher zeta concentrations were associated with shorter survival in this cohort.',
    'citation': {'doi': '10.5555/NOT.REGISTERED.1', 'pmid': None, 'authors': 'Nobody A, et al.', 'year': 2021,
                 'title': 'A study that does not exist', 'journal': 'Journal of Nothing', 'volume': '1', 'issue': '1', 'pages': '1-2'},
    'truth': None, 'evidence': {'section': 'registry', 'quote': 'x'}, 'plant': '', 'relatedIds': [],
}


def responder(table):
    """_fetch replacement: the first matching URL fragment decides (status, body)."""
    calls = []

    def fetch(url, accept):
        calls.append(url)
        for frag, resp in table:
            if frag in url:
                return resp
        return (503, b'')
    fetch.calls = calls
    return fetch


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='scholarly-test.'))
        self.patches = [
            mock.patch.object(S, 'CACHE', self.tmp),
            mock.patch.object(S, 'FRESH', False),
            mock.patch.object(S, 'sleep', lambda s: None),
            mock.patch.object(urllib.request, 'urlopen', side_effect=AssertionError('network used in a test')),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)


class Availability(Base):
    def test_outage_is_unavailable_never_absence(self):
        for status in (503, 500, 429, -1):
            with mock.patch.object(S, '_fetch', responder([('', (status, b''))])):
                with self.assertRaises(S.Unavailable):
                    S.crossref_agency('10.5555/x')
                with self.assertRaises(S.Unavailable):
                    S.crossref('10.5555/x')
                with self.assertRaises(S.Unavailable):
                    S.epmc_search('DOI:"10.5555/x"')
                with self.assertRaises(S.Unavailable):
                    S.pubmed_summary('123')

    def test_fabricated_row_is_rejected_when_services_fail(self):
        with mock.patch.object(S, '_fetch', responder([('', (503, b''))])):
            row, problems = V.verify(dict(FAB), '2026-10-11')
        self.assertIsNone(row)
        self.assertTrue(problems[0].startswith('UNVERIFIED'), problems)

    def test_partial_outage_still_fails_closed(self):
        # Agency answers 404 (definite) but Europe PMC is down: still not verified.
        with mock.patch.object(S, '_fetch', responder([('/agency', (404, b'Resource not found.')), ('europepmc', (502, b''))])):
            row, problems = V.verify(dict(FAB), '2026-10-11')
        self.assertIsNone(row)
        self.assertIn('UNVERIFIED', problems[0])

    def test_definite_absence_marks_not_registered(self):
        table = [
            ('/agency', (404, b'Resource not found.')),
            ('europepmc', (200, json.dumps({'hitCount': 0, 'resultList': {'result': []}}).encode())),
            ('esearch', (200, json.dumps({'esearchresult': {'count': '0', 'idlist': []}}).encode())),
        ]
        with mock.patch.object(S, '_fetch', responder(table)):
            row, problems = V.verify(dict(FAB), '2026-10-11')
        self.assertEqual(problems, [])
        self.assertEqual(row['verification']['registry'], 'not-registered')
        self.assertEqual(row['input']['citation']['doi'], '10.5555/not.registered.1')  # uniform lower case

    def test_malformed_bodies_are_unavailable(self):
        with mock.patch.object(S, '_fetch', responder([('europepmc', (200, b'<html>maintenance</html>'))])):
            with self.assertRaises(S.Unavailable):
                S.epmc_search('x')
        with mock.patch.object(S, '_fetch', responder([('esummary', (200, b'{}'))])):
            with self.assertRaises(S.Unavailable):
                S.pubmed_summary('1')


class Freshness(Base):
    def test_cache_hit_expiry_and_fresh_mode(self):
        body = json.dumps({'message': {'agency': {'id': 'crossref'}}}).encode()
        fetch = responder([('/agency', (200, body))])
        clock = [1_000_000.0]
        with mock.patch.object(S, '_fetch', fetch), mock.patch.object(S, 'now', lambda: clock[0]):
            self.assertEqual(S.crossref_agency('10.5555/a'), 'crossref')
            self.assertEqual(S.crossref_agency('10.5555/a'), 'crossref')
            self.assertEqual(len(fetch.calls), 1)  # served from cache
            clock[0] += S.MAX_AGE + 1
            S.crossref_agency('10.5555/a')
            self.assertEqual(len(fetch.calls), 2)  # stale entry refetched
            with mock.patch.object(S, 'FRESH', True):
                S.crossref_agency('10.5555/a')
            self.assertEqual(len(fetch.calls), 3)  # fresh mode never reads the cache

    def test_unavailable_answers_are_never_cached(self):
        fetch = responder([('/agency', (503, b''))])
        with mock.patch.object(S, '_fetch', fetch):
            for _ in range(2):
                with self.assertRaises(S.Unavailable):
                    S.crossref_agency('10.5555/b')
        self.assertEqual(len(fetch.calls), 2)
        self.assertEqual(list(self.tmp.rglob('*.meta')), [])

    def test_check_mode_is_fresh_and_reports_outages(self):
        suite_row = {
            'id': 'pw4s-abcdef', 'split': 'private', 'class': 'fabricated-doi', 'domain': 'als', 'difficulty': 'easy',
            'input': {'sentence': FAB['sentence'], 'quote': FAB['quote'], 'citation': dict(FAB['citation'], doi='10.5555/not.registered.1')},
            'evidence': {'section': 'registry', 'quote': 'x'}, 'evidenceText': None, 'plant': 'p', 'truth': None, 'relatedIds': [],
            'source': {'url': 'u', 'license': 'l', 'openAccess': False, 'fullText': False},
            'adjudication': {'factual': 'no-source', 'windows': [], 'windowSha256': None},
            'verification': {'registry': 'not-registered', 'retraction': {'retracted': False, 'notices': []}, 'updates': [],
                             'workType': None, 'metadataMismatch': [], 'anchorFoundIn': [], 'evidenceFoundIn': []},
        }
        path = self.tmp / 'rows.jsonl'
        path.write_text(json.dumps(suite_row) + '\n')
        with mock.patch.object(S, '_fetch', responder([('', (503, b''))])):
            code = V.check([str(path)], 'check')
        self.assertEqual(code, 1)
        self.assertTrue(S.FRESH)


class Windows(unittest.TestCase):
    def texts(self, body, xref=None, kind='results'):
        return {'record': {}, 'abstract': '', 'sections': [{'kind': kind, 'title': 't', 'text': xref or body}],
                'sections_noxref': [{'kind': kind, 'title': 't', 'text': body}]}

    def test_markers_by_position_and_citation_markers(self):
        body = 'Cases were older. The marker was higher in cases than controls. However, this was small.'
        wins, sha = S.anchor_windows('The marker was higher in cases than controls', self.texts(body))
        self.assertEqual(wins, [{'section': 'results', 'citationMarker': False, 'markers': [{'marker': 'however', 'position': 'after'}]}])
        self.assertEqual(len(sha), 64)
        # Superscript reference after the full stop (rendered "controls.12") marks the sentence.
        wins, _ = S.anchor_windows('The marker was higher in cases than controls',
                                   self.texts('The marker was higher in cases than controls. Next one.', 'The marker was higher in cases than controls.12 Next one.', 'discussion'))
        self.assertTrue(wins[0]['citationMarker'])
        wins, _ = S.anchor_windows('The marker was higher', self.texts('The marker was higher in cases [] than controls.', kind='discussion'))
        self.assertTrue(wins[0]['citationMarker'])
        wins, _ = S.anchor_windows('The marker was higher', self.texts('The marker was higher in cases.', kind='discussion'))
        self.assertFalse(wins[0]['citationMarker'])

    def test_marker_words_need_word_boundaries(self):
        wins, _ = S.anchor_windows('The attribute contributed to butyrate output', self.texts('The attribute contributed to butyrate output.'))
        self.assertEqual(wins[0]['markers'], [])
        wins, _ = S.anchor_windows('We did not observe the effect', self.texts('We did  not observe the effect.'.replace('  ', ' ')))
        self.assertEqual(wins[0]['markers'], [{'marker': 'did not', 'position': 'anchor'}])


if __name__ == '__main__':
    unittest.main()
