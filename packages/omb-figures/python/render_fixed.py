"""Fixed matplotlib backends for authenticated PW3b export payloads.

Called only by the TS certified adapter. This module never fits statistics or clusters.
The public product API accepts a FactStore, not Python data or executable plotting code.
"""
import base64
import io
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('MPLCONFIGDIR', str(ROOT/'python/.cache'))
os.environ.setdefault('SOURCE_DATE_EPOCH', '0')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
from adjustText import adjust_text
import marsilea as ma

for font in (ROOT/'vendor/fonts').glob('*.ttf'):
    font_manager.fontManager.addfont(str(font))
plt.style.use(str(ROOT/'python/amani-biomed.mplstyle'))
# All three survey-verified settings, plus a seed and an iteration limit for adjustText.
matplotlib.rcParams['svg.hashsalt'] = 'amani-pw3b-v1'
matplotlib.rcParams['svg.fonttype'] = 'none'


def render(payload):
    np.random.seed(0)
    kind = payload['kind']
    data = payload['data']
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    if kind == 'volcano':
        x, p = np.array(data['effects']), np.array(data['pValues'])
        y = -np.log10(p)
        threshold = data['threshold']
        colours = np.where(p < threshold, np.where(x > 0, '#0072b2', '#e69f00'), '#777777')
        ax.scatter(x, y, c=colours, s=18, edgecolors='black', linewidths=.3)
        ax.axhline(-np.log10(threshold), linestyle='--', color='black', linewidth=.6)
        ax.axvline(0, linestyle='--', color='black', linewidth=.6)
        indices = sorted(range(len(p)), key=lambda i: (p[i], i))[:8]
        labels = [ax.text(x[i], y[i], data['labels'][i]) for i in indices]
        # No wall-clock limit: identical bounded work on fast and slow machines.
        adjust_text(labels, ax=ax, iter_lim=100, ensure_inside_axes=True,
                    arrowprops=dict(arrowstyle='-', color='black', lw=.4))
        ax.set(xlabel='Certified effect', ylabel='−log₁₀ adjusted P')
    elif kind == 'umap':
        x,y=np.array(data['x']),np.array(data['y'])
        groups=np.array(data['groups'])
        for i, name in enumerate(data['labels']):
            keep=groups==i
            ax.scatter(x[keep],y[keep],s=8,c=['#0072b2','#e69f00','#000000','#cc79a7'][i],rasterized=True)
            ax.text(float(np.mean(x[keep])),float(np.mean(y[keep])),name)
        ax.set(xlabel='UMAP 1',ylabel='UMAP 2')
    elif kind == 'heatmap':
        plt.close(fig)
        # Rows/columns arrive in certified order. Never call add_dendrogram/group/sort.
        matrix=np.array(data['matrix'])
        board=ma.Heatmap(matrix, cmap='cividis', width=4, height=3)
        board.render()
        fig=board.figure
    else:
        raise ValueError('Unknown fixed template')
    if kind != 'heatmap':
        ax.set_title(data['title'])
        fig.tight_layout()
    output=io.StringIO()
    fig.savefig(output,format='svg',metadata={'Date':None,'Creator':'Amani PW3b'})
    plt.close(fig)
    svg=output.getvalue()
    fonts=''.join("@font-face{font-family:'Liberation "+family+"';src:url(data:font/ttf;base64,"+base64.b64encode((ROOT/f'vendor/fonts/Liberation{family}-Regular.ttf').read_bytes()).decode()+") format('truetype');}" for family in ['Sans','Serif'])
    svg=svg.replace('<defs>','<defs><style>'+fonts+'</style>',1)
    # Exact source payload in SVG metadata; verifier regenerates from authenticated inputs.
    import html
    svg=svg.replace('</svg>','<metadata id="amani-source">'+html.escape(json.dumps(payload,sort_keys=True,separators=(',',':')))+'</metadata></svg>')
    return svg

if __name__ == '__main__':
    sys.stdout.write(render(json.load(sys.stdin)))
