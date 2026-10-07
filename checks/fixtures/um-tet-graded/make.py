# gmsh's tetrahedral mesh of the box 0.02 x 0.01 x 0.015 m with the graded size of um-tetmesh.validate.js check 3:
# 0.5 mm along the line x = 0.01, y = 0 (across z), growing 0.3 per unit distance, 3 mm at most.
# gmsh (GPL) is used only here, to make this outside reference; it is not part of the app.
# Run: python3 make.py   (needs the gmsh Python package)  ->  gmsh.json { X, Y, Z, tet }
import json, gmsh
gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0); gmsh.model.add('box')
gmsh.model.occ.addBox(0, 0, 0, 0.02, 0.01, 0.015); gmsh.model.occ.synchronize()
f = gmsh.model.mesh.field.add('MathEval')
gmsh.model.mesh.field.setString(f, 'F', 'Min(0.003, 0.0005 + 0.3 * Sqrt((x - 0.01)^2 + y^2))')
gmsh.model.mesh.field.setAsBackgroundMesh(f)
for k, v in [('Mesh.MeshSizeExtendFromBoundary', 0), ('Mesh.MeshSizeFromPoints', 0), ('Mesh.MeshSizeFromCurvature', 0), ('Mesh.Algorithm3D', 1), ('Mesh.Optimize', 1)]: gmsh.option.setNumber(k, v)
gmsh.model.mesh.generate(3)
tags, xyz, _ = gmsh.model.mesh.getNodes(); idx = {int(t): i for i, t in enumerate(tags)}
_, en = gmsh.model.mesh.getElementsByType(4)
r = lambda v: [float('%.15g' % c) for c in v]
json.dump({ 'gmsh': gmsh.__version__, 'X': r(xyz[0::3]), 'Y': r(xyz[1::3]), 'Z': r(xyz[2::3]), 'tet': [idx[int(n)] for n in en] }, open('gmsh.json', 'w'), separators=(',', ':'))
print(len(tags), 'nodes', len(en) // 4, 'tetrahedra')
gmsh.finalize()
