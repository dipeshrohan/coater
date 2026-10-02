"""Top-view maps of the cross-web velocity w at half the gap's height: the app, OpenFOAM, their difference (same scale)."""
import json, sys, numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
cases = [('default.json', 'def_r1', 'Default blade (gap 1.718–1.727 mm across the 20 mm strip)'),
         ('wavy.json', 'wavy_r1', 'Wavy blade (gap 1.41–2.00 mm across the strip)'),
         ('skew5.json', 'skew_r1', 'Blade skewed 5° (web moving 0.41 mm/s along the blade)')]
fig = plt.figure(figsize=(15, 2.9 * len(cases) + 0.6), constrained_layout=True)
subs = fig.subfigures(len(cases), 1)
axs = np.array([sf.subplots(1, 3) for sf in subs])
for r, (src, case, title) in enumerate(cases):
    d = json.load(open(src)); NC, NR, NL = d['NC'], d['NR'], d['NL']; z = np.load(case + '/compare_nodes.npz')
    idx = z['idx']; k = idx % NR; kmid = (NR - 1) // 2; sel = k == kmid
    X = z['X'][sel]; c = idx[sel] // (NL * NR); l = (idx[sel] // NR) % NL
    nc, nl = len(np.unique(c)), len(np.unique(l)); o = np.lexsort((l, c))
    gx = X[o, 0].reshape(nc, nl) * 1e3; gz = X[o, 2].reshape(nc, nl) * 1e3
    A = z['app_w'][sel][o].reshape(nc, nl) * 1e3; F = z['of_w'][sel][o].reshape(nc, nl) * 1e3
    vm = max(np.abs(A).max(), np.abs(F).max())
    for j, (M, name) in enumerate([(A, 'App (cfd-fem3d.js, Q2–Q1 FEM)'), (F, 'OpenFOAM v1912 simpleFoam (56,320 cells)'), (F - A, 'OpenFOAM − app')]):
        ax = axs[r, j]; lim = vm if j < 2 else max(np.abs(F - A).max(), 1e-12)
        im = ax.pcolormesh(gx, gz, M, cmap='RdBu_r', vmin=-lim, vmax=lim, shading='gouraud')
        ax.set_title(name, fontsize=9.5)
        ax.set_xlabel('x along the flow (mm)', fontsize=9); ax.set_ylabel('z across the web (mm)', fontsize=9)
        ax.axvline(d['xe'] * 1e3, color='0.35', lw=0.8, ls='--')
        cb = fig.colorbar(im, ax=ax, shrink=0.9); cb.set_label('w (mm/s)', fontsize=9)
        ax.tick_params(labelsize=8)
    cmp_ = json.load(open(case + '/compare.json'))
    subs[r].suptitle(title, fontsize=11, fontweight='bold', x=0.01, ha='left')
    axs[r, 2].text(0.02, 0.04, 'max |w|: app %.3f, OpenFOAM %.3f mm/s\ncorrelation %.4f' % (cmp_['w']['app_max'] * 1e3, cmp_['w']['of_max'] * 1e3, cmp_['w'].get('corr', float('nan'))),
                   transform=axs[r, 2].transAxes, fontsize=8.5, bbox=dict(fc='white', ec='0.7', alpha=0.9))

fig.savefig('w_maps.png', dpi=110)
print('w_maps.png')
