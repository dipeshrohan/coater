"""
The pool on tetrahedra against OpenFOAM (pooltet.js compare's out.json): the speed on the plane through a pipe's axis
(the app's tetrahedra, OpenFOAM, their difference), the cross-width flow 15 mm above the web, the flow down a bore against
Poiseuille's exact profile, and each mesh's RMS difference from OpenFOAM by region.
usage: python3 pooltet_plot.py <compare out.json> <out.png>
"""
import json, sys
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
import matplotlib.tri as mtri

R, OUT = json.load(open(sys.argv[1])), sys.argv[2]
INK, MUTED = '#18181b', '#71717a'
COL_OF, PAL = '#18181b', ['#2563eb', '#d97706', '#0891b2', '#7c3aed']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'axes.edgecolor': MUTED, 'axes.labelcolor': INK,
                     'xtick.color': MUTED, 'ytick.color': MUTED, 'axes.titlesize': 10, 'axes.titleweight': 'bold'})

def colour(j):
    return PAL[j % len(PAL)]
def dash(S):
    return '--' if S['name'].startswith('hex') else '-'

fig = plt.figure(figsize=(15, 8.4), constrained_layout=True)
gs = fig.add_gridspec(2, 3, height_ratios=[1, 1.05])
P = np.array(R['plane'])
tri = mtri.Triangulation(P[:, 0] * 1e3, P[:, 1] * 1e3)
# (drop the triangles bridging the pipe's wall: any side longer than 6 mm)
xy = np.c_[P[:, 0], P[:, 1]] * 1e3; t = tri.triangles
tri.set_mask(np.max([np.hypot(*(xy[t[:, a]] - xy[t[:, b]]).T) for a, b in ((0, 1), (1, 2), (2, 0))], axis=0) > 6)
hi = np.percentile(np.r_[P[:, 2], P[:, 3]], 99.5) * 1e3
for i, (col, name) in enumerate(((2, 'The app: P2–P1 tetrahedra'), (3, 'OpenFOAM v1912: the tetrahedra split in 8'))):
    ax = fig.add_subplot(gs[0, i])
    im = ax.tricontourf(tri, np.minimum(P[:, col] * 1e3, hi), levels=np.linspace(0, hi, 21), cmap='viridis')
    ax.set_title(name, loc='left'); ax.set_xlabel('x along the web (mm)'); ax.set_ylabel('y up from the web (mm)'); ax.set_aspect('equal')
    cb = plt.colorbar(im, ax=ax, shrink=0.8, pad=0.02); cb.set_label('speed (mm/s)', fontsize=8)
ax = fig.add_subplot(gs[0, 2])
d = (P[:, 2] - P[:, 3]) * 1e3; dl = np.percentile(np.abs(d), 99.5)
im = ax.tricontourf(tri, np.clip(d, -dl, dl), levels=np.linspace(-dl, dl, 21), cmap='RdBu_r')
ax.set_title('App − OpenFOAM', loc='left'); ax.set_xlabel('x along the web (mm)'); ax.set_aspect('equal')
cb = plt.colorbar(im, ax=ax, shrink=0.8, pad=0.02); cb.set_label('mm/s', fontsize=8)

# the cross-width flow
L = R['lines']; z = np.array([p[2] for p in L['pts']['w']['pts']]) * 1e3
ax = fig.add_subplot(gs[1, 0])
of = np.array([np.nan if v is None else v for v in L['openfoam']['w']], float) * 1e3
ax.plot(z, of, color=COL_OF, lw=2.2, label='OpenFOAM')
for j, S in enumerate(L['solutions']):
    if S.get('w') is None: continue
    ax.plot(z, np.array([np.nan if v is None else v for v in S['w']], float) * 1e3, color=colour(j), lw=1.4, ls=dash(S), label='the app: ' + S['name'].split(' (')[0])
for zp in (37.5, 112.5): ax.axvline(zp, color=MUTED, lw=0.6, ls=':')
ax.axhline(0, color=MUTED, lw=0.5)
ax.set_title('Cross-width flow w, 15 mm up, x = −115 mm', loc='left')
ax.set_xlabel('z across the web (mm; pipes at 37.5 and 112.5)'); ax.set_ylabel('w (mm/s)'); ax.legend(frameon=False, fontsize=7, loc='upper left')

# down the bore, where its flow is developed: Poiseuille's exact profile, OpenFOAM's cells, the app
ax = fig.add_subplot(gs[1, 1])
xb = (np.array([p[0] for p in L['pts']['bore']['pts']]) + 0.1) * 1e3; Pz = R['poiseuille']
xe = np.linspace(-5, 5, 201); ax.plot(xe, Pz['peak'] * (1 - (xe / 5) ** 2) * 1e3, color=MUTED, lw=3, alpha=0.45, label="Poiseuille (exact)")
ax.plot(xb, -np.array([np.nan if v is None else v for v in L['openfoam']['bore']], float) * 1e3, color=COL_OF, lw=1.6, drawstyle='steps-mid', label=f"OpenFOAM (off {Pz['openfoam']['rms'] * 100:.1f} % RMS)")
for j, S in enumerate(L['solutions']):
    if S.get('bore') is None: continue
    ax.plot(xb, -np.array([np.nan if v is None else v for v in S['bore']], float) * 1e3, color=colour(j), lw=1.3, ls=dash(S), label=f"{S['name'].split(' (')[0]} (off {Pz['solutions'][j]['rms'] * 100:.2f} %)")
ax.set_title('Down a bore, 60 mm up (30 mm above the tip)', loc='left'); ax.set_xlabel('x across the bore (mm)'); ax.set_ylabel('downward speed (mm/s)')
ax.set_ylim(bottom=0); ax.legend(frameon=False, fontsize=7, loc='lower center')

# the RMS by region
ax = fig.add_subplot(gs[1, 2])
regs = list(R['solutions'][0]['regions'].keys())
short = [('everywhere' if r.startswith('everywhere') else 'pool' if r.startswith('the pool') else 'bores' if r.startswith('in the bores')
          else 'round\npipes' if r.startswith('round the pipes') else 'under\nblade') for r in regs]
w = 0.8 / len(R['solutions'])
for j, S in enumerate(R['solutions']):
    v = [S['regions'][r]['uRms'] * 100 for r in regs]
    xs = np.arange(len(regs)) + (j - (len(R['solutions']) - 1) / 2) * w
    ax.bar(xs, v, w * 0.9, color=colour(j), label=S['name'].split(' (')[0], hatch='//' if S['name'].startswith('hex') else None, edgecolor='white', lw=0)
    for x, y in zip(xs, v): ax.text(x, y * 1.08, f'{y:.2f}', ha='center', va='bottom', fontsize=6, color=INK, rotation=90)
ax.set_yscale('log'); ax.set_ylim(0.03, 40)
ax.set_xticks(np.arange(len(regs))); ax.set_xticklabels(short, fontsize=8); ax.set_ylabel('velocity RMS off OpenFOAM (% of its largest speed)')
ax.set_title(f"Off OpenFOAM by region ({R['cells']:,} cells)", loc='left'); ax.legend(frameon=False, fontsize=7, loc='upper left')
fig.suptitle('The pool with two pipes feeding it (half the 300 mm pool, 10.5 Pa·s), on tetrahedra, on the block mesh and in OpenFOAM', x=0.01, ha='left', fontweight='bold')
fig.savefig(OUT, dpi=130)
print('wrote', OUT)
