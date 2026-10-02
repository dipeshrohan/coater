"""
The stress benchmark's block as an OpenFOAM v1912 solidDisplacementFoam case (finite volumes, segregated, linear
elastic, thermal stress on): the same mesh as the app's (one cell per element), the temperature solved with it:
  bottom: clamped (D = 0), T = 0 (the stress-free temperature)
  top:    free (tractionDisplacement, no traction), T held at dT sin(pi x / Lx) (3D: times sin(pi z / Lz)), face by face
  sides:  free, insulated; 2D: front and back empty (plane strain)
Run as a steady solve (steadyState d2dt2 and ddt), iterated until the displacement's residual stalls.
usage: python3 stress_of.py <case.json> <case dir> [refine factor]   -> runs it, writes <case>/of.json
"""
import json, os, sys, re, shutil, subprocess, math
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from foamio import write
from compare import read_list, read_field

def sh(case, cmd, log):
    r = subprocess.run(['bash', '-c', f'source /usr/share/openfoam/etc/bashrc >/dev/null 2>&1; cd "{case}" && {cmd} > {log} 2>&1'])
    if r.returncode: raise SystemExit(f'{cmd} failed: see {case}/{log}')

def build(C, case, f):
    dim = C['dim']; Lx, Ly, Lz = C['L']; n = [round(v * f) for v in C['n']]
    zt = Lz if dim == 3 else 1e-3; nz = n[2] if dim == 3 else 1
    V = [(x, y, z) for z in (0, zt) for y in (0, Ly) for x in (0, Lx)]       # (i, j, k): k*4 + j*2 + i
    v = lambda i, j, k: k * 4 + j * 2 + i
    sides = ['(%d %d %d %d)' % (v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), '(%d %d %d %d)' % (v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1))]
    fb = ['(%d %d %d %d)' % (v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), '(%d %d %d %d)' % (v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1))]
    pat = {'bottom': ('wall', ['(%d %d %d %d)' % (v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1))]),
           'top': ('patch', ['(%d %d %d %d)' % (v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0))]),
           'sides': ('patch', sides + (fb if dim == 3 else []))}
    if dim == 2: pat['frontBack'] = ('empty', fb)
    shutil.rmtree(case, ignore_errors=True)
    write(case, 'system/blockMeshDict', 'dictionary', 'convertToMeters 1;\nvertices\n(\n%s\n);\nblocks ( hex (%s) (%d %d %d) simpleGrading (1 1 1) );\nedges ();\nboundary\n(\n%s\n);\nmergePatchPairs ();' % (
        '\n'.join('    (%.12g %.12g %.12g)' % p for p in V), ' '.join(str(v(*c)) for c in [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
        n[0], n[1], nz, '\n'.join(f'    {k} {{ type {t}; faces ( {" ".join(fl)} ); }}' for k, (t, fl) in pat.items())))
    write(case, 'constant/mechanicalProperties', 'dictionary', f"""rho {{ type uniform; value {C['rho']}; }}
nu {{ type uniform; value {C['nu']}; }}
E {{ type uniform; value {C['E']}; }}
planeStress no;""")
    write(case, 'constant/thermalProperties', 'dictionary', f"""C {{ type uniform; value {C['cp']}; }}
k {{ type uniform; value {C['k']}; }}
alpha {{ type uniform; value {C['alpha']}; }}
thermalStress yes;""")
    it = C.get('iterations', 20000)
    write(case, 'system/controlDict', 'dictionary', f"""application solidDisplacementFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime {it};
deltaT 1; writeControl timeStep; writeInterval {it // 2}; purgeWrite 0; writeFormat ascii; writePrecision 12; timeFormat general; timePrecision 8; runTimeModifiable true;""")
    write(case, 'system/fvSchemes', 'dictionary', """d2dt2Schemes { default steadyState; }
ddtSchemes { default steadyState; }
gradSchemes { default leastSquares; grad(D) leastSquares; grad(T) leastSquares; }
divSchemes { default none; div(sigmaD) Gauss linear; }
laplacianSchemes { default none; laplacian(DD,D) Gauss linear corrected; laplacian(DT,T) Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default none; }""")
    write(case, 'system/fvSolution', 'dictionary', """solvers
{
    "(D|T)" { solver GAMG; tolerance 1e-12; relTol 0.9; smoother GaussSeidel; nCellsInCoarsestLevel 20; }
}
stressAnalysis { compactNormalStress yes; nCorrectors 1; D 1e-12; }""")
    return dim, n

def fields(C, case):
    dim = C['dim']; Lx, Ly, Lz = C['L']
    P = case + '/constant/polyMesh/'
    pts = read_list(P + 'points', 'vector'); fcs = read_list(P + 'faces', 'face')
    bnd = open(P + 'boundary').read()
    m = re.search(r'top\s*\{[^}]*nFaces\s+(\d+);\s*startFace\s+(\d+);', bnd); nT, sT = int(m.group(1)), int(m.group(2))
    vals = []
    for i in range(sT, sT + nT):
        c = pts[fcs[i]].mean(0)
        vals.append(C['dT'] * math.sin(math.pi * c[0] / Lx) * (math.sin(math.pi * c[2] / Lz) if dim == 3 else 1))
    lst = 'nonuniform List<scalar> %d (%s)' % (len(vals), ' '.join('%.12g' % v for v in vals))
    empty = 'frontBack { type empty; }' if dim == 2 else ''
    write(case, '0/T', 'volScalarField', f"""dimensions [0 0 0 1 0 0 0];
internalField uniform 0;
boundaryField {{ bottom {{ type fixedValue; value uniform 0; }} top {{ type fixedValue; value {lst}; }} sides {{ type zeroGradient; }} {empty} }}""")
    free = 'type tractionDisplacement; traction uniform (0 0 0); pressure uniform 0; value uniform (0 0 0);'
    write(case, '0/D', 'volVectorField', f"""dimensions [0 1 0 0 0 0 0];
internalField uniform (0 0 0);
boundaryField {{ bottom {{ type fixedValue; value uniform (0 0 0); }} top {{ {free} }} sides {{ {free} }} {empty} }}""")

def results(C, case):
    dim = C['dim']; P = case + '/constant/polyMesh/'
    pts = read_list(P + 'points', 'vector'); fcs = read_list(P + 'faces', 'face')
    own = read_list(P + 'owner', 'label'); nb = read_list(P + 'neighbour', 'label'); nc = int(own.max()) + 1
    cs = np.zeros((nc, 3)); cn = np.zeros(nc); fc = np.array([pts[f].mean(0) for f in fcs])
    np.add.at(cs, own, fc); np.add.at(cn, own, 1); np.add.at(cs, nb, fc[:len(nb)]); np.add.at(cn, nb, 1); cs /= cn[:, None]
    ts = sorted((d for d in os.listdir(case) if re.fullmatch(r'[0-9.eE+-]+', d) and d != '0'), key=float); t = ts[-1]
    D = read_field(f'{case}/{t}/D', 'vector'); T = read_field(f'{case}/{t}/T', 'scalar')
    # sigma: a symmTensor per cell, OpenFOAM's order xx xy xz yy yz zz -> the app's Voigt xx yy zz yz xz xy
    txt = open(f'{case}/{t}/sigma').read(); m = re.search(r'internalField\s+nonuniform\s+List<symmTensor>\s*(\d+)\s*\(', txt)
    num = r'([-0-9.eE+]+)'
    sym = np.array(re.findall(r'\(' + ' '.join([num] * 6) + r'\)', txt[m.end():txt.index('boundaryField')])[:int(m.group(1))], dtype=float)
    sv = sym[:, [0, 3, 5, 4, 2, 1]]
    rows = [{'x': list(cs[i, :dim]), 'T': float(T[i]), 'u': list(D[i, :dim]), 's': [float(v) for v in sv[i]]} for i in range(nc)]
    # the convergence: the displacement's change over the last half of the iterations
    D0 = read_field(f'{case}/{ts[-2]}/D', 'vector') if len(ts) > 1 else None
    ch = float(np.abs(D - D0).max() / np.abs(D).max()) if D0 is not None else None
    return {'dim': dim, 'time': t, 'rows': rows, 'change_last_half': ch}

if __name__ == '__main__':
    C = json.load(open(sys.argv[1])); case = sys.argv[2]; f = float(sys.argv[3]) if len(sys.argv) > 3 else 1
    build(C, case, f); sh(case, 'blockMesh', 'log.blockMesh'); fields(C, case)
    sh(case, 'solidDisplacementFoam', 'log.solid')
    out = results(C, case); json.dump(out, open(case + '/of.json', 'w'))
    print('done', case, len(out['rows']), 'cells; D change over the last half', out['change_last_half'])
