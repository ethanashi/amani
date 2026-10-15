/** A deliberately small, bounded portable grammar. Never executes a full untrusted pattern or matches against data. */
export function safeUnitRegex(pattern: string): boolean {
  if (pattern.length > 512 || !pattern.startsWith('^') || !pattern.endsWith('$')) return false;
  let i = 1, captures = 0, inside = false, captureAtoms = 0, width = 0, variableAtoms = 0;
  while (i < pattern.length - 1) {
    const c = pattern[i]!;
    if (c === '(') { if (inside || captures++) return false; inside = true; i++; continue; }
    if (c === ')') { if (!inside || !captureAtoms) return false; inside = false; i++; continue; }
    if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) return false;
      const body = pattern.slice(i + 1, end);
      // Explicit ASCII sets only: no negation, escapes or complementary classes.
      if (!/^[A-Za-z0-9_:-]+$/.test(body)) return false;
      // Ranges must stay inside one of the permitted contiguous ASCII runs.
      for (let j = 1; j < body.length - 1; j++) if (body[j] === '-') {
        const a = body.charCodeAt(j - 1), b = body.charCodeAt(j + 1);
        if (a > b || ![[48,57],[65,90],[97,122],[45,45],[58,58],[95,95]].some(([lo,hi]) => a >= lo! && b <= hi!)) return false;
        j++;
      }
      i = end + 1;
    } else if (c === '\\' && ['-', '_', '.'].includes(pattern[i + 1] ?? '')) i += 2;
    else if (/[A-Za-z0-9_:-]/.test(c)) i++;
    else return false;
    if (inside) captureAtoms++;
    let min = 1, max = 1;
    if (pattern[i] === '{') {
      const match = /^\{([0-9]{1,3})(?:,([0-9]{1,3}))?\}/.exec(pattern.slice(i));
      if (!match) return false;
      min = Number(match[1]); max = Number(match[2] ?? match[1]); i += match[0].length;
      if (min < 1 || max < min || max > 256) return false;
    }
    // One variable repetition globally prevents overlapping-repeat backtracking.
    if (min !== max && ++variableAtoms > 1) return false;
    width += max;
    if (width > 512) return false;
  }
  return captures === 1 && !inside;
}
