"""
The benchmark's figures: the 2D heat and stress fields (the app, OpenFOAM, their difference on one scale) and how the
differences fall as OpenFOAM's mesh is refined (the coating flow, the heat, the stress).
usage: python3 plot_bench.py <work dir> <out dir>   (the work dir holding the runs, as README's commands leave them)
"""
import json, os, sys
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

W, OUT = sys.argv[1], sys.argv[2]
INK, MUTED, GRID = '#18181b', '#71717a', '#e4e4e7'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'axes.edgecolor': MUTED, 'axes.labelcolor': INK,
                     'xtick.color': MUTED, 'ytick.color': MUTED, 'axes.titlesize': 10, 'axes.titleweight': 'bold'})

def grid2d(rows, val):
    """rows of (x, y, ...) at cell centres on a box grid -> X, Y, V arrays (ny, nx)"""
    xs = np.unique(np.round([r[0] for r in rows], 9)); ys = np.unique(np.round([r[1] for r in rows], 9))
    V = np.full((len(ys), len(xs)), np.nan); ix = {v: i for i, v in enumerate(xs)}; iy = {v: i for i, v in enumerate(ys)}
    for r in rows: V[iy[round(r[1], 9)], ix[round(r[0], 9)]] = val(r)
    return xs, ys, V

def triple(ax3, xs, ys, A, F, unit, title, cmap='inferno', sx=1e3, sy=1e3, aspect='auto'):
    lo, hi = np.nanmin([A.min(), F.min()]), np.nanmax([A.max(), F.max()]); D = A - F; dl = np.nanmax(np.abs(D)) or 1
    for ax, M, name, cm, vmin, vmax in ((ax3[0], A, 'App (mp-core.js)', cmap, lo, hi), (ax3[1], F, 'OpenFOAM v1912', cmap, lo, hi), (ax3[2], D, 'App − OpenFOAM', 'RdBu_r', -dl, dl)):
        im = ax.pcolormesh(xs * sx, ys * sy, M, cmap=cm, vmin=vmin, vmax=vmax, shading='nearest')
        ax.set_title(name, loc='left'); ax.set_aspect(aspect); ax.tick_params(labelsize=8)
        cb = plt.colorbar(im, ax=ax, shrink=0.85, pad=0.02); cb.set_label(unit, fontsize=8); cb.ax.tick_params(labelsize=7)
    ax3[0].set_ylabel(title)

# ---- heat (2D): temperature at the last time, and at the first
H = json.load(open(f'{W}/heat/app2d_r2.json')); HF = json.load(open(f'{W}/heat/of2d_r2/of.json'))
fig, axs = plt.subplots(2, 3, figsize=(15, 5.2), constrained_layout=True)
for row, t in enumerate(['10', '1200']):
    key = lambda r: (round(r[0], 9), round(r[1], 9))
    fmap = {key(r): r[2] for r in HF['snaps'][t]}
    xs, ys, A = grid2d(H['snaps'][t], lambda r: r[2]); _, _, F = grid2d(HF['snaps'][t], lambda r: r[2])
    triple(axs[row], xs, ys, A, F, '°C', f't = {t} s\ny (mm)')
    for ax in axs[row]: ax.axhline(5, color='w', lw=0.5, ls=':'); ax.axhline(7, color='w', lw=0.5, ls=':')
for ax in axs[1]: ax.set_xlabel('x (mm)')
fig.suptitle('Heat: three-layer stack (plate 0–5 mm, film 5–7 mm, paper 7–8 mm), hot air over x < 30 mm of the top (2D)', x=0.01, ha='left', fontweight='bold')
fig.savefig(f'{OUT}/heat_2d.png', dpi=110); plt.close(fig)

# ---- stress (2D): sigma_xx and the vertical displacement
S = json.load(open(f'{W}/stress/app2d_r2.json')); SF = json.load(open(f'{W}/stress/of2d_r2/of.json'))
fig, axs = plt.subplots(2, 3, figsize=(15, 4.6), constrained_layout=True)
xs, ys, A = grid2d([[*r['x'], r] for r in S['rows']], lambda r: r[2]['s'][0] / 1e6); _, _, F = grid2d([[*r['x'], r] for r in SF['rows']], lambda r: r[2]['s'][0] / 1e6)
triple(axs[0], xs, ys, A, F, 'MPa', 'σxx\ny (mm)', cmap='RdBu_r', aspect='equal')
xs, ys, A = grid2d([[*r['x'], r] for r in S['rows']], lambda r: r[2]['u'][1] * 1e6); _, _, F = grid2d([[*r['x'], r] for r in SF['rows']], lambda r: r[2]['u'][1] * 1e6)
triple(axs[1], xs, ys, A, F, 'µm', 'vertical displacement\ny (mm)', cmap='viridis', aspect='equal')
for ax in axs[1]: ax.set_xlabel('x (mm)')
fig.suptitle('Thermal stress: aluminium block clamped below, its top at 100 sin(πx/L) °C (2D, plane strain, 2,000 cells)', x=0.01, ha='left', fontweight='bold')
fig.savefig(f'{OUT}/stress_2d.png', dpi=110); plt.close(fig)


# ---- coating flow (2D): the pressure along the web and the speed across the gap, the app and OpenFOAM's three meshes
d = json.load(open(f'{W}/d2_steady.json')); NC, NR, NL = d['NC'], d['NR'], d['NL']
fig, axs = plt.subplots(1, 2, figsize=(15, 3.8), constrained_layout=True)
cols = {'d2s_r0': '#a1a1aa', 'd2s_r1': '#52525b', 'd2s_r2': '#18181b'}
for case, lab in (('d2s_r0', 'OpenFOAM 1,584 cells'), ('d2s_r1', 'OpenFOAM 6,336 cells'), ('d2s_r2', 'OpenFOAM 25,344 cells')):
    z = np.load(f'{W}/{case}/compare_nodes.npz'); idx = z['idx']; k = idx % NR; c = idx // (NL * NR)
    sel = k == 1; o = np.argsort(c[sel]); x = z['X'][sel][o][:, 0] * 1e3
    axs[0].plot(x, z['of_p'][sel][o], color=cols[case], lw=1.4, label=lab)
    if case == 'd2s_r2': axs[0].plot(x, z['app_p'][sel][o], color='#2563eb', lw=2.2, ls=(0, (5, 3)), label='App (cfd-fem.js, Q2–Q1 FEM)')
axs[0].axvline(d['xe'] * 1e3, color=MUTED, lw=0.8, ls=':'); axs[0].text(d['xe'] * 1e3, axs[0].get_ylim()[1], ' metering edge', color=MUTED, fontsize=8, va='top')
axs[0].set_xlabel('x along the web (mm)'); axs[0].set_ylabel('p + ρgy next to the web (Pa)'); axs[0].set_title('Pressure along the web', loc='left')
axs[0].grid(True, color=GRID, lw=0.6); axs[0].legend(frameon=False, fontsize=8)
# the speed across the gap at three stations
z = np.load(f'{W}/d2s_r2/compare_nodes.npz'); idx = z['idx']; c = idx // (NL * NR)
for cc, colr in ((40, '#0d9488'), (70, '#7c3aed'), (110, '#ea580c')):
    sel = c == cc; o = np.argsort(z['X'][sel][:, 1]); y = z['X'][sel][o][:, 1] * 1e3; xpos = z['X'][sel][0, 0] * 1e3
    axs[1].plot(z['of_u'][sel][o] * 1e3, y, color=colr, lw=1.6, label=f'OpenFOAM, x = {xpos:.1f} mm')
    axs[1].plot(z['app_u'][sel][o] * 1e3, y, color=colr, lw=0, marker='o', ms=4, mfc='white', label=f'App, x = {xpos:.1f} mm')
axs[1].set_xlabel('u (mm/s)'); axs[1].set_ylabel('y above the web (mm)'); axs[1].set_title('Speed across the gap and the film (25,344 cells)', loc='left')
axs[1].grid(True, color=GRID, lw=0.6); axs[1].legend(frameon=False, fontsize=7.5, ncol=1)
fig.suptitle('Coating flow (2D, the steady flow curve): the app against OpenFOAM simpleFoam on the same domain', x=0.01, ha='left', fontweight='bold')
fig.savefig(f'{OUT}/flow_2d.png', dpi=110); plt.close(fig)

# ---- convergence: the RMS difference as OpenFOAM's mesh is refined
conv = json.load(open(f'{W}/convergence.json'))
from matplotlib.ticker import FixedLocator, FuncFormatter, NullLocator, LogLocator
PAL = ['#2563eb', '#ea580c', '#0d9488']     # fixed order: the first series of each panel blue, then orange, teal
fig, axs = plt.subplots(1, 3, figsize=(15, 3.8), constrained_layout=True)
for ax, (name, series) in zip(axs, conv.items()):
    ends = []
    for i, (lab, pts) in enumerate(series.items()):
        c = np.array(pts); ax.loglog(c[:, 0], c[:, 1], marker='o', ms=6, lw=2, color=PAL[i], label=lab)
        ends.append([c[-1, 0], c[-1, 1], lab, PAL[i]])
    # direct labels at the line ends, nudged apart where they would touch
    ends.sort(key=lambda e: e[1]); last = None
    for e in ends:
        y = e[1] if last is None or e[1] / last > 1.25 else last * 1.25
        ax.annotate(e[2], (e[0], e[1]), xytext=(8, 0), textcoords='offset points', fontsize=8.5, color=INK, va='center',
                    xycoords='data') if y == e[1] else ax.annotate(e[2], (e[0], y), xytext=(8, 0), textcoords='offset points', fontsize=8.5, color=INK, va='center')
        last = y
    xs = sorted({p[0] for pts in series.values() for p in pts})
    ax.xaxis.set_major_locator(FixedLocator(xs)); ax.xaxis.set_minor_locator(NullLocator())
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{int(round(v)):,}'))
    ax.yaxis.set_major_locator(LogLocator(base=10, subs=(1, 2, 5))); ax.yaxis.set_minor_locator(NullLocator())
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{v:g}'))
    ax.set_title(name, loc='left'); ax.set_xlabel('cells'); ax.grid(True, which='major', color=GRID, lw=0.6)
    ax.set_xlim(xs[0] / 1.3, xs[-1] * 2.6); ax.legend(frameon=False, fontsize=8, loc='lower left')
axs[0].set_ylabel('RMS difference, app − OpenFOAM (%)')
fig.suptitle('The two codes meet as OpenFOAM\'s mesh is refined', x=0.01, ha='left', fontweight='bold')
fig.savefig(f'{OUT}/convergence.png', dpi=110); plt.close(fig)
print('heat_2d.png stress_2d.png flow_2d.png convergence.png')
