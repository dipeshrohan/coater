// Run the app's Coating › 3D strip solve and save its mesh, fields and inputs (for the OpenFOAM benchmark).
// node exp3d.js <out.json> [port] [json of settings: { skew (deg), nzStrip, stripW, loc, bow (mm) }]
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
    if (S.acr) Object.assign(ACR, S.acr);
    if (S.skew != null) P.skew = S.skew;
    if (S.nzStrip != null) C3D.nzStrip = S.nzStrip;
    if (S.stripW != null) C3D.stripW = S.stripW;
    if (S.loc != null) C3D.loc = S.loc;
    if (S.mesh) Object.assign(C3D, S.mesh);
    navGo('cfd3d'); goStep3D('solve'); render();
    c3dRun(true);
    for (let i = 0; i < 3600 && C3D_RUN.status === 'running'; i++) await new Promise(r => setTimeout(r, 500));
    if (C3D_RUN.status !== 'done') return { error: C3D_RUN.status + ': ' + C3D_RUN.error };
    const R = C3D_RES.result, m = c3dSolveMessage(false).msg, sv = m.solver, H = R.H;
    const gdMin = sv.gdMin > 0 ? sv.gdMin : 1e-3 * m.U / H;
    // the viscosity the 3D uses at a shear rate: the law at sqrt(gd^2 + gdMin^2) (cfd-fem3d.js's regularisation)
    const law = gd => muEffLocal(gd, m.muRef, m.ty, m.n, m.rheoX);
    const tab = []; for (let e = -8; e <= 5.0001; e += 0.05) { const g = Math.pow(10, e); tab.push([g, law(Math.sqrt(g * g + gdMin * gdMin))]); }
    const A = a => Array.from(a);
    let st = null; try { st = c3dResultStats(R, 9).S; } catch (e) { st = String(e); }
    return { NC: R.NC, NR: R.NR, NL: R.NL, cCorner: R.cCorner, cCL: R.cCL, xe: R.xe, H, skew: R.skew, zOff: R.zOff, converged: R.converged, iterations: R.iterations, residual: R.residual,
      massBalance: R.massBalance, x: A(R.x), y: A(R.y), z: A(R.z), u: A(R.u), v: A(R.v), w: A(R.w), p: A(R.p), gd: A(R.gd), mu: A(R.mu), top: R.top,
      msg: { U: m.U, webW: m.webW || 0, Pup: m.Pup, rho: m.rho, g: m.g, gamma: m.gamma, muRef: m.muRef, ty: m.ty, n: m.n, rheoX: m.rheoX || null, webSlip: m.webSlip, contactDeg: m.contactDeg, exitAngle: m.exitAngle, gdMin },
      muTable: tab, stats: st, set: S, gapAcross: Array.from({ length: 41 }, (_, i) => { const z = CFD_LOCS[C3D.loc].z - C3D.stripW / 2 + C3D.stripW * i / 40; return [z, cfdLocalGapMm(z)]; }), ms: C3D_RES.ms, strip: { W: C3D.stripW, nz: C3D.nzStrip, loc: C3D.loc } };
  }, SET);
  info.wall_s = (Date.now() - t0) / 1000; info.errors = errs;
  fs.writeFileSync(OUT, JSON.stringify(info));
  console.log(info.error || `solved: NC ${info.NC} NR ${info.NR} NL ${info.NL} cCorner ${info.cCorner} cCL ${info.cCL} H ${info.H} it ${info.iterations} res ${info.residual} ${info.wall_s}s`, JSON.stringify(info.msg), errs);
  await b.close();
})();
