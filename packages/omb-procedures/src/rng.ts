import { createHash } from 'node:crypto';

/**
 * xoshiro128** seeded from SHA-256 of a seed string. Deterministic and platform-independent.
 * Uniform doubles use 53 bits (two words). Integer draws use rejection (no modulo bias).
 */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  private spare = 0; private hasSpare = false;
  constructor(seed: string) {
    if (!seed) throw new Error('missing seed');
    const h = createHash('sha256').update(seed).digest();
    this.a = h.readUInt32LE(0); this.b = h.readUInt32LE(4); this.c = h.readUInt32LE(8); this.d = h.readUInt32LE(12);
    if ((this.a | this.b | this.c | this.d) === 0) this.d = 1;
  }
  /** Next 32-bit unsigned word. */
  word(): number {
    const b = this.b;
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    this.c ^= this.a; this.d ^= this.b; this.b ^= this.c; this.a ^= this.d; this.c ^= t; this.d = rotl(this.d, 11);
    return r;
  }
  /** Uniform on [0, 1) with 53 random bits. */
  uniform(): number {
    return ((this.word() >>> 5) * 67108864 + (this.word() >>> 6)) / 9007199254740992;
  }
  /** Uniform on (0, 1), never 0. */
  open(): number {
    let u = 0; do { u = this.uniform(); } while (u === 0); return u;
  }
  /** Uniform integer on [0, n), n <= 2^32. */
  int(n: number): number {
    if (n <= 1) return 0;
    const limit = Math.floor(4294967296 / n) * n;
    let v = this.word(); while (v >= limit) v = this.word();
    return v % n;
  }
  /** Standard normal (polar Box-Muller; pairs cached). */
  normal(): number {
    if (this.hasSpare) { this.hasSpare = false; return this.spare; }
    let u = 0, v = 0, s = 0;
    do { u = 2 * this.uniform() - 1; v = 2 * this.uniform() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m; this.hasSpare = true;
    return u * m;
  }
  /** Chi-square with integer df as a sum of squared normals. */
  chisqInt(df: number): number {
    let s = 0; for (let i = 0; i < df; i++) { const z = this.normal(); s += z * z; } return s;
  }
  /** Student t with integer df. */
  studentT(df: number): number {
    return this.normal() / Math.sqrt(this.chisqInt(df) / df);
  }
}
function rotl(x: number, k: number): number { return (x << k) | (x >>> (32 - k)); }

/** Hex SHA-256 of a string. */
export function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }
