"""
The app's temperatures (heat_app.js) against OpenFOAM's (heat_of.py) on the same cells, at each output time:
the RMS and the largest difference over all cells, per layer, as a share of the temperature rise there (T_max - T0),
and at named points. usage: python3 compare_heat.py <case.json> <app.json> <of.json> [out.json]
"""
import json, sys
import numpy as np

C = json.load(open(sys.argv[1])); A = json.load(open(sys.argv[2])); F = json.load(open(sys.argv[3]))
dim = C['dim']; yb = np.cumsum([0] + [l['t'] for l in C['layers']])
key = lambda r: tuple(round(v * 1e7) for v in r[:dim])
out = {'case': C['title'], 'cells': None, 'times': {}}
for t in map(str, C['times']):
    a = {key(r): r[dim] for r in A['snaps'][t]}; f = {key(r): r[dim] for r in F['snaps'][t]}
    ks = sorted(a); assert set(ks) == set(f), 'the two meshes differ'
    Ta = np.array([a[k] for k in ks]); Tf = np.array([f[k] for k in ks]); Y = np.array([k[1] for k in ks]) / 1e7
    rise = Tf.max() - C['T0']; d = Ta - Tf
    lay = {}
    for i, l in enumerate(C['layers']):
        m = (Y > yb[i]) & (Y < yb[i + 1])
        lay[l['name']] = {'rms': float(np.sqrt((d[m] ** 2).mean()) / rise), 'max': float(np.abs(d[m]).max() / rise),
                          'Tmax_app': float(Ta[m].max()), 'Tmax_of': float(Tf[m].max())}
    out['cells'] = len(ks)
    out['times'][t] = {'rise': float(rise), 'rms': float(np.sqrt((d ** 2).mean()) / rise), 'max': float(np.abs(d).max() / rise),
                       'max_abs_K': float(np.abs(d).max()), 'Tmax_app': float(Ta.max()), 'Tmax_of': float(Tf.max()), 'layers': lay}
s = json.dumps(out, indent=1)
if len(sys.argv) > 4: open(sys.argv[4], 'w').write(s)
for t, o in out['times'].items():
    print(f"t {t:>5} s: rise {o['rise']:.2f} K, RMS {o['rms'] * 100:.3f} %, max {o['max'] * 100:.3f} % ({o['max_abs_K']:.3f} K), "
          f"T max app {o['Tmax_app']:.3f} / OF {o['Tmax_of']:.3f} °C; " + ', '.join(f"{k} {v['rms'] * 100:.3f}" for k, v in o['layers'].items()))
