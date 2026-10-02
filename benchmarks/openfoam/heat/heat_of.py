"""
The heat benchmark's stack as an OpenFOAM v1912 chtMultiRegionFoam case: one solid region per layer (heSolidThermo,
constant k, c_p, rho), coupled at the interfaces (turbulentTemperatureCoupledBaffleMixed: T and heat flux continuous),
the same mesh as the app's (one cell per element), the same boundaries:
  top:    the heated patch (x < x1, and z < z1 in 3D) exchanges with hot air, h (T - T_inf) (externalWallHeatFluxTemperature,
          coefficient mode); the rest of the top insulated
  bottom: exchanges with cool air
  sides:  insulated; 2D: front and back empty
Time: the app's step (dt), second order (backward: the app's BDF2), run to each output time in turn.
usage: python3 heat_of.py <case.json> <case dir> [refine factor]   -> writes the case, runs it, writes <case>/of.json
"""
import json, os, sys, re, shutil, subprocess
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from foamio import write

def sh(case, cmd, log):
    r = subprocess.run(['bash', '-c', f'source /usr/share/openfoam/etc/bashrc >/dev/null 2>&1; cd "{case}" && {cmd} > {log} 2>&1'])
    if r.returncode: raise SystemExit(f'{cmd} failed: see {case}/{log}')

def build(C, case, f):
    dim = C['dim']; L = C['layers']; K0 = 273.15
    xb = C['x']['breaks']; yb = [0.0]
    for l in L: yb.append(yb[-1] + l['t'])
    zb = C['z']['breaks'] if dim == 3 else [0.0, C.get('dz2d', 1e-3)]
    nxs = [round(n * f) for n in C['x']['n']]; nys = [round(l['n'] * f) for l in L]; nzs = [round(n * f) for n in C['z']['n']] if dim == 3 else [1]
    NX, NY, NZ = len(xb), len(yb), len(zb)
    vid = lambda i, j, k: (k * NY + j) * NX + i
    V = [(xb[i], yb[j], zb[k]) for k in range(NZ) for j in range(NY) for i in range(NX)]
    blocks, faces = [], {'bottom': [], 'topHeat': [], 'topRest': [], 'sides': [], 'frontBack': []}
    def quad(vs, outward):
        P = np.array([V[v] for v in vs]); n = np.cross(P[1] - P[0], P[2] - P[0])
        return vs if np.dot(n, outward) > 0 else vs[::-1]
    for k in range(NZ - 1):
        for j in range(NY - 1):
            for i in range(NX - 1):
                hexv = [vid(i, j, k), vid(i + 1, j, k), vid(i + 1, j + 1, k), vid(i, j + 1, k), vid(i, j, k + 1), vid(i + 1, j, k + 1), vid(i + 1, j + 1, k + 1), vid(i, j + 1, k + 1)]
                blocks.append(f'hex ({" ".join(map(str, hexv))}) {L[j]["name"]} ({nxs[i]} {nys[j]} {nzs[k]}) simpleGrading (1 1 1)')
                if j == 0: faces['bottom'].append(quad([vid(i, 0, k), vid(i + 1, 0, k), vid(i + 1, 0, k + 1), vid(i, 0, k + 1)], (0, -1, 0)))
                if j == NY - 2:
                    q = quad([vid(i, NY - 1, k), vid(i + 1, NY - 1, k), vid(i + 1, NY - 1, k + 1), vid(i, NY - 1, k + 1)], (0, 1, 0))
                    hot = xb[i + 1] <= C['heat']['x1'] + 1e-12 and (dim == 2 or zb[k + 1] <= C['heat']['z1'] + 1e-12)
                    faces['topHeat' if hot else 'topRest'].append(q)
                if i == 0: faces['sides'].append(quad([vid(0, j, k), vid(0, j + 1, k), vid(0, j + 1, k + 1), vid(0, j, k + 1)], (-1, 0, 0)))
                if i == NX - 2: faces['sides'].append(quad([vid(NX - 1, j, k), vid(NX - 1, j + 1, k), vid(NX - 1, j + 1, k + 1), vid(NX - 1, j, k + 1)], (1, 0, 0)))
                for kk, out in ((0, -1), (NZ - 1, 1)):
                    if (out < 0 and k == 0) or (out > 0 and k == NZ - 2):
                        q = quad([vid(i, j, kk), vid(i + 1, j, kk), vid(i + 1, j + 1, kk), vid(i, j + 1, kk)], (0, 0, out))
                        faces['sides' if dim == 3 else 'frontBack'].append(q)
    shutil.rmtree(case, ignore_errors=True)
    pat = []
    for name, fl in faces.items():
        if not fl: continue
        typ = 'empty' if name == 'frontBack' else 'wall'
        pat.append(f'    {name}\n    {{\n        type {typ};\n        faces\n        (\n' + '\n'.join('            (%s)' % ' '.join(map(str, q)) for q in fl) + '\n        );\n    }')
    write(case, 'system/blockMeshDict', 'dictionary', 'convertToMeters 1;\nvertices\n(\n%s\n);\nblocks\n(\n%s\n);\nedges ();\nboundary\n(\n%s\n);\nmergePatchPairs ();' % (
        '\n'.join('    (%.12g %.12g %.12g)' % v for v in V), '\n'.join('    ' + b for b in blocks), '\n'.join(pat)))
    names = [l['name'] for l in L]
    write(case, 'constant/g', 'uniformDimensionedVectorField', 'dimensions [0 1 -2 0 0 0 0];\nvalue (0 0 0);')   # (read even with no fluid region)
    write(case, 'constant/regionProperties', 'dictionary', 'regions ( fluid () solid (%s) );' % ' '.join(names))
    T0 = C['T0'] + K0
    seg_ends = C['times']
    write(case, 'system/controlDict', 'dictionary', f"""application chtMultiRegionFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime {seg_ends[0]};
deltaT {C['dt']}; writeControl runTime; writeInterval {seg_ends[0]}; purgeWrite 0; writeFormat ascii; writePrecision 12;
timeFormat general; timePrecision 8; runTimeModifiable true; adjustTimeStep no;""")
    write(case, 'system/fvSchemes', 'dictionary', 'ddtSchemes { default backward; } gradSchemes { default Gauss linear; } divSchemes { default none; } laplacianSchemes { default Gauss linear corrected; } interpolationSchemes { default linear; } snGradSchemes { default corrected; }')
    write(case, 'system/fvSolution', 'dictionary', f'PIMPLE {{ nOuterCorrectors {C.get("outer", 8)}; }}')
    for l in L:
        r = l['name']
        write(case, f'constant/{r}/thermophysicalProperties', 'dictionary', f"""thermoType {{ type heSolidThermo; mixture pureMixture; transport constIso; thermo hConst; equationOfState rhoConst; specie specie; energy sensibleEnthalpy; }}
mixture {{ specie {{ molWeight 50; }} transport {{ kappa {l['k']}; }} thermodynamics {{ Hf 0; Cp {l['cp']}; }} equationOfState {{ rho {l['rho']}; }} }}""")
        write(case, f'constant/{r}/radiationProperties', 'dictionary', 'radiation off; radiationModel none;')
        write(case, f'system/{r}/fvSchemes', 'dictionary', 'ddtSchemes { default backward; } gradSchemes { default Gauss linear; } divSchemes { default none; } laplacianSchemes { default Gauss linear corrected; } interpolationSchemes { default linear; } snGradSchemes { default corrected; }')
        write(case, f'system/{r}/fvSolution', 'dictionary', 'solvers { h { solver PCG; preconditioner DIC; tolerance 1e-12; relTol 0; } hFinal { $h; } } PIMPLE { nNonOrthogonalCorrectors 0; }')
    return names, T0

def fields(C, case, names, T0):
    K0 = 273.15
    for r in names:
        bnd = open(f'{case}/constant/{r}/polyMesh/boundary').read()
        pats = re.findall(r'\n\s*(\w+)\s*\n\s*\{\s*type\s+(\w+);', bnd)
        Tb, pb = [], []
        for n, t in pats:
            if t == 'empty': Tb.append(f'{n} {{ type empty; }}'); pb.append(f'{n} {{ type empty; }}'); continue
            pb.append(f'{n} {{ type calculated; value uniform 1e5; }}')
            if t == 'mappedWall':
                Tb.append(f'{n} {{ type compressible::turbulentTemperatureCoupledBaffleMixed; Tnbr T; kappaMethod solidThermo; value uniform {T0}; }}')
            elif n in ('topHeat', 'bottom'):
                b = C['heat'] if n == 'topHeat' else C['cool']
                Tb.append(f'{n} {{ type externalWallHeatFluxTemperature; mode coefficient; kappaMethod solidThermo; h uniform {b["h"]}; Ta constant {b["Tinf"] + K0}; value uniform {T0}; }}')
            else: Tb.append(f'{n} {{ type zeroGradient; }}')
        write(case, f'0/{r}/T', 'volScalarField', 'dimensions [0 0 0 1 0 0 0];\ninternalField uniform %s;\nboundaryField\n{\n%s\n}' % (T0, '\n'.join('    ' + s for s in Tb)))
        write(case, f'0/{r}/p', 'volScalarField', 'dimensions [1 -1 -2 0 0 0 0];\ninternalField uniform 1e5;\nboundaryField\n{\n%s\n}' % '\n'.join('    ' + s for s in pb))

def run(C, case):
    prev = 0
    for t in C['times']:
        cd = open(f'{case}/system/controlDict').read()
        cd = re.sub(r'endTime\s+[^;]+;', f'endTime {t};', cd); cd = re.sub(r'writeInterval\s+[^;]+;', f'writeInterval {t - prev};', cd)
        open(f'{case}/system/controlDict', 'w').write(cd)
        sh(case, 'chtMultiRegionFoam', f'log.cht.{t}')
        prev = t

def cells(case, r):
    """the region's cell centres (the mean of its points over its faces -- exact for these boxes)"""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from compare import read_list
    P = f'{case}/constant/{r}/polyMesh/'
    pts = read_list(P + 'points', 'vector'); fcs = read_list(P + 'faces', 'face')
    own = read_list(P + 'owner', 'label'); nb = read_list(P + 'neighbour', 'label'); n = int(own.max()) + 1
    cs = np.zeros((n, 3)); cn = np.zeros(n); fc = np.array([pts[f].mean(0) for f in fcs])
    np.add.at(cs, own, fc); np.add.at(cn, own, 1); np.add.at(cs, nb, fc[:len(nb)]); np.add.at(cn, nb, 1)
    return cs / cn[:, None]

def results(C, case, names):
    from compare import read_field
    out = {}
    for t in C['times']:
        rows = []
        for r in names:
            X = cells(case, r); T = read_field(f'{case}/{t}/{r}/T', 'scalar') - 273.15
            rows += [[*x[:C['dim']], float(v)] for x, v in zip(X, T)]
        out[t] = rows
    return out

if __name__ == '__main__':
    C = json.load(open(sys.argv[1])); case = sys.argv[2]; f = float(sys.argv[3]) if len(sys.argv) > 3 else 1
    names, T0 = build(C, case, f)
    sh(case, 'blockMesh', 'log.blockMesh'); sh(case, 'splitMeshRegions -cellZones -overwrite', 'log.split')
    fields(C, case, names, T0)
    run(C, case)
    res = results(C, case, names)
    json.dump({'dim': C['dim'], 'refine': f, 'snaps': res}, open(f'{case}/of.json', 'w'))
    print('done', case, sum(len(v) for v in list(res.values())[:1]), 'cells')
