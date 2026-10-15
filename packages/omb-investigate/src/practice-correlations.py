"""Host-only Pearson oracle with pairwise-complete declared-join coverage."""
import sys
import numpy as np
m, n = map(int, sys.argv[1:])
x = np.frombuffer(sys.stdin.buffer.read(m*n*8), dtype='<f8').reshape(m, n).copy()
if np.isinf(x).any():
    raise ValueError('infinite practice audit feature')
# NaN is the host's unavailable-join marker, never a generated numeric value.
valid = np.isfinite(x)
mask = valid.astype(float)
x[~valid] = 0
scale = np.max(np.abs(x), axis=1, keepdims=True)
x /= np.where(scale > 0, scale, 1)
count = mask.sum(axis=1, keepdims=True)
x -= np.where(valid, x.sum(axis=1, keepdims=True) / np.maximum(count, 1), 0)
if valid.all():
    norm = np.sqrt(np.einsum('ij,ij->i', x, x)).reshape(m, 1)
    x /= np.where(norm > 1e-13, norm, 1)
    x[norm[:, 0] < 1e-13] = 0
    result = x @ x.T
    counts = np.full((m, m), n, dtype=float)
else:
    counts = mask @ mask.T
    totals = x @ mask.T
    squares = (x*x) @ mask.T
    variance = np.maximum(0, squares - totals*totals/np.maximum(counts, 1))
    covariance = x @ x.T - totals*totals.T/np.maximum(counts, 1)
    denominator = np.sqrt(variance*variance.T)
    result = np.divide(covariance, denominator, out=np.zeros_like(covariance), where=denominator>1e-13)
result = np.clip(result, -1, 1)
sys.stdout.buffer.write(result.astype('<f8', copy=False).tobytes())
sys.stdout.buffer.write(counts.astype('<f8', copy=False).tobytes())
