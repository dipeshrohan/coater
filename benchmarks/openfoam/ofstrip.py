"""
The app's Coating > 3D strip as an OpenFOAM case (v1912, simpleFoam, steady incompressible laminar), on the same domain:
the app's solved mesh nodes (Q2 nodes, 2x its element grid) are the hex mesh's vertices; refine splits it further.

Patches and conditions, as the app's (cfd-fem3d.js):
  web     moving wall (U, 0, webW) with the app's Navier/Beavers-Joseph slip: partialSlip, refValue the web's
          velocity, valueFraction 1 / (1 + b delta) per face (b = 1/webSlip), exact for the slip law (couette.py)
  blade   the blade's underside and its exit face up to the contact line: no slip
  surface the free surface at the app's solved shape: slip (no flow through, no shear)
  inlet   the pool edge: the pressure Pup (the app's traction Pup - rho g y; gravity folded into the modified pressure
          p + rho g y), no cross-flow (pressureInletVelocity: the normal component only)
  outlet  the film moving with the web (plug)
  sideLo/Hi  symmetry planes (the app's strip sides); empty for a 2D case (exp2d.js: one layer, dim 2)
  'open' (5th argument): the outlet at the level film's pressure instead of the plug, so the flow rate is OpenFOAM's
Viscosity: strainRateFunction with a table of the app's own law at sqrt(gd^2 + gdMin^2) (its regularisation), kinematic.
usage: python3 ofstrip.py <app.json> <case dir> [refine levels (0, 1, 2)] [np] [open]
"""
import json, os, sys, shutil, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from foamio import write, vec, slist, vlist, run

def build(src, case, refine=0, nproc=4):
    d = json.load(open(src))
    NC, NR, NL, cCL = d['NC'], d['NR'], d['NL'], d['cCL']
    m = d['msg']; rho = m['rho']; U = m['U']; W = m.get('webW', 0) or 0
    X = np.array([d['x'], d['y'], d['z']]).T                      # node (c, l, k): (c*NL + l)*NR + k
    nid = lambda c, l, k: (c * NL + l) * NR + k
    NCc, NLc, NRc = NC - 1, NL - 1, NR - 1
    cid = lambda c, l, k: (c * NLc + l) * NRc + k
    ncell = NCc * NLc * NRc
    # cell centres (vertex means) for face orientation
    cc = np.zeros((ncell, 3))
    for c in range(NCc):
        for l in range(NLc):
            for k in range(NRc):
                vs = [nid(c + a, l + b, k + g) for a in (0, 1) for b in (0, 1) for g in (0, 1)]
                cc[cid(c, l, k)] = X[vs].mean(0)
    def orient(f, owner_centre):
        P = X[f]; ctr = P.mean(0)
        A = np.zeros(3)
        for i in range(4): A += np.cross(P[i] - ctr, P[(i + 1) % 4] - ctr)
        return f if np.dot(A, ctr - owner_centre) > 0 else f[::-1]
    faces, owner, neigh = [], [], []
    # internal faces, upper-triangular: each cell's neighbours +k, +l, +c in that order
    for c in range(NCc):
        for l in range(NLc):
            for k in range(NRc):
                o = cid(c, l, k)
                if k + 1 < NRc:
                    f = [nid(c, l, k + 1), nid(c + 1, l, k + 1), nid(c + 1, l + 1, k + 1), nid(c, l + 1, k + 1)]
                    faces.append(orient(f, cc[o])); owner.append(o); neigh.append(cid(c, l, k + 1))
                if l + 1 < NLc:
                    f = [nid(c, l + 1, k), nid(c + 1, l + 1, k), nid(c + 1, l + 1, k + 1), nid(c, l + 1, k + 1)]
                    faces.append(orient(f, cc[o])); owner.append(o); neigh.append(cid(c, l + 1, k))
                if c + 1 < NCc:
                    f = [nid(c + 1, l, k), nid(c + 1, l + 1, k), nid(c + 1, l + 1, k + 1), nid(c + 1, l, k + 1)]
                    faces.append(orient(f, cc[o])); owner.append(o); neigh.append(cid(c + 1, l, k))
    nInternal = len(faces)
    patches = []
    def patch(name, typ, items):
        start = len(faces)
        for f, o in items: faces.append(orient(f, cc[o])); owner.append(o)
        patches.append((name, typ, start, len(items)))
    patch('web', 'wall', [([nid(c, l, 0), nid(c + 1, l, 0), nid(c + 1, l + 1, 0), nid(c, l + 1, 0)], cid(c, l, 0)) for c in range(NCc) for l in range(NLc)])
    top = lambda c, l: ([nid(c, l, NR - 1), nid(c + 1, l, NR - 1), nid(c + 1, l + 1, NR - 1), nid(c, l + 1, NR - 1)], cid(c, l, NRc - 1))
    patch('blade', 'wall', [top(c, l) for c in range(NCc) if c + 1 <= cCL for l in range(NLc)])
    patch('surface', 'patch', [top(c, l) for c in range(NCc) if c + 1 > cCL for l in range(NLc)])
    patch('inlet', 'patch', [([nid(0, l, k), nid(0, l + 1, k), nid(0, l + 1, k + 1), nid(0, l, k + 1)], cid(0, l, k)) for l in range(NLc) for k in range(NRc)])
    patch('outlet', 'patch', [([nid(NC - 1, l, k), nid(NC - 1, l + 1, k), nid(NC - 1, l + 1, k + 1), nid(NC - 1, l, k + 1)], cid(NCc - 1, l, k)) for l in range(NLc) for k in range(NRc)])
    side = 'empty' if d.get('dim') == 2 else 'symmetry'
    if not W:
        patch('sideLo', side, [([nid(c, 0, k), nid(c + 1, 0, k), nid(c + 1, 0, k + 1), nid(c, 0, k + 1)], cid(c, 0, k)) for c in range(NCc) for k in range(NRc)])
        patch('sideHi', side, [([nid(c, NL - 1, k), nid(c + 1, NL - 1, k), nid(c + 1, NL - 1, k + 1), nid(c, NL - 1, k + 1)], cid(c, NLc - 1, k)) for c in range(NCc) for k in range(NRc)])
    else:
        # cyclic: face i of sideHi matches face i of sideLo, the same first point, the order reversed (outward normals -z and +z)
        start = len(faces)
        for c in range(NCc):
            for k in range(NRc):
                faces.append([nid(c, 0, k), nid(c, 0, k + 1), nid(c + 1, 0, k + 1), nid(c + 1, 0, k)]); owner.append(cid(c, 0, k))
        patches.append(('sideLo', 'cyclic', start, NCc * NRc))
        start = len(faces)
        for c in range(NCc):
            for k in range(NRc):
                faces.append([nid(c, NL - 1, k), nid(c + 1, NL - 1, k), nid(c + 1, NL - 1, k + 1), nid(c, NL - 1, k + 1)]); owner.append(cid(c, NLc - 1, k))
        patches.append(('sideHi', 'cyclic', start, NCc * NRc))
    Wz = float(X[:, 2].max() - X[:, 2].min())
    shutil.rmtree(case, ignore_errors=True)
    P = 'constant/polyMesh/'
    write(case, P + 'points', 'vectorField', '%d\n(\n%s\n)' % (len(X), '\n'.join(vec(p) for p in X)))
    write(case, P + 'faces', 'faceList', '%d\n(\n%s\n)' % (len(faces), '\n'.join('4(%d %d %d %d)' % tuple(f) for f in faces)))
    note = 'note "nPoints:%d nCells:%d nFaces:%d nInternalFaces:%d";\n' % (len(X), ncell, len(faces), nInternal)
    write(case, P + 'owner', 'labelList', '%d\n(\n%s\n)' % (len(owner), '\n'.join(map(str, owner))))
    write(case, P + 'neighbour', 'labelList', '%d\n(\n%s\n)' % (len(neigh), '\n'.join(map(str, neigh))))
    write(case, P + 'boundary', 'polyBoundaryMesh', '%d\n(\n%s\n)' % (len(patches), '\n'.join(
        '%s { type %s; %snFaces %d; startFace %d; }' % (n, t, 'inGroups List<word> 1(wall); ' if t == 'wall' else
          ('inGroups List<word> 1(cyclic); matchTolerance 0.001; transform translational; separationVector (0 0 %.12g); neighbourPatch %s; ' % ((Wz, 'sideHi') if n == 'sideLo' else (-Wz, 'sideLo')) if t == 'cyclic' else ''), cnt, s) for n, t, s, cnt in patches)))
    # ---- physics ----
    tab = '\n'.join('(%.10g %.10g)' % (g, mu / rho) for g, mu in d['muTable'])
    write(case, 'constant/transportProperties', 'dictionary', 'transportModel strainRateFunction;\nstrainRateFunctionCoeffs\n{\n    function table\n    (\n%s\n    );\n}\nnu %.10g;\n' % (tab, d['muTable'][0][1] / rho))
    write(case, 'constant/turbulenceProperties', 'dictionary', 'simulationType laminar;')
    b = 1 / m['webSlip'] if m.get('webSlip') else 0
    write(case, 'system/controlDict', 'dictionary', f"""application simpleFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime 40000; deltaT 1;
writeControl timeStep; writeInterval 500; purgeWrite 1; writeFormat ascii; writePrecision 12; timePrecision 6; runTimeModifiable true;""")
    write(case, 'system/fvSchemes', 'dictionary', """ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss linearUpwind grad(U); div((nuEff*dev2(T(grad(U))))) Gauss linear; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist { method meshWave; }""")
    write(case, 'system/fvSolution', 'dictionary', """solvers
{
    p { solver GAMG; smoother GaussSeidel; tolerance 1e-11; relTol 0.01; }
    pFinal { $p; relTol 0; }
    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-13; relTol 0.01; }
}
SIMPLE { nNonOrthogonalCorrectors 2; consistent yes; residualControl { p 1e-8; U 1e-10; } }
relaxationFactors { equations { U 0.9; } fields { p 1; } }""")
    write(case, 'system/decomposeParDict', 'dictionary', f'numberOfSubdomains {nproc}; method simple; simpleCoeffs {{ n ({nproc} 1 1); delta 0.001; }}')
    return d, b, U, W, rho, m

def fields(case, d, b, U, W, rho, m, openOut=False):
    """0/U and 0/p after any refinement: the web's slip fraction per face from the (refined) mesh's face-cell distances."""
    import re
    def readlist(path):
        t = open(path).read(); body = t[t.index('(', t.index('}') + 1) + 1: t.rindex(')')]
        return body
    pts = np.array([list(map(float, s.strip('()').split())) for s in re.findall(r'\([-0-9.eE+ ]+\)', readlist(case + '/constant/polyMesh/points'))])
    fcs = [list(map(int, s.split('(')[1].rstrip(')').split())) for s in re.findall(r'\d+\([0-9 ]+\)', readlist(case + '/constant/polyMesh/faces'))]
    own = np.array([int(s) for s in readlist(case + '/constant/polyMesh/owner').split()])
    bnd = open(case + '/constant/polyMesh/boundary').read()
    web = re.search(r'web\s*\{[^}]*nFaces\s+(\d+);\s*startFace\s+(\d+);', bnd); nW, sW = int(web.group(1)), int(web.group(2))
    nCell = own.max() + 1
    # owner cell centres from the faces (mean of the face centres of each cell is close to its centroid; exact for the distance used: n . (Cf - C))
    cs = np.zeros((nCell, 3)); cn = np.zeros(nCell)
    nb = np.array([int(s) for s in readlist(case + '/constant/polyMesh/neighbour').split()])
    for i, f in enumerate(fcs):
        fc = pts[f].mean(0); cs[own[i]] += fc; cn[own[i]] += 1
        if i < len(nb): cs[nb[i]] += fc; cn[nb[i]] += 1
    cs /= cn[:, None]
    fr = []
    for i in range(sW, sW + nW):
        P = pts[fcs[i]]; ctr = P.mean(0); A = np.zeros(3)
        for j in range(4): A += np.cross(P[j] - ctr, P[(j + 1) % 4] - ctr)
        n = A / np.linalg.norm(A); dist = abs(np.dot(n, ctr - cs[own[i]]))
        fr.append(1 / (1 + b / dist) if b > 0 else 1.0)
    Uw = (U, 0, W); Pin = m['Pup'] / rho
    side = 'cyclic' if W else 'empty' if d.get('dim') == 2 else 'symmetry'
    # open outlet: the film's own pressure there instead of the plug (the flow rate is then OpenFOAM's, not the app's):
    # a level film at the app's end height h, p = rho g (h - y), so the modified pressure p + rho g y = rho g h
    pOut = m['g'] * d['hEnd'] if openOut else 0
    write(case, '0/U', 'volVectorField', f"""dimensions [0 1 -1 0 0 0 0];
internalField uniform {vec(Uw)};
boundaryField
{{
    web {{ type partialSlip; refValue uniform {vec(Uw)}; valueFraction {slist(fr)}; value uniform {vec(Uw)}; }}
    blade {{ type noSlip; }}
    surface {{ type slip; }}
    inlet {{ type directionMixed; refValue uniform (0 0 0); refGradient uniform (0 0 0); valueFraction uniform {'(0 0 0 1 0 0)' if W else '(0 0 0 1 0 1)'}; value uniform (0 0 0); }}
    outlet {{ {'type zeroGradient;' if openOut else f'type fixedValue; value uniform {vec(Uw)};'} }}
    sideLo {{ type {side}; }}
    sideHi {{ type {side}; }}
}}""")
    write(case, '0/p', 'volScalarField', f"""dimensions [0 2 -2 0 0 0 0];
internalField uniform {Pin:.10g};
boundaryField
{{
    web {{ type zeroGradient; }} blade {{ type zeroGradient; }} surface {{ type zeroGradient; }}
    inlet {{ type fixedValue; value uniform {Pin:.10g}; }}
    outlet {{ {f'type fixedValue; value uniform {pOut:.10g};' if openOut else 'type zeroGradient;'} }}
    sideLo {{ type {side}; }} sideHi {{ type {side}; }}
}}""")

if __name__ == '__main__':
    src, case = sys.argv[1], sys.argv[2]
    refine = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    nproc = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    openOut = len(sys.argv) > 5 and sys.argv[5] == 'open'
    d, b, U, W, rho, m = build(src, case, refine, nproc)
    print('checkMesh', run(case, 'checkMesh', 'log.checkMesh0'))
    for i in range(refine):
        print('refineMesh', i + 1, run(case, 'refineMesh -overwrite', f'log.refine{i + 1}'))
    print('checkMesh', run(case, 'checkMesh', 'log.checkMesh'))
    fields(case, d, b, U, W, rho, m, openOut)
    print('fields written; slip length b = %.4g m' % b)
