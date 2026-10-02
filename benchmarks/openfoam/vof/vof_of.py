"""
The coating's free surface by OpenFOAM v1912 interFoam (volume of fluid: slurry and air, surface tension, the contact
angle on the blade's exit face, gravity), from the same inputs as the app's 2D (the export of exp2d.js): the blade's
underside, the pool's pressure, the web's speed and slip, the slurry's law, surface tension, contact angle.
Nothing of the app's solution is used: the free surface, the contact line and the film's thickness are OpenFOAM's own.

Domain (2D, one cell thick): under the blade (x 0 .. xe, web to the blade's underside), the film beyond the edge
(x xe .. xe + Lf, web to the edge's height H) and the air above it (H .. Ytop), the exit face its left wall.
  inlet       the pool's edge (x = 0): p + rho g y = Pup (p_rgh), slurry only, no flow across (pressureInletOutletVelocity)
  web         moving at U with the app's Navier slip (partialSlip, valueFraction 1/(1 + b delta) per face)
  blade       the underside: no slip
  exitFace    the exit face above the edge: no slip, the contact angle (constantAlphaContactAngle)
  atmosphere  the top of the air: open (totalPressure 0, air flows in or out)
  outlet      the film's end, far downstream: moving with the web (plug, both phases)
Run from a guess (slurry under the blade and a level film of the edge's height beyond it) until the film's flow
rate and its thickness settle.
usage: python3 vof_of.py <exp2d export.json> <case dir> [refine factor] [np]
"""
import json, os, sys, re, shutil, subprocess, math
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from foamio import write, slist

def grade(L, sections):
    """blockMesh multi-grading for one edge: sections [(length fraction, cell fraction, expansion)]"""
    return '(' + ' '.join('(%g %g %g)' % s for s in sections) + ')'

def build(src, case, f=1.0, nproc=1, Lf=20e-3, Ytop=6e-3, T_end=20.0):
    d = json.load(open(src)); m = d['msg']; NC, NR, NL = d['NC'], d['NR'], d['NL']
    X = np.array(d['x']); Y = np.array(d['y']); nid = lambda c, k: (c * NL) * NR + k
    cC = d['cCorner']; xe, H = d['xe'], d['H']
    under = [(X[nid(c, NR - 1)], Y[nid(c, NR - 1)]) for c in range(cC + 1)]   # the blade's underside (the app's input geometry)
    h0 = under[0][1]; xE = xe + Lf; dz = 1e-4
    r = lambda n: max(1, int(round(n * f)))
    nyG = r(24); nxA1, nxA2 = r(60), r(100); nxB1, nxB2 = r(80), r(60); nyB2a, nyB2b = r(30), r(25)
    nxA, nxB, nyB2 = nxA1 + nxA2, nxB1 + nxB2, nyB2a + nyB2b
    yS = H + 1.2e-3
    # vertices: 0 (0,0) 1 (xe,0) 2 (xE,0) 3 (0,h0) 4 (xe,H) 5 (xE,H) 6 (xe,Ytop) 7 (xE,Ytop); +8 at z = dz
    P = [(0, 0), (xe, 0), (xE, 0), (0, h0), (xe, H), (xE, H), (xe, Ytop), (xE, Ytop)]
    V = [(x, y, 0) for x, y in P] + [(x, y, dz) for x, y in P]
    gA = grade(xe, [(30e-3 / xe, nxA1 / nxA, 1), (1 - 30e-3 / xe, nxA2 / nxA, 1 / 8)])
    gB = grade(Lf, [(5e-3 / Lf, nxB1 / nxB, 8), (1 - 5e-3 / Lf, nxB2 / nxB, 1)])
    gY = grade(Ytop - H, [(1.2e-3 / (Ytop - H), nyB2a / nyB2, 1), (1 - 1.2e-3 / (Ytop - H), nyB2b / nyB2, 4)])
    blocks = [
        f'hex (0 1 4 3 8 9 12 11) ({nxA} {nyG} 1) edgeGrading ({gA} {gA} {gA} {gA} 1 1 1 1 1 1 1 1)',
        f'hex (1 2 5 4 9 10 13 12) ({nxB} {nyG} 1) edgeGrading ({gB} {gB} {gB} {gB} 1 1 1 1 1 1 1 1)',
        f'hex (4 5 7 6 12 13 15 14) ({nxB} {nyB2} 1) edgeGrading ({gB} {gB} {gB} {gB} {gY} {gY} {gY} {gY} 1 1 1 1)',
    ]
    poly = lambda a, b, z: f'polyLine {a} {b} (' + ' '.join('(%.12g %.12g %g)' % (x, y, z) for x, y in under[1:-1]) + ')'
    # (the underside runs from the inlet's top (3) to the edge (4))
    edges = [poly(3, 4, 0), poly(11, 12, dz)]
    pat = {
        'inlet': ('patch', ['(0 8 11 3)']),
        'web': ('wall', ['(0 1 9 8)', '(1 2 10 9)']),
        'blade': ('wall', ['(3 11 12 4)']),
        'exitFace': ('wall', ['(4 12 14 6)']),
        'atmosphere': ('patch', ['(6 14 15 7)']),
        'outlet': ('patch', ['(2 5 13 10)', '(5 7 15 13)']),
        'frontBack': ('empty', ['(0 3 4 1)', '(1 4 5 2)', '(4 6 7 5)', '(8 9 12 11)', '(9 10 13 12)', '(12 13 15 14)']),
    }
    shutil.rmtree(case, ignore_errors=True)
    write(case, 'system/blockMeshDict', 'dictionary', 'convertToMeters 1;\nvertices\n(\n%s\n);\nblocks\n(\n%s\n);\nedges\n(\n%s\n);\nboundary\n(\n%s\n);\nmergePatchPairs ();' % (
        '\n'.join('    (%.12g %.12g %.12g)' % v for v in V), '\n'.join('    ' + b for b in blocks), '\n'.join('    ' + e for e in edges),
        '\n'.join(f'    {k} {{ type {t}; faces ( {" ".join(fl)} ); }}' for k, (t, fl) in pat.items())))
    rho = m['rho']
    tab = '\n'.join('            (%.10g %.10g)' % (g, mu / rho) for g, mu in d['muTable'])
    mus = [mu for _, mu in d['muTable']]
    newt = max(mus) - min(mus) <= 1e-9 * max(mus)       # a Newtonian slurry (the free surface's benchmark: see README)
    slurry = (f'transportModel Newtonian; nu {mus[0] / rho:.10g}; rho {rho};' if newt else None)
    if newt:
        write(case, 'constant/transportProperties', 'dictionary', f"""phases (slurry air);
slurry {{ {slurry} }}
air {{ transportModel Newtonian; nu 1.5e-05; rho 1.2; }}
sigma {m['gamma']};""")
    else: write(case, 'constant/transportProperties', 'dictionary', f"""phases (slurry air);
slurry
{{
    transportModel strainRateFunction;
    strainRateFunctionCoeffs {{ function table
        (
{tab}
        ); }}
    nu {d['muTable'][-1][1] / rho:.10g};
    rho {rho};
}}
air {{ transportModel Newtonian; nu 1.5e-05; rho 1.2; }}
sigma {m['gamma']};""")
    write(case, 'constant/turbulenceProperties', 'dictionary', 'simulationType laminar;')
    write(case, 'constant/g', 'uniformDimensionedVectorField', f'dimensions [0 1 -2 0 0 0 0];\nvalue (0 {-m["g"]} 0);')
    write(case, 'system/controlDict', 'dictionary', f"""application interFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime {T_end};
deltaT 1e-5; writeControl adjustableRunTime; writeInterval 1; purgeWrite 0; writeFormat ascii; writePrecision 10;
timeFormat general; timePrecision 6; runTimeModifiable yes; adjustTimeStep yes; maxCo 0.3; maxAlphaCo 0.3; maxDeltaT 2e-3;""")
    write(case, 'system/fvSchemes', 'dictionary', """ddtSchemes { default Euler; }
gradSchemes { default Gauss linear; }
divSchemes
{
    div(rhoPhi,U) Gauss linearUpwind grad(U);
    div(phi,alpha) Gauss vanLeer;
    div(phirb,alpha) Gauss linear;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }""")
    write(case, 'system/fvSolution', 'dictionary', """solvers
{
    "alpha.slurry.*" { nAlphaCorr 2; nAlphaSubCycles 1; cAlpha 1; MULESCorr yes; nLimiterIter 3; solver smoothSolver; smoother symGaussSeidel; tolerance 1e-9; relTol 0; }
    "pcorr.*" { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }
    p_rgh { solver GAMG; smoother DIC; tolerance 1e-9; relTol 0.01; }
    p_rghFinal { $p_rgh; relTol 0; }
    "U.*" { solver PBiCGStab; preconditioner DILU; tolerance 1e-10; relTol 0; }
}
PIMPLE { momentumPredictor yes; nOuterCorrectors 2; nCorrectors 3; nNonOrthogonalCorrectors 1; }""")
    write(case, 'system/decomposeParDict', 'dictionary', f'numberOfSubdomains {nproc}; method simple; simpleCoeffs {{ n ({nproc} 1 1); delta 0.001; }}')
    # the starting guess: slurry under the blade and a level film of the edge's height beyond it
    write(case, 'system/setFieldsDict', 'dictionary', f"""defaultFieldValues ( volScalarFieldValue alpha.slurry 0 );
regions ( boxToCell {{ box (-1 -1 -1) ({xe} 1 1); fieldValues ( volScalarFieldValue alpha.slurry 1 ); }}
          boxToCell {{ box (-1 -1 -1) (1 {H} 1); fieldValues ( volScalarFieldValue alpha.slurry 1 ); }} );""")
    return d

def fields(case, d):
    m = d['msg']; U = m['U']; b = 1 / m['webSlip'] if m.get('webSlip') else 0
    import importlib.util
    spec = importlib.util.spec_from_file_location('ofs', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'compare.py'))
    cmp_ = importlib.util.module_from_spec(spec); spec.loader.exec_module(cmp_)
    Pm = case + '/constant/polyMesh/'
    pts = cmp_.read_list(Pm + 'points', 'vector'); fcs = cmp_.read_list(Pm + 'faces', 'face'); own = cmp_.read_list(Pm + 'owner', 'label'); nb = cmp_.read_list(Pm + 'neighbour', 'label')
    nc = int(own.max()) + 1; cs = np.zeros((nc, 3)); cn = np.zeros(nc); fc = np.array([pts[q].mean(0) for q in fcs])
    np.add.at(cs, own, fc); np.add.at(cn, own, 1); np.add.at(cs, nb, fc[:len(nb)]); np.add.at(cn, nb, 1); cs /= cn[:, None]
    bnd = open(Pm + 'boundary').read(); mt = re.search(r'web\s*\{[^}]*nFaces\s+(\d+);\s*startFace\s+(\d+);', bnd); nW, sW = int(mt.group(1)), int(mt.group(2))
    fr = []
    for i in range(sW, sW + nW):
        dist = abs(fc[i][1] - cs[own[i]][1]); fr.append(1 / (1 + b / dist) if b > 0 else 1.0)
    Uw = f'({U:.12g} 0 0)'
    e = 'frontBack { type empty; }'
    write(case, '0/U', 'volVectorField', f"""dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);
boundaryField
{{
    inlet {{ type pressureInletOutletVelocity; value uniform (0 0 0); }}
    web {{ type partialSlip; refValue uniform {Uw}; valueFraction {slist(fr)}; value uniform {Uw}; }}
    blade {{ type noSlip; }}
    exitFace {{ type noSlip; }}
    atmosphere {{ type pressureInletOutletVelocity; value uniform (0 0 0); }}
    outlet {{ type fixedValue; value uniform {Uw}; }}
    {e}
}}""")
    write(case, '0/p_rgh', 'volScalarField', f"""dimensions [1 -1 -2 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type fixedValue; value uniform {m['Pup']}; }}
    web {{ type fixedFluxPressure; value uniform 0; }}
    blade {{ type fixedFluxPressure; value uniform 0; }}
    exitFace {{ type fixedFluxPressure; value uniform 0; }}
    atmosphere {{ type totalPressure; p0 uniform 0; }}
    outlet {{ type fixedFluxPressure; value uniform 0; }}
    {e}
}}""")
    write(case, '0/alpha.slurry.orig', 'volScalarField', f"""dimensions [0 0 0 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type fixedValue; value uniform 1; }}
    web {{ type zeroGradient; }}
    blade {{ type zeroGradient; }}
    exitFace {{ type constantAlphaContactAngle; theta0 {m['contactDeg']:.10g}; limit gradient; value uniform 0; }}
    atmosphere {{ type inletOutlet; inletValue uniform 0; value uniform 0; }}
    outlet {{ type zeroGradient; }}
    {e}
}}""")
    shutil.copy(f'{case}/0/alpha.slurry.orig', f'{case}/0/alpha.slurry')

def sh(case, cmd, log):
    r = subprocess.run(['bash', '-c', f'source /usr/share/openfoam/etc/bashrc >/dev/null 2>&1; cd "{case}" && {cmd} > {log} 2>&1'])
    return r.returncode

if __name__ == '__main__':
    src, case = sys.argv[1], sys.argv[2]; f = float(sys.argv[3]) if len(sys.argv) > 3 else 1; nproc = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    d = build(src, case, f, nproc)
    print('blockMesh', sh(case, 'blockMesh', 'log.blockMesh'), 'checkMesh', sh(case, 'checkMesh', 'log.checkMesh'))
    fields(case, d)
    print('setFields', sh(case, 'setFields', 'log.setFields'))
