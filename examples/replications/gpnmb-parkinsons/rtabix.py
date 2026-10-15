"""Remote tabix slice: fetch only the BGZF blocks of one region over HTTP Range requests.

usage: python rtabix.py URL TBI_URL CHROM START END OUT [--header-lines N]
START/END are 1-based inclusive. Writes header lines (meta lines from the first block, or the
first `skip` lines declared by the index) followed by every data line whose chromosome equals
CHROM and whose position column lies in [START, END], in file order. Prints byte counts.
"""
import gzip
import struct
import sys
import urllib.request
import zlib

UA = {'User-Agent': 'omerta-bio-curation/1', 'Accept-Encoding': 'identity'}


def get(url, start=None, end=None):
    headers = dict(UA)
    if start is not None:
        headers['Range'] = f'bytes={start}-{end}'
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        if start is not None and r.status != 206:
            raise SystemExit(f'server ignored Range (status {r.status})')
        return data


def parse_tbi(raw):
    data = gzip.decompress(raw)
    assert data[:4] == b'TBI\x01', 'not a tabix index'
    n_ref, fmt, col_seq, col_beg, col_end, meta, skip, l_nm = struct.unpack_from('<8i', data, 4)
    off = 36
    names = data[off:off + l_nm].split(b'\x00')[:n_ref]
    off += l_nm
    refs = []
    for _ in range(n_ref):
        (n_bin,) = struct.unpack_from('<i', data, off); off += 4
        bins = {}
        for _ in range(n_bin):
            b, n_chunk = struct.unpack_from('<Ii', data, off); off += 8
            chunks = []
            for _ in range(n_chunk):
                cb, ce = struct.unpack_from('<QQ', data, off); off += 16
                chunks.append((cb, ce))
            bins[b] = chunks
        (n_intv,) = struct.unpack_from('<i', data, off); off += 4
        ioff = list(struct.unpack_from(f'<{n_intv}Q', data, off)); off += 8 * n_intv
        refs.append((bins, ioff))
    return {'names': [n.decode() for n in names], 'refs': refs, 'col_seq': col_seq, 'col_beg': col_beg,
            'col_end': col_end, 'meta': chr(meta), 'skip': skip, 'fmt': fmt}


def reg2bins(beg, end):
    """0-based half-open [beg, end)."""
    end -= 1
    bins = [0]
    for shift, base in ((26, 1), (23, 9), (20, 73), (17, 585), (14, 4681)):
        bins.extend(range(base + (beg >> shift), base + (end >> shift) + 1))
    return bins


def bgzf_blocks(buf):
    """Yield (compressed offset within buf, decompressed bytes) for each complete BGZF block."""
    pos = 0
    while pos + 18 <= len(buf):
        if buf[pos:pos + 4] != b'\x1f\x8b\x08\x04':
            raise SystemExit('not a BGZF block')
        xlen = struct.unpack_from('<H', buf, pos + 10)[0]
        bsize = None
        x = pos + 12
        while x < pos + 12 + xlen:
            si1, si2, slen = buf[x], buf[x + 1], struct.unpack_from('<H', buf, x + 2)[0]
            if si1 == 66 and si2 == 67:
                bsize = struct.unpack_from('<H', buf, x + 4)[0] + 1
            x += 4 + slen
        if bsize is None or pos + bsize > len(buf):
            return
        cdata = buf[pos + 12 + xlen: pos + bsize - 8]
        yield pos, zlib.decompress(cdata, -15)
        pos += bsize


def main():
    url, tbi_url, chrom, start, end, out = sys.argv[1:7]
    start, end = int(start), int(end)
    tbi_raw = get(tbi_url)
    idx = parse_tbi(tbi_raw)
    tid = idx['names'].index(chrom)
    bins, ioff = idx['refs'][tid]
    beg0, end0 = start - 1, end
    min_off = ioff[min(beg0 >> 14, len(ioff) - 1)] if ioff else 0
    chunks = sorted(c for b in reg2bins(beg0, end0) for c in bins.get(b, []) if c[1] > min_off)
    merged = []
    for cb, ce in chunks:
        cb = max(cb, min_off)
        if merged and cb <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], ce))
        else:
            merged.append((cb, ce))
    # header from the first block(s)
    head = get(url, 0, 65535 * 2)
    first = b''.join(d for _, d in bgzf_blocks(head))
    header_lines = []
    for i, line in enumerate(first.split(b'\n')):
        if line.startswith(idx['meta'].encode()) or i < idx['skip']:
            header_lines.append(line)
        else:
            break
    fetched = len(head) + len(tbi_raw)
    lines_out = []
    cs, cbeg = idx['col_seq'] - 1, idx['col_beg'] - 1
    for vb, ve in merged:
        c0, u0 = vb >> 16, vb & 0xFFFF
        c1, u1 = ve >> 16, ve & 0xFFFF
        buf = get(url, c0, c1 + 65536 + 28)
        fetched += len(buf)
        data = bytearray()
        for p, d in bgzf_blocks(buf):
            coff = c0 + p
            lo = u0 if coff == c0 else 0
            if coff == c1:
                data += d[lo:u1]
                break
            if coff > c1:
                break
            data += d[lo:]
        text = bytes(data)
        for line in text.split(b'\n'):
            if not line or line.startswith(idx['meta'].encode()):
                continue
            f = line.split(b'\t')
            if f[cs].decode() != chrom:
                continue
            pos = int(f[cbeg])
            if start <= pos <= end:
                lines_out.append((pos, line))
    # chunks are processed in file order; keep it (stable)
    opener = (lambda o: gzip.GzipFile(o, 'wb', compresslevel=6, mtime=0)) if out.endswith('.gz') else (lambda o: open(o, 'wb'))
    with opener(out) as fh:
        for h in header_lines:
            fh.write(h + b'\n')
        for _, line in lines_out:
            fh.write(line + b'\n')
    print(f'fetched_bytes={fetched} header_lines={len(header_lines)} rows={len(lines_out)} chunks={len(merged)}')


if __name__ == '__main__':
    main()
