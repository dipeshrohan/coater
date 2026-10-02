"""
The app's temperature, displacement and stress (stress_app.js) against OpenFOAM's (stress_of.py), cell by cell:
the RMS and largest differences as a share of the field's largest magnitude; the stress also away from the clamped
bottom corners (edges in 3D), where the elastic stress is singular and neither code's value there is a number.
usage: python3 compare_stress.py <case.json> <app.json> <of.json> [out.json]
"""
import json, sys
import numpy as np

C = json.load(open(sys.argv[1])); A = json.load(open(sys.argv[2])); F = json.load(open(sys.argv[3]))
dim = C['dim']; Lx, Ly, Lz = C['L']
key = lambda r: tuple(round(v * 1e8) for v in r['x'])
a = {key(r): r for r in A['rows']}; f = {key(r): r for r in F['rows']}
ks = sorted(a); assert set(ks) == set(f), 'the two meshes differ'
X = np.array([a[k]['x'] for k in ks])
get = lambda D, name: np.array([D[k][name] for k in ks])
out = {'case': C['title'], 'cells': len(ks)}
def stat(va, vf, mask=None):
    d = va - vf; m = np.ones(len(d), bool) if mask is None else mask
    ref = np.abs(vf).max()
    return {'rms': float(np.sqrt((d[m] ** 2).mean()) / ref), 'max': float(np.abs(d[m]).max() / ref), 'ref': float(ref)}
out['T'] = stat(get(a, 'T'), get(f, 'T'))
ua, uf = get(a, 'u'), get(f, 'u')
out['u'] = {c: stat(ua[:, i], uf[:, i]) for i, c in enumerate('xyz'[:dim])}
out['u']['max_mag_app'] = float(np.linalg.norm(ua, axis=1).max()); out['u']['max_mag_of'] = float(np.linalg.norm(uf, axis=1).max())
# away from the clamped edges: more than a tenth of the height from the bottom's ends
far = ~((X[:, 1] < 0.1 * Ly) & ((X[:, 0] < 0.1 * Ly) | (X[:, 0] > Lx - 0.1 * Ly) | ((dim == 3) & ((X[:, 2 if dim == 3 else 0] < 0.1 * Ly) | (X[:, 2 if dim == 3 else 0] > Lz - 0.1 * Ly)))))
sa, sf = get(a, 's'), get(f, 's')
comps = ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'] if dim == 3 else ['xx', 'yy', 'zz', 'xy']
idx = {'xx': 0, 'yy': 1, 'zz': 2, 'yz': 3, 'xz': 4, 'xy': 5}
smax = np.abs(sf).max()
out['stress'] = {c: {'all': {**stat(sa[:, idx[c]], sf[:, idx[c]]), 'of_scale': float(smax)}, 'away_from_clamped_corners': stat(sa[:, idx[c]], sf[:, idx[c]], far)} for c in comps}
# against the largest stress anywhere (one scale for all the components)
for c in comps:
    d = sa[:, idx[c]] - sf[:, idx[c]]
    out['stress'][c]['rms_of_max_stress'] = float(np.sqrt((d[far] ** 2).mean()) / smax)
out['stress_max_MPa'] = {'app': float(np.abs(sa).max() / 1e6), 'of': float(smax / 1e6)}
s = json.dumps(out, indent=1)
if len(sys.argv) > 4: open(sys.argv[4], 'w').write(s)
print(f"{out['cells']} cells. T: RMS {out['T']['rms'] * 100:.3f} %, max {out['T']['max'] * 100:.3f} %")
print('u: ' + ', '.join(f"{c} RMS {out['u'][c]['rms'] * 100:.3f} % max {out['u'][c]['max'] * 100:.3f} %" for c in 'xyz'[:dim]) + f"; |u| max app {out['u']['max_mag_app'] * 1e6:.3f} / OF {out['u']['max_mag_of'] * 1e6:.3f} µm")
print('stress (RMS away from the clamped corners, of the largest stress): ' + ', '.join(f"{c} {out['stress'][c]['rms_of_max_stress'] * 100:.3f} %" for c in comps) + f"; max |σ| app {out['stress_max_MPa']['app']:.2f} / OF {out['stress_max_MPa']['of']:.2f} MPa")
