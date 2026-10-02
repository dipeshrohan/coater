// Run the app's Coating › 2D solve at a location and save its mesh, fields and inputs (for the OpenFOAM benchmark),
// in the 3D export's layout (exp3d.js) as a strip one layer thick: NL = 2, z = 0 and dz, node (c*NL + l)*NR + k.
// node exp2d.js <out.json> [port] [json of settings: { P: {...}, rheo: {...} (e.g. structOn: false), cfdg: {...} (e.g. model: 'newtonian'), loc (0..3), solver: {...} }]
const { chromium } = require('playwright'), fs = require('fs');
const OUT = process.argv[2], port = process.argv[3] || 8795, SET = JSON.parse(process.argv[4] || '{}');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { window.NO_WELCOME = true; window.PROJ_NO_FS = true; try { localStorage.clear(); } catch (e) {} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${port}/Blade%20Coat%20Defect%20Lab.html`); await p.waitForTimeout(1500);
  const t0 = Date.now();
  const info = await p.evaluate(async S => {
    if (S.P) Object.assign(P, S.P);
    if (S.rheo) Object.assign(MAT.rheo, S.rheo);
    if (S.cfdg) Object.assign(CFDG, S.cfdg);
    const L = S.loc || 0;
    if (S.solver) Object.assign(CFD_LOCS[L].solver, S.solver);
    navGo('cfd2d'); goStep2D('solve'); render();
    runLocation(L);
    for (let i = 0; i < 3600 && cfdRuns[L].status === 'running'; i++) await new Promise(r => setTimeout(r, 500));
    const run = cfdRuns[L];
    if (run.status !== 'done') return { error: run.status + ': ' + run.error };
    const r = run.result, geo = run.geo, m = cfdWorkerMessage(geo), H = r.H, nx = r.nx, ny = r.ny;
    const gdMin = geo.solver.gdMin > 0 ? geo.solver.gdMin : 1e-3 * m.U / H;
    // the viscosity the 2D uses at a shear rate: the law at sqrt(gd^2 + gdMin^2) (cfd-fem.js's regularisation)
    const law = gd => muEffLocal(gd, m.muRef, m.ty, m.n, m.rheoX);
    const tab = []; for (let e = -8; e <= 5.0001; e += 0.05) { const g = Math.pow(10, e); tab.push([g, law(Math.sqrt(g * g + gdMin * gdMin))]); }
    // the grid is row-major (k = j*nx + i: spine i, row j); the export is spine-major, two layers
    const dz = 2 * H, NL = 2, N = nx * NL * ny;
    const out = { x: new Array(N), y: new Array(N), z: new Array(N), u: new Array(N), v: new Array(N), w: new Array(N), p: new Array(N), gd: new Array(N), mu: new Array(N) };
    for (let c = 0; c < nx; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < ny; k++) {
      const n = (c * NL + l) * ny + k, g = k * nx + c;
      out.x[n] = r.gx[g]; out.y[n] = r.gy[g]; out.z[n] = l * dz; out.u[n] = r.u[g]; out.v[n] = r.v[g]; out.w[n] = 0; out.p[n] = r.p[g]; out.gd[n] = r.gd[g]; out.mu[n] = r.mu[g];
    }
    return { dim: 2, NC: nx, NR: ny, NL, cCorner: r.iCorner, cCL: r.iCL, xe: r.xe, H, mode: r.mode, converged: r.converged, iterations: r.iterations, residual: r.residual,
      Q: r.Q, massError: r.massError, hEnd: r.hEnd, xEnd: r.xEnd, pMax: r.pMax, mesh: r.mesh, ...out,
      msg: { U: m.U, webW: 0, Pup: m.Pup, rho: m.rho, g: m.g, gamma: m.gamma, muRef: m.muRef, ty: m.ty, n: m.n, rheoX: m.rheoX || null, webSlip: m.webSlip, contactDeg: m.contactDeg, exitAngle: m.exitAngle, gdMin, solver: m.solver, struct: m.struct || null },
      muTable: tab, set: S, loc: L, ms: run.elapsedMs };
  }, SET);
  info.wall_s = (Date.now() - t0) / 1000; info.errors = errs;
  fs.writeFileSync(OUT, JSON.stringify(info));
  console.log(info.error || `solved: NC ${info.NC} NR ${info.NR} cCorner ${info.cCorner} cCL ${info.cCL} H ${info.H} mode ${info.mode} Q/U ${(info.Q / info.msg.U * 1e3).toFixed(4)} mm it ${info.iterations} res ${info.residual} ${info.wall_s}s`, JSON.stringify(info.msg), errs);
  await b.close();
})();
