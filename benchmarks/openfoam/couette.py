# Navier-slip Couette check of partialSlip (refValue = the wall's speed, valueFraction = 1/(1 + b delta)):
# exact wall velocity U / (1 + b / h), linear profile.
import os, shutil, re, sys
sys.path.insert(0, os.path.dirname(__file__)); from foamio import *
C = os.path.join(os.path.dirname(__file__), 'couette'); shutil.rmtree(C, ignore_errors=True)
h, L, U, b, ny = 1e-3, 1e-3, 0.01, 3e-5, 40
write(C, 'system/blockMeshDict', 'dictionary', f"""convertToMeters 1;
vertices ( (0 0 0) ({L} 0 0) ({L} {h} 0) (0 {h} 0) (0 0 1e-4) ({L} 0 1e-4) ({L} {h} 1e-4) (0 {h} 1e-4) );
blocks ( hex (0 1 2 3 4 5 6 7) (2 {ny} 1) simpleGrading (1 1 1) );
boundary (
  web {{ type wall; faces ((0 1 5 4)); }}
  top {{ type wall; faces ((3 7 6 2)); }}
  left {{ type cyclic; neighbourPatch right; faces ((0 4 7 3)); }}
  right {{ type cyclic; neighbourPatch left; faces ((1 2 6 5)); }}
  fb {{ type empty; faces ((0 3 2 1) (4 5 6 7)); }}
);""")
delta = 1 / (h / ny / 2); f = 1 / (1 + b * delta)
write(C, '0/U', 'volVectorField', f"""dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);
boundaryField {{
  web {{ type partialSlip; valueFraction uniform {f:.12g}; refValue uniform ({U} 0 0); value uniform ({U} 0 0); }}
  top {{ type noSlip; }}
  left {{ type cyclic; }} right {{ type cyclic; }} fb {{ type empty; }}
}}""")
write(C, '0/p', 'volScalarField', """dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField { web { type zeroGradient; } top { type zeroGradient; } left { type cyclic; } right { type cyclic; } fb { type empty; } }""")
write(C, 'constant/transportProperties', 'dictionary', 'transportModel Newtonian;\nnu 1e-3;')
write(C, 'constant/turbulenceProperties', 'dictionary', 'simulationType laminar;')
write(C, 'system/controlDict', 'dictionary', 'application simpleFoam; startFrom startTime; startTime 0; stopAt endTime; endTime 4000; deltaT 1; writeControl timeStep; writeInterval 4000; writeFormat ascii; writePrecision 12; runTimeModifiable false;')
write(C, 'system/fvSchemes', 'dictionary', """ddtSchemes { default steadyState; } gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss linear; div((nuEff*dev2(T(grad(U))))) Gauss linear; }
laplacianSchemes { default Gauss linear corrected; } interpolationSchemes { default linear; } snGradSchemes { default corrected; }""")
write(C, 'system/fvSolution', 'dictionary', """solvers { p { solver PCG; preconditioner DIC; tolerance 1e-12; relTol 0; } U { solver PBiCGStab; preconditioner DILU; tolerance 1e-14; relTol 0; } }
SIMPLE { nNonOrthogonalCorrectors 0; consistent yes; pRefCell 0; pRefValue 0; residualControl { U 1e-12; } }
relaxationFactors { equations { U 0.9; } fields { p 1; } }""")
print('blockMesh', run(C, 'blockMesh', 'log.blockMesh'), 'simpleFoam', run(C, 'simpleFoam', 'log.simpleFoam'))
last = sorted([d for d in os.listdir(C) if re.fullmatch(r'\d+', d) and d != '0'], key=int)[-1]
txt = open(os.path.join(C, last, 'U')).read()
cells = re.search(r'internalField\s+nonuniform List<vector>\s+\d+\s*\((.*?)\)\s*;', txt, re.S).group(1)
us = [float(t.strip('()').split()[0]) for t in re.findall(r'\([^()]*\)', cells)][:ny]
web = re.search(r'web\s*\{.*?value\s+uniform\s+\(([^)]*)\)|web\s*\{.*?value\s+nonuniform List<vector>\s+\d+\s*\(\s*\(([^)]*)\)', txt, re.S)
uw = float((web.group(1) or web.group(2)).split()[0])
exact = U / (1 + b / h)
print(f'iterations {last}; wall velocity OpenFOAM {uw:.8g}  exact {exact:.8g}  rel err {abs(uw-exact)/exact:.2e}')
ycs = [(j + 0.5) * h / ny for j in range(ny)]
print('max profile err', max(abs(us[j] - exact * (1 - ycs[j] / h)) for j in range(ny)) / exact)
