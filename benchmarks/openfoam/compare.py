"""
OpenFOAM's solution against the app's at the app's interior nodes. The app's nodes are vertices of the OpenFOAM mesh
(refineMesh keeps them); a node's OpenFOAM value is the inverse-distance mean of the cells round it (as OpenFOAM's
volPointInterpolation does; read straight from the case's files: this Debian build's function objects fail).
Pressure compared as the modified pressure p + rho g y (the app's gravity folded in; OpenFOAM is solved without it).
usage: python3 compare.py <app.json> <case dir> [tag]  -> prints and writes <case>/compare.json
"""
import json, os, sys, re
import numpy as np

def body(path):
    t = open(path).read()
    i = t.index('}') + 1                          # after the FoamFile header
    return t[i:]

def read_list(path, kind):
    t = body(path)
    m = re.search(r'(\d+)\s*\(', t); n = int(m.group(1)); s = t[m.end():]
    if kind == 'label': return np.array(s[:s.rindex(')')].split()[:n], dtype=np.int64)
    if kind == 'vector':
        v = re.findall(r'\(([-0-9.eE+]+) ([-0-9.eE+]+) ([-0-9.eE+]+)\)', s)
        return np.array(v[:n], dtype=float)
    if kind == 'face':
        return [list(map(int, f.split())) for f in re.findall(r'\d+\(([0-9 ]+)\)', s)[:n]]

def read_field(path, kind):
    t = body(path)
    m = re.search(r'internalField\s+nonuniform\s+List<\w+>\s*(\d+)\s*\(', t)
    n = int(m.group(1)); s = t[m.end():]
    if kind == 'vector':
        v = re.findall(r'\(([-0-9.eE+]+) ([-0-9.eE+]+) ([-0-9.eE+]+)\)', s[:s.index('boundaryField') if 'boundaryField' in s else None])
        return np.array(v[:n], dtype=float)
    return np.array(s.split(')')[0].split()[:n], dtype=float)

def latest(case):
    ts = [d for d in os.listdir(case) if re.fullmatch(r'[0-9.eE+-]+', d) and d != '0']
    return max(ts, key=float)

def compare(src, case, tag=''):
    d = json.load(open(src)); NC, NR, NL = d['NC'], d['NR'], d['NL']; m = d['msg']; rho, g = m['rho'], m['g']
    nid = lambda c, l, k: (c * NL + l) * NR + k
    two = d.get('dim') == 2                           # a 2D case: one layer, its nodes on the front plane
    idx = [nid(c, l, k) for c in range(1, NC - 1) for l in ([0] if two else range(1, NL - 1)) for k in range(1, NR - 1)]
    X = np.array([d['x'], d['y'], d['z']]).T
    P = case + '/constant/polyMesh/'
    pts = read_list(P + 'points', 'vector'); fcs = read_list(P + 'faces', 'face')
    own = read_list(P + 'owner', 'label'); nb = read_list(P + 'neighbour', 'label')
    nCell = int(own.max()) + 1
    t = latest(case); U = read_field(f'{case}/{t}/U', 'vector'); p = read_field(f'{case}/{t}/p', 'scalar')
    assert len(U) == nCell and len(p) == nCell, (len(U), len(p), nCell)
    # cell centres: the mean of their faces' centres
    cs = np.zeros((nCell, 3)); cn = np.zeros(nCell)
    fc = np.array([pts[f].mean(0) for f in fcs])
    np.add.at(cs, own, fc); np.add.at(cn, own, 1); np.add.at(cs, nb, fc[:len(nb)]); np.add.at(cn, nb, 1); cs /= cn[:, None]
    # the mesh point at each app node (the first NC*NL*NR points are the app's nodes, in its order: refineMesh appends)
    assert np.allclose(pts[:len(X)], X, atol=1e-12), 'the mesh does not start with the app nodes'
    # the cells round each point
    want = set(idx); round_ = {i: set() for i in idx}
    for fi, f in enumerate(fcs):
        for q in f:
            if q in want:
                round_[q].add(int(own[fi]))
                if fi < len(nb): round_[q].add(int(nb[fi]))
    def at(i, F):
        cells = np.array(sorted(round_[i])); w = 1 / np.linalg.norm((cs[cells] - X[i])[:, :2 if two else 3], axis=1)
        return (F[cells] * (w[:, None] if F.ndim == 2 else w)).sum(0) / w.sum()
    FU = np.array([at(i, U) for i in idx]); FP = np.array([at(i, p) for i in idx]) * rho
    ii = np.array(idx)
    A = {'u': np.array(d['u'])[ii], 'v': np.array(d['v'])[ii], 'w': np.array(d['w'])[ii], 'p': np.array(d['p'])[ii] + rho * g * X[ii, 1]}
    F = {'u': FU[:, 0], 'v': FU[:, 1], 'w': FU[:, 2], 'p': FP}
    Uref = m['U']; out = {'tag': tag, 'cells': nCell, 'nodes': len(idx), 'time': t}
    for k in 'uvw':
        dl = F[k] - A[k]
        out[k] = {'app_max': float(np.abs(A[k]).max()), 'of_max': float(np.abs(F[k]).max()),
                  'rms_diff_over_U': float(np.sqrt((dl ** 2).mean()) / Uref), 'max_diff_over_U': float(np.abs(dl).max() / Uref)}
        if np.abs(A[k]).max() > 0 and np.abs(F[k]).max() > 0: out[k]['corr'] = float(np.corrcoef(A[k], F[k])[0, 1])
    dp = F['p'] - A['p']; pr = float(A['p'].max() - A['p'].min())
    out['p'] = {'app_range': pr, 'of_range': float(F['p'].max() - F['p'].min()), 'rms_diff_over_range': float(np.sqrt((dp ** 2).mean()) / pr), 'max_diff_over_range': float(np.abs(dp).max() / pr)}
    out['Rzx'] = {'app': float(np.abs(A['w']).max() / np.abs(A['u']).max()), 'of': float(np.abs(F['w']).max() / np.abs(F['u']).max())}
    # by region: the wide pool (gap above 2 H), the converging gap under the blade, the metering corner with the exit face
    # and the contact line (within 2 H of the corner or the contact line), the film beyond
    H, xe = d['H'], d['xe']; xs, ys = X[ii, 0], X[ii, 1]
    top = lambda c: X[nid(c, 0, NR - 1)]
    cn, cl = np.array([xe, H]), top(d['cCL'])[:2]
    gap = np.array([top(c)[1] for c in range(NC)])[ii // (NL * NR)]
    near = (np.hypot(xs - cn[0], ys - cn[1]) < 2 * H) | (np.hypot(xs - cl[0], ys - cl[1]) < 2 * H)
    reg = {'pool': (xs < xe) & (gap > 2 * H) & ~near, 'blade': (xs < xe) & (gap <= 2 * H) & ~near, 'corner_cl': near, 'film': (xs >= xe) & ~near}
    out['regions'] = {k: {'nodes': int(r.sum()), 'u': float(np.sqrt(((F['u'] - A['u'])[r] ** 2).mean()) / Uref),
                          'p': float(np.sqrt((dp[r] ** 2).mean()) / pr)} for k, r in reg.items() if r.any()}
    # the flow rate per width through the inlet and the outlet: OpenFOAM's face fluxes phi (its own when the outlet is open)
    Wz = float(pts[:, 2].max() - pts[:, 2].min())
    ph = body(f'{case}/{t}/phi')
    for name in ('inlet', 'outlet'):
        blk = ph[ph.index(name, ph.index('boundaryField')):]
        blk = blk[:blk.index('}')]
        mu_ = re.search(r'value\s+uniform\s+([-0-9.eE+]+)', blk)
        if mu_: q = 0.0
        else:
            mt = re.search(r'List<scalar>\s*(\d+)\s*\(', blk); n = int(mt.group(1))
            q = float(np.sum(np.array(blk[mt.end():].split(')')[0].split()[:n], dtype=float)))
        out['Q_' + name] = abs(q) / Wz
    out['Q_app'] = d.get('Q') or None
    if out['Q_app']: out['Q_diff'] = out['Q_outlet'] / out['Q_app'] - 1
    json.dump(out, open(case + '/compare.json', 'w'), indent=1)
    np.savez(case + '/compare_nodes.npz', idx=ii, X=X[ii], **{'app_' + k: A[k] for k in A}, **{'of_' + k: F[k] for k in F})
    return out

if __name__ == '__main__':
    print(json.dumps(compare(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ''), indent=1))
