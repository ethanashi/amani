#!/usr/bin/env python3
"""Verify candidate rows against the public scholarly APIs and emit authoring rows (PW4s v2).

    python3 tools/verify_rows.py --date YYYY-MM-DD --out AUTHORING.jsonl --rejects REJECTS.jsonl ROWS.jsonl...
    python3 tools/verify_rows.py --check SUITE-ROWS.jsonl...   # fresh re-verification of committed rows

Input rows are research candidates or committed suite rows (their id and split are carried over).
For every row:
  * `truth` is re-derived from Crossref for the DOI as written, or from PubMed for a PMID-only
    reference (never trusted from the candidate);
  * retraction notices and every other update (corrections, errata, expressions of concern) come
    from Crossref `updated-by` (incl. Retraction Watch records) and `filter=updates:` notices; the
    Crossref work type marks preprints;
  * fabricated identifiers need a DEFINITE absence: Crossref agency 404 (DOI handle unregistered) and
    no Europe PMC / PubMed record; for a PMID-only reference, PubMed has no such PMID;
  * evidence and anchor quotes must occur verbatim in Europe PMC open-access JATS or the abstract;
  * every location of the anchor yields a source window: the sentence before, the anchor's whole
    sentence(s) and the sentence after, the section-7 contrast/hedging markers in it, and whether a
    citation marker sits in the anchor's sentence (an unmarked Discussion anchor is an author-proposal);
  * the citation as written is compared with the identifier's registered record.
Any service that does not answer definitively (5xx, 429, timeouts, bad bodies) raises Unavailable,
and the row is rejected (or reported UNVERIFIED by --check): an outage is never evidence of absence.
`expected`, `adjudication.triggers` and `adjudication.disposition` are derived by the TypeScript build.
Network: Crossref, Europe PMC and PubMed only.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scholarly as S  # noqa: E402

FACTUAL = {
    'correct-support': 'supported', 'attributed-proposal': 'supported', 'proposal-as-finding': 'speculative',
    'direction-flip': 'contradicted', 'negation': 'contradicted', 'wrong-numeric': 'contradicted', 'misquote': 'contradicted',
    'wrong-species': 'exceeds-source', 'overgeneralised-population': 'exceeds-source', 'quote-cut-qualifier': 'qualified',
    'secondary-citation': 'secondary', 'abstract-only-direction': 'abstract-only', 'wrong-metadata': 'defective-reference',
    'retracted': 'retracted-source', 'fabricated-doi': 'no-source',
}
RETRACTION_TYPES = ('retraction', 'withdrawal', 'removal')
RETRACTION_MARK = re.compile(r'^\s*(retracted(\s+article)?|withdrawn|retraction)\s*[:.\-]\s*', re.I)


def clean(s: str | None) -> str:
    if not s:
        return ''
    return S.norm(html.unescape(re.sub(r'<[^>]+>', '', s)))


def strip_retraction_marks(t: str) -> str:
    return re.sub(r'\s*\[(retracted|withdrawn)\]\s*$', '', RETRACTION_MARK.sub('', t), flags=re.I)


def title_key(t: str) -> str:
    return re.sub(r'[^\w]+', ' ', S.norm(strip_retraction_marks(t)).lower(), flags=re.UNICODE).replace('_', ' ').strip()


def first_author_of(authors: str) -> str:
    first = S.norm(authors.split(',')[0])
    return re.sub(r'\s+[A-Z]{1,4}$', '', first).lower()


def words(s: str) -> int:
    t = S.norm(s)
    return 0 if not t else len(t.split(' '))


def kinds(hits: list[dict]) -> list[str]:
    seen = []
    for h in hits:
        if h['kind'] not in seen:
            seen.append(h['kind'])
    return seen


# ---------------------------------------------------------------- registered records

def truth_from_doi(doi: str) -> tuple[dict | None, dict]:
    msg = S.crossref(doi)
    if not msg:
        return None, {}
    cr = S.cr_summary(msg)
    rec = S.epmc_record(doi=doi) or {}
    pmid = rec.get('pmid') or None
    if not pmid:
        ids = S.pubmed_by_doi(doi)
        pmid = ids[0] if len(ids) == 1 else None
    if not cr['journal'] and cr.get('type') == 'posted-content':
        # Preprints have no container title; the server (medRxiv, bioRxiv) is the venue.
        inst = (msg.get('institution') or [{}])[0].get('name') or msg.get('group-title') or msg.get('publisher') or ''
        cr['journal'] = inst
    ji = ((rec.get('journalInfo') or {}).get('journal') or {})
    abbrev = clean(ji.get('medlineAbbreviation') or ji.get('isoabbreviation') or cr.get('shortJournal') or '') or None
    truth = {
        'doi': (cr['doi'] or doi).lower(), 'pmid': pmid, 'pmcid': rec.get('pmcid') or None,
        'firstAuthor': clean(cr['firstAuthor']) or '', 'year': cr['year'], 'title': clean(cr['title']),
        'journal': clean(cr['journal']), 'journalAbbrev': abbrev, 'volume': cr['volume'] or None, 'pages': cr['pages'] or None,
    }
    return truth, {'crossref': cr, 'epmc': rec, 'printYear': cr.get('printYear'), 'workType': cr.get('type')}


def truth_from_pmid(pmid: str) -> tuple[dict | None, dict]:
    rec = S.pubmed_summary(pmid)
    if not rec:
        return None, {}
    ids = {i['idtype']: i['value'] for i in rec.get('articleids', [])}
    doi = (ids.get('doi') or '').lower() or None
    if doi:
        truth, meta = truth_from_doi(doi)
        if truth:
            truth['pmid'] = str(pmid)
            meta['pubmed'] = rec
            return truth, meta
    year = re.match(r'(\d{4})', rec.get('pubdate') or rec.get('epubdate') or '')
    first = re.sub(r'\s+[A-Z]{1,4}$', '', rec.get('sortfirstauthor') or (rec.get('authors') or [{}])[0].get('name', ''))
    epmc = S.epmc_record(pmid=pmid) or {}
    truth = {
        'doi': None, 'pmid': str(pmid), 'pmcid': epmc.get('pmcid') or (ids.get('pmc') or None),
        'firstAuthor': first, 'year': int(year.group(1)) if year else 0, 'title': clean(rec.get('title')).rstrip('.') or '',
        'journal': clean(rec.get('fulljournalname')), 'journalAbbrev': clean(rec.get('source')) or None,
        'volume': rec.get('volume') or None, 'pages': rec.get('pages') or None,
    }
    return truth, {'crossref': {}, 'epmc': epmc, 'pubmed': rec, 'workType': None}


def diffs(cw: dict, tr: dict) -> list[str]:
    out = []
    if abs(int(cw['year']) - int(tr['year'])) > 1:
        out.append('year')
    if title_key(cw['journal']) != title_key(tr['journal']) and (not tr.get('journalAbbrev') or title_key(cw['journal']) != title_key(tr['journalAbbrev'])):
        out.append('journal')
    if first_author_of(cw['authors']) != S.norm(tr['firstAuthor']).lower():
        out.append('firstAuthor')
    if title_key(cw['title']) != title_key(tr['title']):
        out.append('title')
    if cw.get('volume') is not None and tr.get('volume') is not None and cw['volume'] != tr['volume']:
        out.append('volume')
    if cw.get('pages') is not None and tr.get('pages') is not None and cw['pages'] != tr['pages']:
        out.append('pages')
    if cw.get('doi') and tr.get('doi') and cw['doi'].lower() != tr['doi'].lower():
        out.append('doi')
    if cw.get('pmid') and tr.get('pmid') and str(cw['pmid']) != str(tr['pmid']):
        out.append('pmid')
    return out


def update_record(doi: str | None, pubmed: dict | None) -> dict:
    """Retraction notices (retraction/withdrawal/removal) and all other updates of the work."""
    if not doi:
        pt = [p.lower() for p in (pubmed or {}).get('pubtype', [])]
        return {'retracted': 'retracted publication' in pt, 'notices': [], 'updates': [], 'events': []}
    ret = S.retraction_status(doi)
    notices, updates = [], []
    for e in ret['events']:
        item = {'doi': e['notice'] or '', 'type': e['type'] or '', 'source': e['source'] or '', 'date': (e['date'] or '')[:10] or None}
        (notices if (e['type'] or '').lower() in RETRACTION_TYPES else updates).append(item)
    return {'retracted': ret['retracted'], 'notices': notices, 'updates': updates, 'events': ret['events']}


# ---------------------------------------------------------------- candidates

def from_suite_row(r: dict) -> dict:
    """A committed (v1 or v2) suite row back in candidate form; id and split are carried over."""
    related = r.get('relatedIds', r.get('relatedDois')) or []
    intended = related[0] if r['class'] == 'wrong-metadata' and related else None
    truth = r.get('truth') or {}
    return {
        'id': r['id'], 'split': r['split'],
        'class': r['class'], 'domain': r['domain'], 'difficulty': r['difficulty'],
        'sentence': r['input']['sentence'], 'quote': r['input']['quote'], 'citation': dict(r['input']['citation']),
        'truth': {'doi': intended if intended and not intended.startswith('pmid:') else truth.get('doi'),
                  'pmid': intended[5:] if intended and intended.startswith('pmid:') else truth.get('pmid')},
        'evidence': dict(r['evidence']), 'evidenceText': r.get('evidenceText'),
        'plant': r['plant'], 'relatedIds': related, 'notes': '',
    }


def verify(c: dict, date: str) -> tuple[dict | None, list[str]]:
    try:
        return _verify(c, date)
    except S.Unavailable as e:
        return None, [f'UNVERIFIED (service unavailable, not evidence of absence): {e}']


def _verify(c: dict, date: str) -> tuple[dict | None, list[str]]:
    problems: list[str] = []
    notes: list[str] = []
    cls = c.get('class')
    if cls not in FACTUAL:
        return None, [f'unknown class {cls}']
    cit = dict(c['citation'])
    cit['doi'] = (cit.get('doi') or '').strip().lower() or None  # uniform identifier case (finding 5)
    for k in ('volume', 'issue', 'pages', 'pmid'):
        v = cit.get(k)
        cit[k] = None if v in (None, '') else str(v)
    cit['year'] = int(cit['year'])
    cit['title'] = strip_retraction_marks(S.norm(cit['title']))  # as originally published
    sentence = S.norm(c['sentence'])
    quote = S.norm(c['quote'])
    ev = {'section': c['evidence']['section'], 'quote': S.norm(c['evidence']['quote'])}
    methods: list[str] = []
    verification = {
        'checkedAt': date, 'methods': methods, 'registry': 'registered',
        'retraction': {'retracted': False, 'notices': []}, 'updates': [], 'workType': None,
        'evidenceFoundIn': [], 'anchorFoundIn': [], 'metadataMismatch': [], 'notes': '',
    }
    if words(quote) < 8:
        problems.append('anchor quote under 8 words')
    if not re.search(r'\[\d+\]', sentence):
        problems.append('sentence lacks [n] marker')
    if not cit['doi'] and not cit['pmid']:
        problems.append('citation has neither DOI nor PMID')
    related = sorted({x.lower() if not str(x).startswith('pmid:') else str(x) for x in (c.get('relatedIds') or c.get('relatedDois') or [])})
    carry = {k: c[k] for k in ('id', 'split') if c.get(k)}

    if cls == 'fabricated-doi':
        methods += ['crossref-agency', 'europepmc-search', 'pubmed-esearch', 'pubmed-esummary']
        if cit['doi']:
            agency = S.crossref_agency(cit['doi'])
            if agency is not None:
                problems.append(f'fabricated DOI is registered with {agency}')
            if S.epmc_search(f'DOI:"{cit["doi"]}"', 5):
                problems.append('Europe PMC has a record for the fabricated DOI')
            if S.pubmed_by_doi(cit['doi']):
                problems.append('PubMed has a record for the fabricated DOI')
            if cit['pmid']:
                s = S.pubmed_summary(cit['pmid'])
                notes.append(f'PMID {cit["pmid"]}: ' + (f'an unrelated PubMed record ("{clean(s.get("title"))[:80]}")' if s else 'no PubMed record'))
            registry_q = f'Crossref /works/{cit["doi"]}/agency: HTTP 404 (DOI not registered with any agency); Europe PMC and PubMed: no record.'
            url = f'https://api.crossref.org/works/{cit["doi"]}/agency'
        else:
            if S.pubmed_summary(cit['pmid']) is not None:
                problems.append(f'PMID {cit["pmid"]} exists in PubMed')
            if S.epmc_record(pmid=cit['pmid']) is not None:
                problems.append(f'Europe PMC has a record for PMID {cit["pmid"]}')
            registry_q = f'PubMed esummary: no record for PMID {cit["pmid"]}; Europe PMC: no record.'
            url = f'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={cit["pmid"]}'
        verification['registry'] = 'not-registered'
        verification['notes'] = '; '.join(notes + ([c['notes']] if c.get('notes') else []))[:800]
        row = {
            **carry, 'class': cls, 'domain': c['domain'], 'difficulty': c.get('difficulty', 'medium'),
            'input': {'sentence': sentence, 'quote': quote, 'citation': cit},
            'adjudication': {'factual': FACTUAL[cls], 'windows': [], 'windowSha256': None},
            'evidence': {'section': 'registry', 'quote': registry_q},
            'evidenceText': None,
            'plant': S.norm(c.get('plant', '')) or 'Invented reference; the identifier does not resolve.',
            'truth': None, 'relatedIds': related,
            'source': {'url': url, 'license': 'n/a (fabricated reference)', 'openAccess': False, 'fullText': False},
            'verification': verification,
        }
        return (None if problems else row), problems

    # ---- real works: the registered record of the identifier AS WRITTEN
    if cit['doi']:
        truth, meta = truth_from_doi(cit['doi'])
        methods += ['crossref', 'crossref-updates', 'europepmc-record']
        if truth is None:
            return None, [f'Crossref has no record for {cit["doi"]} (definite 404)']
    else:
        truth, meta = truth_from_pmid(cit['pmid'])
        methods += ['pubmed-esummary', 'europepmc-record']
        if truth is None:
            return None, [f'PubMed has no record for PMID {cit["pmid"]}']
        if truth['doi']:
            methods += ['crossref', 'crossref-updates']
    if meta.get('printYear') and truth['year'] and meta['printYear'] != truth['year']:
        notes.append(f'Crossref issued {truth["year"]}, print {meta["printYear"]}')
    upd = update_record(truth['doi'], meta.get('pubmed'))
    verification['retraction'] = {'retracted': upd['retracted'], 'notices': upd['notices']}
    verification['updates'] = upd['updates']
    verification['workType'] = meta.get('workType')
    if cls == 'retracted' and not upd['retracted']:
        problems.append('class retracted but no retraction is recorded')
    if cls != 'retracted' and upd['retracted']:
        problems.append('paper is retracted')

    texts = S.source_texts(truth['doi']) if truth['doi'] else S.source_texts(pmid=truth['pmid'])
    full = bool(texts['sections'])
    if full:
        methods.append('europepmc-fulltext')
    rec = texts['record'] or {}

    # The paper a swapped identifier was meant to point to (DOI- or PMID-swap rows).
    alt_texts = None
    intended = c.get('truth') or {}
    intended_doi = (intended.get('doi') or '').lower() or None
    intended_pmid = str(intended.get('pmid') or '') or None
    swapped = cls == 'wrong-metadata' and (
        (intended_doi and intended_doi != truth['doi']) or (not cit['doi'] and intended_pmid and intended_pmid != truth['pmid']))
    if swapped:
        alt_texts = S.source_texts(intended_doi) if intended_doi else S.source_texts(pmid=intended_pmid)
        related = sorted(set(related) | {intended_doi or f'pmid:{intended_pmid}'})

    anchor_hits = S.find_quote(quote, texts)
    anchor_texts = texts
    if not anchor_hits and alt_texts:
        anchor_hits = S.find_quote(quote, alt_texts)
        anchor_texts = alt_texts
        if anchor_hits:
            notes.append('anchor found in the paper the written metadata describes')
    verification['anchorFoundIn'] = kinds(anchor_hits)
    if cls == 'misquote':
        if anchor_hits:
            problems.append('misquote anchor occurs verbatim')
    elif not anchor_hits:
        problems.append('anchor quote not found verbatim')

    evidence_text = None
    if cls == 'retracted':
        et = c.get('evidenceText') or {}
        evidence_text = {'section': et.get('section', 'abstract'), 'quote': S.norm(et.get('quote', ''))}
        hits = S.find_quote(evidence_text['quote'], texts)
        verification['evidenceFoundIn'] = kinds(hits)
        if not hits:
            problems.append('retracted evidenceText not found')
        elif evidence_text['section'] not in kinds(hits):
            evidence_text['section'] = kinds(hits)[0]
        if words(evidence_text['quote']) > 50:
            problems.append('evidenceText over 50 words')
        n = upd['notices']
        r0 = next((x for x in n if x['type'].lower() == 'retraction'), n[0] if n else None)
        if r0:
            ev = {'section': 'retraction-notice', 'quote': f'Crossref updated-by: {r0["type"]} notice {r0["doi"]} ({r0["source"]}, {r0["date"]}).'}
        else:
            ev = {'section': 'retraction-notice', 'quote': f'PubMed publication type: Retracted Publication (PMID {truth["pmid"]}).'}
    elif cls != 'wrong-metadata':
        restored = S.restore_markers(ev['quote'], texts)
        if restored != ev['quote']:
            notes.append('evidence citation markers restored from JATS')
            ev['quote'] = restored
        hits = S.find_quote(ev['quote'], texts)
        verification['evidenceFoundIn'] = kinds(hits)
        if not hits:
            problems.append('evidence quote not found verbatim')
        elif ev['section'] not in kinds(hits):
            notes.append(f'evidence section relabelled {ev["section"]} -> {kinds(hits)[0]}')
            ev['section'] = kinds(hits)[0]
        if words(ev['quote']) > 50:
            problems.append(f'evidence over 50 words ({words(ev["quote"])})')

    # ---- source windows (section 7 triggers are derived from these by the build)
    window_quote = ev['quote'] if cls == 'misquote' else quote
    windows, wsha = S.anchor_windows(window_quote, anchor_texts if cls != 'misquote' else texts)
    if not windows:
        problems.append('no source window could be located for the anchor')
    discussion_unmarked = [w for w in windows if w['section'] == 'discussion' and not w['citationMarker']]
    if cls == 'correct-support' and discussion_unmarked:
        problems.append('correct-support anchor occurs as an unmarked Discussion sentence (section 7 author-proposal): re-anchor in Results/Abstract')
    if cls in ('attributed-proposal', 'proposal-as-finding') and (not windows or len(discussion_unmarked) != len(windows)):
        problems.append(f'{cls} anchor must occur only as an unmarked Discussion sentence')

    if cls == 'secondary-citation':
        pub = rec.get('pubTypeList', {}).get('pubType', []) if isinstance(rec.get('pubTypeList'), dict) else []
        notes.append(f'source pubType: {", ".join(pub) if pub else "n/a"}')
        if not related:
            problems.append('secondary-citation rows must name the primary study (relatedIds)')
    for rid in related:
        if rid.startswith('pmid:'):
            if S.pubmed_summary(rid[5:]) is None:
                problems.append(f'related {rid} not in PubMed')
        elif S.crossref(rid) is None:
            problems.append(f'related DOI {rid} not found in Crossref')
    if cls == 'abstract-only-direction':
        if full:
            problems.append('abstract-only row but open full text exists')
        if 'abstract' not in verification['evidenceFoundIn']:
            problems.append('abstract-only evidence not in abstract')
    if cls == 'quote-cut-qualifier' and S.norm(quote) not in S.norm(ev['quote']):
        problems.append('quote-cut anchor not inside evidence sentence')

    # ---- citation as written vs the identifier's registered record
    d = diffs(cit, truth)
    if cls == 'wrong-metadata':
        verification['metadataMismatch'] = d
        if not d:
            problems.append('wrong-metadata row matches the registered record within tolerance')
        ident = truth['doi'] or f'PMID {truth["pmid"]}'
        parts = [f'{f} {truth.get(f)!r}' for f in d]
        ev = {'section': 'metadata', 'quote': (f'Registered record for {ident}: ' + '; '.join(parts))[:400]}
    else:
        if 'firstAuthor' in d:
            problems.append(f'first author as written ({first_author_of(cit["authors"])}) differs from the record ({truth["firstAuthor"]})')
        if 'year' in d:
            problems.append(f'year as written {cit["year"]} differs from the record {truth["year"]}')
        if 'pmid' in d:
            problems.append(f'PMID as written {cit["pmid"]} differs from the record {truth["pmid"]}')
        use_abbrev = bool(truth['journalAbbrev']) and title_key(truth['journalAbbrev']) != title_key(truth['journal']) \
            and int(hashlib.sha256(sentence.encode()).hexdigest()[:8], 16) % 3 == 0
        written_journal = cit['journal'] if title_key(cit['journal']) in (title_key(truth['journal']), title_key(truth['journalAbbrev'] or '')) else truth['journal']
        cit.update({'title': strip_retraction_marks(truth['title']), 'volume': truth['volume'], 'pages': truth['pages'],
                    'journal': truth['journalAbbrev'] if use_abbrev else written_journal})
        if cit['doi']:
            cit['doi'] = truth['doi']
        if abs(cit['year'] - truth['year']) > 1:
            cit['year'] = truth['year']
        if cit.get('issue') is None and meta.get('crossref', {}).get('issue'):
            cit['issue'] = meta['crossref']['issue']

    lic = rec.get('license')
    cr_lic = (meta.get('crossref') or {}).get('license') or []
    oa = rec.get('isOpenAccess') == 'Y'
    if lic:
        license_s = lic
    elif oa:
        license_s = 'free to read in Europe PMC; licence not stated' + (f' (Crossref: {cr_lic[0]})' if cr_lic else '')
    elif cr_lic:
        license_s = f'not open access in Europe PMC (Crossref licence: {cr_lic[0]}); abstract only used'
    else:
        license_s = 'not open access; abstract only used'
    pmcid = rec.get('pmcid')
    if pmcid and rec.get('inEPMC') == 'Y':
        url = f'https://europepmc.org/article/PMC/{pmcid}'
    elif truth['doi']:
        url = f'https://doi.org/{truth["doi"]}'
    else:
        url = f'https://europepmc.org/article/MED/{truth["pmid"]}'

    if c.get('notes'):
        notes.append(str(c['notes']))
    verification['notes'] = '; '.join(notes)[:800]
    row = {
        **carry, 'class': cls, 'domain': c['domain'], 'difficulty': c.get('difficulty', 'medium'),
        'input': {'sentence': sentence, 'quote': quote, 'citation': cit},
        'adjudication': {'factual': FACTUAL[cls], 'windows': windows, 'windowSha256': wsha},
        'evidence': ev,
        'evidenceText': evidence_text,
        'plant': '' if cls in ('correct-support', 'attributed-proposal') else S.norm(c.get('plant', '')),
        'truth': truth, 'relatedIds': related,
        'source': {'url': url, 'license': license_s, 'openAccess': oa, 'fullText': full},
        'verification': verification,
    }
    return (None if problems else row), problems


# ---------------------------------------------------------------- re-verification

def facts(row: dict) -> dict:
    v = row['verification']
    return {
        'registry': v['registry'],
        'retracted': v['retraction']['retracted'],
        'updates': sorted({u['type'].lower() for u in v.get('updates', [])}),
        'workType': v.get('workType'),
        'fullText': row['source']['fullText'],
        'metadataMismatch': sorted(v['metadataMismatch']),
        'windowSha256': row.get('adjudication', {}).get('windowSha256'),
        'anchorFound': bool(v['anchorFoundIn']),
        'evidenceFound': bool(v['evidenceFoundIn']),
    }


def check(paths: list[str], date: str) -> int:
    """Re-verify committed rows against today's APIs (cache bypassed). Exit 1 on any change or outage."""
    S.set_fresh(True)
    changed = unverified = n = 0
    for path in paths:
        for line in Path(path).read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            n += 1
            row, problems = verify(from_suite_row(r), date)
            if problems and problems[0].startswith('UNVERIFIED'):
                unverified += 1
                print(f"UNVERIFIED {r['id']} [{r['class']}] {problems[0]}")
                continue
            delta = []
            if row:
                before, after = facts(r), facts(row)
                delta = [f'{k}: {before[k]!r} -> {after[k]!r}' for k in after if k in before and before[k] != after[k]]
            if problems or delta:
                changed += 1
                print(f"CHANGED {r['id']} [{r['class']}] " + '; '.join(problems + delta))
    print(json.dumps({'checked': n, 'changed': changed, 'unverified': unverified}))
    return 1 if (changed or unverified) else 0


def main(argv: list[str]) -> int:
    if '--check' in argv:
        date = argv[argv.index('--date') + 1] if '--date' in argv else 'check'
        return check([a for a in argv[1:] if a.endswith('.jsonl')], date)
    date = argv[argv.index('--date') + 1]
    out = Path(argv[argv.index('--out') + 1])
    rej = Path(argv[argv.index('--rejects') + 1])
    if '--fresh' in argv:
        S.set_fresh(True)
    inputs = [a for i, a in enumerate(argv[1:], 1) if a.endswith('.jsonl') and argv[i - 1] not in ('--out', '--rejects')]
    good, bad = [], []
    sentences = set()
    for path in inputs:
        for n, line in enumerate(Path(path).read_text().splitlines(), 1):
            if not line.strip():
                continue
            c = json.loads(line)
            if 'input' in c:  # a committed suite row
                c = from_suite_row(c)
            row, problems = verify(c, date)
            key = S.norm(c.get('sentence', '')).lower()
            if key in sentences:
                problems.append('duplicate sentence')
                row = None
            sentences.add(key)
            tag = f'{Path(path).name}:{n}' + (f' {c["id"]}' if c.get('id') else '')
            if row is None:
                bad.append({'where': tag, 'problems': problems, 'candidate': c})
                print(f'REJECT {tag} [{c.get("class")}] ' + '; '.join(problems))
            else:
                good.append(row)
    out.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in good))
    rej.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in bad))
    by: dict[str, int] = {}
    for r in good:
        by[r['class']] = by.get(r['class'], 0) + 1
    print(json.dumps({'accepted': len(good), 'rejected': len(bad), 'byClass': dict(sorted(by.items()))}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
