#!/usr/bin/env python3
"""Public scholarly API client used to build and re-verify the PW4s citation suite.

Network use is limited to: Crossref REST (metadata, DOI agency, Retraction Watch `updated-by`),
Europe PMC REST (search, core record, open-access full-text JATS) and PubMed E-utilities.
Responses are cached under the package's gitignored `.cache/` directory (never committed) for at most
OMB_CITATION_CACHE_MAX_AGE_HOURS (default 24); OMB_CITATION_FRESH=1 / set_fresh() bypasses the cache.
Only definite answers count: HTTP 200 (present) or 404 (confirmed absent). Anything else raises
Unavailable, so an outage can never be read as "not registered" or "no full text".

This module is a build/audit tool. The suite's tests never import it and never touch the network.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get('OMB_CITATION_CACHE', str(PKG / '.cache')))
MAILTO = os.environ.get('OMB_CITATION_MAILTO', '')
UA = 'omerta-bio-citation-suite/0.1 (research audit tool)' + (f' mailto:{MAILTO}' if MAILTO else '')

ALLOWED_HOSTS = ('api.crossref.org', 'www.ebi.ac.uk', 'eutils.ncbi.nlm.nih.gov')

# Freshness: FRESH=True never reads the cache (re-verification must see today's records). Otherwise a
# cached answer older than MAX_AGE seconds is refetched. `now` is injectable for tests.
FRESH = os.environ.get('OMB_CITATION_FRESH') == '1'
MAX_AGE = float(os.environ.get('OMB_CITATION_CACHE_MAX_AGE_HOURS', '24')) * 3600
now = time.time
sleep = time.sleep


class Unavailable(RuntimeError):
    """A service did not give a definite answer (5xx, 429, timeout, network error, malformed body).

    Never treat this as evidence of absence: a DOI is "not registered" only on a definite 404."""


def set_fresh(value: bool = True) -> None:
    global FRESH
    FRESH = value


def _fetch(url: str, accept: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
    status, body = -1, b''
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read() or b''
            if e.code in (429, 500, 502, 503, 504):
                sleep(1.5 * (attempt + 1))
                continue
            return status, body
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            status, body = -1, b''
            sleep(1.5 * (attempt + 1))
    return status, body


def _get(url: str, *, kind: str, accept: str = 'application/json') -> tuple[int, bytes]:
    """Definite answers only: returns (200, body) or (404, body); raises Unavailable otherwise."""
    host = urllib.parse.urlparse(url).hostname
    if host not in ALLOWED_HOSTS:
        raise RuntimeError(f'host not allowed: {host}')
    key = hashlib.sha256(url.encode()).hexdigest()[:32]
    path = CACHE / kind / key
    meta = path.with_suffix('.meta')
    if not FRESH and path.exists() and meta.exists():
        try:
            m = json.loads(meta.read_text())
            if now() - float(m['fetchedAt']) <= MAX_AGE and m['status'] in (200, 404):
                return int(m['status']), path.read_bytes()
        except (ValueError, KeyError):
            pass
    status, body = _fetch(url, accept)
    if status not in (200, 404):
        raise Unavailable(f'{kind}: HTTP {status} for {url}')
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    tmp.write_bytes(body)
    os.replace(tmp, path)
    tmp = meta.with_name(f'{meta.name}.{os.getpid()}.tmp')
    tmp.write_text(json.dumps({'status': status, 'fetchedAt': now(), 'url': url}))
    os.replace(tmp, meta)
    return status, body


def _json(body: bytes, kind: str):
    try:
        return json.loads(body)
    except ValueError as e:
        raise Unavailable(f'{kind}: unparseable response') from e


# ---------------------------------------------------------------- Crossref

def crossref(doi: str) -> dict | None:
    st, body = _get(f'https://api.crossref.org/works/{urllib.parse.quote(doi, safe="/")}'
                    + (f'?mailto={MAILTO}' if MAILTO else ''), kind='crossref')
    if st == 404:
        return None
    return _json(body, 'crossref')['message']


def crossref_agency(doi: str) -> str | None:
    """Registration agency for ANY registered DOI (Crossref, DataCite, mEDRA...); None if unregistered."""
    st, body = _get(f'https://api.crossref.org/works/{urllib.parse.quote(doi, safe="/")}/agency', kind='agency')
    if st == 404:
        return None  # definite: the DOI handle does not exist at any registration agency
    return _json(body, 'agency')['message']['agency']['id']


def crossref_updates(doi: str) -> list[dict]:
    """Notices (retraction, correction, expression of concern...) that update `doi`."""
    st, body = _get('https://api.crossref.org/works?filter=updates:' + urllib.parse.quote(doi, safe='/')
                    + '&rows=50', kind='crossref-updates')
    if st != 200:
        raise Unavailable(f'crossref-updates: HTTP {st}')
    out = []
    for it in _json(body, 'crossref-updates')['message']['items']:
        for u in it.get('update-to') or []:
            if u.get('DOI', '').lower() == doi.lower():
                out.append({'notice': it.get('DOI'), 'type': u.get('type'), 'source': u.get('source'),
                            'date': (u.get('updated') or {}).get('date-time'), 'record': u.get('record-id')})
    return out


def retraction_status(doi: str) -> dict:
    """Retraction evidence from the work's `updated-by` (incl. Retraction Watch) and from notices."""
    msg = crossref(doi) or {}
    events = []
    for u in msg.get('updated-by') or []:
        events.append({'notice': u.get('DOI'), 'type': u.get('type'), 'source': u.get('source'),
                       'date': (u.get('updated') or {}).get('date-time'), 'record': u.get('record-id')})
    for e in crossref_updates(doi):
        if not any(x['notice'] == e['notice'] and x['type'] == e['type'] for x in events):
            events.append(e)
    retracted = any((e['type'] or '').lower() in ('retraction', 'removal', 'withdrawal') for e in events)
    return {'retracted': retracted, 'events': events}


def cr_summary(msg: dict) -> dict:
    authors = msg.get('author') or []
    first = authors[0] if authors else {}
    issued = (msg.get('issued') or {}).get('date-parts') or [[None]]
    published_print = (msg.get('published-print') or {}).get('date-parts') or [[None]]
    return {
        'doi': msg.get('DOI'),
        'title': (msg.get('title') or [''])[0],
        'journal': (msg.get('container-title') or [''])[0],
        'shortJournal': (msg.get('short-container-title') or [''])[0],
        'year': issued[0][0],
        'printYear': published_print[0][0],
        'volume': msg.get('volume'),
        'issue': msg.get('issue'),
        'pages': msg.get('page') or msg.get('article-number'),
        'firstAuthor': first.get('family') or first.get('name'),
        'authors': [(a.get('family') or a.get('name') or '') + (' ' + ''.join(p[0] for p in re.split(r'[\s.-]+', a.get('given', '')) if p) if a.get('given') else '') for a in authors[:12]],
        'nAuthors': len(authors),
        'type': msg.get('type'),
        'license': [l.get('URL') for l in msg.get('license') or []],
    }


# ---------------------------------------------------------------- Europe PMC

def epmc_search(query: str, page_size: int = 25) -> list[dict]:
    url = ('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize='
           + str(page_size) + '&query=' + urllib.parse.quote(query))
    st, body = _get(url, kind='epmc-search')
    if st != 200:
        raise Unavailable(f'epmc-search: HTTP {st}')
    data = _json(body, 'epmc-search')
    if 'resultList' not in data:
        raise Unavailable('epmc-search: no resultList in response')
    return data['resultList'].get('result', [])


def epmc_record(doi: str | None = None, pmid: str | None = None) -> dict | None:
    q = f'DOI:"{doi}"' if doi else f'EXT_ID:{pmid} AND SRC:MED'
    res = epmc_search(q, 5)
    for r in res:
        if doi and (r.get('doi') or '').lower() == doi.lower():
            return r
        if pmid and r.get('pmid') == str(pmid):
            return r
    return None


def epmc_fulltext(pmcid: str) -> bytes | None:
    st, body = _get(f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML',
                    kind='epmc-fulltext', accept='application/xml')
    if st == 404:
        return None  # definite: no open full text
    if not body.lstrip().startswith((b'<', b'<?')):
        raise Unavailable('epmc-fulltext: body is not XML')
    return body


# ---------------------------------------------------------------- PubMed

def pubmed_summary(pmid: str) -> dict | None:
    st, body = _get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id='
                    + urllib.parse.quote(str(pmid)), kind='pubmed')
    if st != 200:
        raise Unavailable(f'pubmed-esummary: HTTP {st}')
    data = _json(body, 'pubmed')
    if 'result' not in data and 'error' not in data:
        raise Unavailable('pubmed-esummary: no result in response')
    res = data.get('result', {})
    rec = res.get(str(pmid)) if str(pmid) in res.get('uids', []) else None
    return None if not rec or rec.get('error') else rec


def pubmed_by_doi(doi: str) -> list[str]:
    st, body = _get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term='
                    + urllib.parse.quote(f'{doi}[doi]'), kind='pubmed-search')
    if st != 200:
        raise Unavailable(f'pubmed-esearch: HTTP {st}')
    data = _json(body, 'pubmed-search')
    if 'esearchresult' not in data or 'ERROR' in data['esearchresult']:
        raise Unavailable('pubmed-esearch: no esearchresult')
    return data['esearchresult'].get('idlist', [])


# ---------------------------------------------------------------- text

_DASHES = dict.fromkeys(map(ord, '‐‑‒–—―−⁃﹣－'), '-')
_QUOTES = {ord('‘'): "'", ord('’'): "'", ord('‚'): "'", ord('‛'): "'",
           ord('“'): '"', ord('”'): '"', ord('„'): '"', ord('′'): "'"}


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKC', s).translate(_DASHES).translate(_QUOTES)
    s = s.replace(' ', ' ').replace(' ', ' ').replace(' ', ' ').replace(' ', ' ')
    s = re.sub(r'[​-‏⁠﻿]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s+([,.;:)\]])', r'\1', s)
    s = re.sub(r'([(\[])\s+', r'\1', s)
    return s


SECTION_KINDS = (
    ('abstract', ('abstract', 'summary')),
    ('introduction', ('intro', 'background')),
    ('methods', ('method', 'material', 'patients and', 'subjects', 'study design', 'experimental procedures', 'participants')),
    ('results', ('result', 'finding')),
    ('discussion', ('discussion', 'conclusion', 'interpretation', 'comment')),
)


def _kind(sec_type: str, title: str) -> str:
    t = (sec_type + ' ' + title).lower()
    for kind, keys in SECTION_KINDS:
        if any(k in t for k in keys):
            return kind
    return 'other'


def _text(el, drop_xref: bool) -> str:
    parts = []
    def walk(e):
        tag = e.tag.split('}')[-1] if isinstance(e.tag, str) else ''
        if tag in ('table-wrap', 'fig', 'table', 'disp-formula', 'ref-list', 'supplementary-material', 'label'):
            if e.tail:
                parts.append(e.tail)
            return
        if drop_xref and tag == 'xref' and e.get('ref-type') in ('bibr', 'fn', 'table-fn'):
            if e.tail:
                parts.append(e.tail)
            return
        if e.text:
            parts.append(e.text)
        for c in e:
            walk(c)
        if tag in BLOCK_TAGS:
            parts.append(' ')
        if e.tail and e is not el:
            parts.append(e.tail)
    walk(el)
    return norm(''.join(parts))


BLOCK_TAGS = {'p', 'title', 'sec', 'list-item', 'def-item', 'abstract', 'caption', 'boxed-text'}


def jats_sections(xml: bytes, drop_xref: bool = False) -> list[dict]:
    root = ET.fromstring(xml)
    out = []
    front = root.find('front')
    for ab in (front.iter('abstract') if front is not None else []):
        if ab.get('abstract-type') in ('graphical', 'teaser', 'toc'):
            continue
        out.append({'kind': 'abstract', 'title': 'Abstract', 'text': _text(ab, drop_xref)})
    body = root.find('body')
    if body is not None:
        top_kind = 'other'
        def secs(parent, inherited):
            for sec in parent.findall('sec'):
                title_el = sec.find('title')
                title = norm(''.join(title_el.itertext())) if title_el is not None else ''
                kind = _kind(sec.get('sec-type') or '', title)
                if kind == 'abstract':  # only the front-matter <abstract> is the abstract
                    kind = 'other'
                if kind == 'other':
                    kind = inherited
                paras = [p for p in sec if isinstance(p.tag, str) and p.tag in ('p', 'list', 'boxed-text')]
                text = ' '.join(_text(p, drop_xref) for p in paras)
                if text:
                    out.append({'kind': kind, 'title': title, 'text': text})
                secs(sec, kind)
        loose = [p for p in body if isinstance(p.tag, str) and p.tag == 'p']
        if loose:
            out.append({'kind': top_kind, 'title': '(body)', 'text': ' '.join(_text(p, drop_xref) for p in loose)})
        secs(body, top_kind)
    return out


def abstract_text(rec: dict | None) -> str:
    if not rec:
        return ''
    a = rec.get('abstractText') or ''
    a = re.sub(r'<[^>]+>', ' ', a)
    return norm(a)


def crossref_notices(update_type: str, query: str = '', rows: int = 20) -> list[dict]:
    """Discovery: notices of a type (retraction, expression_of_concern, correction) matching a query."""
    url = ('https://api.crossref.org/works?filter=update-type:' + urllib.parse.quote(update_type)
           + f'&rows={rows}' + ('&query=' + urllib.parse.quote(query) if query else ''))
    st, body = _get(url, kind='crossref-notices')
    if st != 200:
        raise Unavailable(f'crossref-notices: HTTP {st}')
    out = []
    for it in _json(body, 'crossref-notices')['message']['items']:
        for u in it.get('update-to') or []:
            out.append({'notice': it.get('DOI'), 'type': u.get('type'), 'updates': u.get('DOI'),
                        'source': u.get('source'), 'title': (it.get('title') or [''])[0]})
    return out


def _fulltext_id(rec: dict) -> str | None:
    if rec.get('pmcid') and rec.get('inEPMC') == 'Y':
        return rec['pmcid']
    # Preprints (source PPR) with Europe PMC full text are retrieved by their PPR id.
    if rec.get('source') == 'PPR' and rec.get('id') and rec.get('hasTextMinedTerms') == 'Y' and rec.get('isOpenAccess') == 'Y':
        return rec['id']
    return None


def source_texts(doi: str | None = None, pmid: str | None = None) -> dict:
    """All text available from Europe PMC for a DOI or PMID: abstract (always tried) and OA full text."""
    rec = epmc_record(doi=doi) if doi else epmc_record(pmid=pmid)
    out = {'record': rec, 'abstract': abstract_text(rec), 'sections': [], 'sections_noxref': []}
    ft = _fulltext_id(rec or {})
    if ft:
        xml = epmc_fulltext(ft)
        if xml:
            try:
                out['sections'] = jats_sections(xml)
                out['sections_noxref'] = jats_sections(xml, drop_xref=True)
            except ET.ParseError as e:
                raise Unavailable(f'epmc-fulltext: unparseable JATS for {ft}') from e
    return out


def find_quote(quote: str, texts: dict) -> list[dict]:
    """Where the (normalised) quote occurs: [{'kind','title','variant'}]."""
    q = norm(quote)
    hits = []
    for variant in ('sections', 'sections_noxref'):
        for s in texts[variant]:
            if q in s['text'] and not any(h['kind'] == s['kind'] and h['title'] == s['title'] for h in hits):
                hits.append({'kind': s['kind'], 'title': s['title'], 'variant': variant})
    if q in texts['abstract'] and not any(h['kind'] == 'abstract' for h in hits):
        hits.append({'kind': 'abstract', 'title': 'Abstract (Europe PMC record)', 'variant': 'record'})
    return hits


def restore_markers(quote: str, texts: dict) -> str:
    """A quote copied from marker-stripped text ("...respectively [].") mapped back to the source
    rendering with its citation markers ("...respectively [12].")."""
    q = norm(quote)
    if not re.search(r'\[\s*[,;\u2013-]*\s*\]|\(\s*[,;\u2013-]*\s*\)', q):
        return q
    parts = re.split(r'(\[\s*[,;\u2013-]*\s*\]|\(\s*[,;\u2013-]*\s*\))', q)
    rx = ''.join(re.escape(p) if i % 2 == 0 else (r'\[[^\]]{1,40}\]' if p.startswith('[') else r'\([^)]{1,60}\)') for i, p in enumerate(parts))
    for s in texts['sections']:
        m = re.search(rx, s['text'])
        if m:
            return m.group(0)
    return q


_BOUNDARY = re.compile(r'(?<=[.!?])\s+(?=[A-Z(\[])')


def sentences(text: str) -> list[str]:
    return [s for s in _BOUNDARY.split(text) if s]


def sentence_spans(text: str) -> list[tuple[int, int]]:
    spans, start = [], 0
    for m in _BOUNDARY.finditer(text):
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(text)))
    return [(a, b) for a, b in spans if b > a]


# Section 7 L5a contrast and hedging markers (exact list).
CONTRAST_MARKERS = ('however', 'but', 'contrary to', 'did not', 'no evidence', 'failed to', 'not supported')
_MARKER_RX = {m: re.compile(r'\b' + r'\s+'.join(map(re.escape, m.split())) + r'\b', re.I) for m in CONTRAST_MARKERS}
_EMPTY_REF = re.compile(r'\[\s*[,;\u2013-]*\s*\]|\(\s*[,;\u2013-]*\s*\)')
_VISIBLE_REF = re.compile(r'\[\s*\d[\d\s,;\u2013-]*\]|\(([A-Z][^()]{0,60}(et al\.?|and [A-Z][a-z]+),? \d{4}[a-z]?)\)')


def _markers(before: str, anchor: str, after: str) -> list[dict]:
    out = []
    for pos, seg in (('before', before), ('anchor', anchor), ('after', after)):
        for mk, rx in _MARKER_RX.items():
            if rx.search(seg):
                out.append({'marker': mk, 'position': pos})
    return out


def anchor_windows(quote: str, texts: dict) -> tuple[list[dict], str | None]:
    """Every location of `quote`: its section, the sentence before, its whole sentence(s), the sentence
    after; section 7 markers in that window; and whether a citation marker sits in its sentence(s).
    Returns (windows, sha256 of the folded window texts) - ([], None) when the quote is not found."""
    q = norm(quote)
    found = []  # (kind, text, xref_text or None, variant)
    noxref, withx = texts['sections_noxref'], texts['sections']
    for i, s in enumerate(noxref):
        if q in s['text']:
            found.append((s['kind'], s['text'], withx[i]['text'] if i < len(withx) else None, 'noxref'))
    for i, s in enumerate(withx):
        if q in s['text'] and not (i < len(noxref) and q in noxref[i]['text']):
            found.append((s['kind'], s['text'], s['text'], 'xref'))
    if q in texts['abstract']:
        found.append(('abstract', texts['abstract'], None, 'record'))
    windows, seen, parts = [], set(), []
    for kind, text, xref_text, variant in found:
        spans = sentence_spans(text)
        start = 0
        while True:
            pos = text.find(q, start)
            if pos < 0:
                break
            start = pos + 1
            cover = [i for i, (a, b) in enumerate(spans) if a < pos + len(q) and b > pos]
            i0, i1 = cover[0], cover[-1]
            before = text[spans[i0 - 1][0]:spans[i0 - 1][1]] if i0 > 0 else ''
            anchor = text[spans[i0][0]:spans[i1][1]]
            after = text[spans[i1 + 1][0]:spans[i1 + 1][1]] if i1 + 1 < len(spans) else ''
            key = (kind, anchor)
            if key in seen:
                continue
            seen.add(key)
            if variant == 'noxref':
                cit = bool(_EMPTY_REF.search(anchor))
                if not cit and xref_text is not None:
                    at = xref_text.find(anchor)
                    # An xref inside the sentence makes it non-verbatim in the rendered text; a
                    # superscript reference right after the final full stop belongs to it too.
                    cit = at < 0 or bool(re.match(r'\s?\d', xref_text[at + len(anchor):at + len(anchor) + 2]))
            elif variant == 'xref':
                cit = bool(_VISIBLE_REF.search(anchor))
            else:
                cit = bool(_EMPTY_REF.search(anchor) or _VISIBLE_REF.search(anchor))
            windows.append({'section': kind, 'citationMarker': cit, 'markers': _markers(before, anchor, after)})
            parts.append(f'{kind}\n{before}\n{anchor}\n{after}')
    if not windows:
        return [], None
    digest = hashlib.sha256('\n\n'.join(sorted(parts)).encode()).hexdigest()
    return windows, digest


# ---------------------------------------------------------------- CLI for research

def _show(doi: str, grep: str | None, kinds: set[str] | None, full: bool):
    msg = crossref(doi)
    print('CROSSREF', json.dumps(cr_summary(msg), ensure_ascii=False) if msg else 'NOT FOUND (agency=%s)' % crossref_agency(doi))
    print('RETRACTION', json.dumps(retraction_status(doi)) if msg else '-')
    t = source_texts(doi)
    rec = t['record'] or {}
    print('EPMC', {k: rec.get(k) for k in ('pmid', 'pmcid', 'isOpenAccess', 'inEPMC', 'license', 'pubYear', 'pubType')})
    print('ABSTRACT:', t['abstract'][:6000] if full or not grep else '')
    rx = re.compile(grep, re.I) if grep else None
    for s in t['sections_noxref']:
        if kinds and s['kind'] not in kinds:
            continue
        if rx:
            for sent in sentences(s['text']):
                if rx.search(sent):
                    print(f"  [{s['kind']}|{s['title'][:40]}] {sent}")
        elif full:
            print(f"\n## [{s['kind']}] {s['title']}\n{s['text']}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == 'show':
        doi = argv[2]
        grep = None
        kinds = None
        full = '--full' in argv
        if '--grep' in argv:
            grep = argv[argv.index('--grep') + 1]
        if '--kinds' in argv:
            kinds = set(argv[argv.index('--kinds') + 1].split(','))
        _show(doi, grep, kinds, full)
    elif cmd == 'search':
        for r in epmc_search(argv[2], int(argv[3]) if len(argv) > 3 else 25):
            print(r.get('pmcid') or '-', r.get('isOpenAccess'), r.get('license'), r.get('pubYear'), r.get('doi'), '|', (r.get('authorString') or '')[:30], '|', r.get('title'), '|', (r.get('journalInfo') or {}).get('journal', {}).get('title'))
    elif cmd == 'retraction':
        for d in argv[2:]:
            print(d, json.dumps(retraction_status(d)))
    elif cmd == 'agency':
        for d in argv[2:]:
            print(d, crossref_agency(d))
    elif cmd == 'quote':
        ident, quote = argv[2], argv[3]
        texts = source_texts(pmid=ident[5:]) if ident.startswith('pmid:') else source_texts(ident)
        print(json.dumps(find_quote(quote, texts)))
    elif cmd == 'pubmed':
        for pmid in argv[2:]:
            rec = pubmed_summary(pmid)
            if not rec:
                print(pmid, 'NO PUBMED RECORD')
                continue
            ids = {i['idtype']: i['value'] for i in rec.get('articleids', [])}
            print(pmid, '|', rec.get('sortfirstauthor'), '|', rec.get('pubdate'), '|', rec.get('fulljournalname'),
                  '|', rec.get('volume'), rec.get('pages'), '| doi', ids.get('doi'), '| pmc', ids.get('pmc'), '|', rec.get('title'))
            t = source_texts(pmid=pmid)
            print('  EPMC', {k: (t['record'] or {}).get(k) for k in ('pmid', 'pmcid', 'doi', 'isOpenAccess', 'inEPMC', 'license')},
                  '| fulltext sections:', len(t['sections']))
            print('  ABSTRACT:', t['abstract'][:3000])
    elif cmd == 'notices':
        for n in crossref_notices(argv[2], ' '.join(argv[3:])):
            print(n['type'], n['source'], 'notice', n['notice'], '-> updates', n['updates'], '|', n['title'][:100])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
