"""Defence-in-depth scan. Public-only construction and exact byte parity are primary.

No text scanner proves absence of steganography in generated measurements.
All returned findings are redacted, including filenames (which can themselves leak).
"""
import hashlib
import json
import re
from pathlib import Path
from .blinding import canonical


def discovery_tokens(private):
    truth = private['answerKey']
    tokens = {canonical(truth).decode(), private['canary'], private['dataContract']['sealed_private']['hash']}
    for gene, value in truth.items():
        for field, v in value.items():
            tokens.add(canonical({gene: v}).decode()[1:-1])
            tokens.add(gene + '|' + field + '|' + canonical(v).decode())
            if field in ('labels', 'gates', 'theta', 'power'):
                tokens.add(canonical({field: v}).decode()[1:-1])
        tokens.add(gene + '|label|' + canonical(value['labels'][0]).decode())
    positives = sorted(g for g, t in truth.items() if t['kind'] == 'positive')
    if positives:
        tokens.add(canonical(positives).decode())
        tokens.add('positive-id-list|' + canonical(positives).decode())
    return tokens


class DiscoveryScanner:
    def __init__(self, tokens, w0_ids, plain_sha):
        self.tokens = sorted(t for t in tokens if len(t) >= 8)
        self.plain_sha = plain_sha
        self.positive_lists = [set(json.loads(t.split('|', 1)[1])) for t in tokens if t.startswith('positive-id-list|')]
        self.genes = set(re.findall(r'G\d{8,}', '\n'.join(self.tokens)))

    def hits(self, text):
        views, visited = [text], set()
        spans, strings = [], []
        decoder = json.JSONDecoder()

        def fragments(raw):
            if raw in visited:
                return
            visited.add(raw)
            # raw_decode handles a prose prefix, suffix, default spacing, and JSON in Markdown.
            end = -1
            for match in re.finditer(r'[\[{]', raw):
                if match.start() < end:
                    continue  # visit traverses this entire object, including escaped strings.
                try:
                    obj, end = decoder.raw_decode(raw, match.start())
                    if raw == text: spans.append((match.start(), end))
                    visit(obj)
                except (ValueError, RecursionError):
                    pass

        def visit(obj):
            if isinstance(obj, dict):
                views.append(canonical(obj).decode())
                for name, value in obj.items():
                    if isinstance(value, dict):
                        for field, v in value.items():
                            views.append(name + '|' + field + '|' + canonical(v).decode())
                    visit(value)
            elif isinstance(obj, list):
                views.append(canonical(obj).decode())
                for value in obj:
                    visit(value)
            elif isinstance(obj, str):
                views.append(obj)
                strings.append(obj)
                fragments(obj)

        fragments(text)
        normalized = '\n'.join(views)
        present = set(re.findall(r'G\d{8,}', normalized))
        found = ['protected token match' for t in self.tokens
                 if (not re.search(r'G\d{8,}', t) or set(re.findall(r'G\d{8,}', t)) <= present) and t in normalized]
        # JSON null/schema fields are not prose assertions. Structured leaks above
        # remain checked, while YAML and long prose have no arbitrary distance cap.
        prose = text
        for start, end in reversed(spans): prose = prose[:start] + ' ' + prose[end:]
        prose += '\n' + '\n'.join(s for s in strings if re.search(r'G\d{8,}', s))
        words = r'(?:L2|L3|insufficient|locus-level|direction-conflict|pharmacology-mismatch|no-effect|positive(?:s|[_ -]ids)?|hits|decoy|null|conflict|gates|sign|direction)'
        for gene in self.genes & present:
            # Same short textual assertion, in either order; no dependence on JSON keys.
            g = re.escape(gene)
            if re.search(rf'(?:{g}[\s\S]*?\b{words}\b|\b{words}\b[\s\S]*?{g}|{g}[\s:=|,]+[+-]?1\b)', prose, re.IGNORECASE):
                found.append('gene truth assertion')
        listed = set()
        for line in text.splitlines():
            # A prose heading may precede a bare list; collect contiguous ID-only lines.
            candidate = line.rsplit(':', 1)[-1].strip()
            if re.fullmatch(r"[\s\[\]\"',;-]*(?:G\d{8,}[\s\[\]\"',;-]*)+", candidate):
                listed.update(re.findall(r'G\d{8,}', candidate))
                if any(listed == ps for ps in self.positive_lists):
                    found.append('positive ID list')
            else:
                listed.clear()
        return found

    def scan_tree(self, root):
        bad = []
        for p in sorted(Path(root).rglob('*')):
            if p.is_symlink():
                bad.append('symlink: scan unavailable')
            elif p.is_file():
                raw = p.read_bytes()  # .enc is deliberately NOT exempt.
                if hashlib.sha256(raw).hexdigest() in self.plain_sha:
                    bad.append('plaintext copy of a sealed artifact')
                bad.extend(self.hits(p.name + '\n' + raw.decode('utf-8', 'ignore')))
        return bad
