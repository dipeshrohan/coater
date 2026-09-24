/*
 * simulation.js — the real-time slurry animation engine.
 *
 * This drives the "Slurry animation" tab: a live thin-film simulation that
 * advances a pool volume balance and solves the downstream liquid surface
 * (a 4th-order thin-film PDE — viscous flow + surface tension + gravity,
 * against the moving web) on every animation frame, at interactive speed.
 *
 * Everything here is wrapped in one IIFE and exposes a single global,
 * ANIM, so ui.js can start/stop/seek it and read what it's currently
 * showing without reaching into its internals. That encapsulation is
 * deliberate — the state below (SIM, the particle systems, the live
 * geometry) is only ever safe to read through the ANIM API.
 *
 * Depends on physics.js (P, RHO, GRAVITY, SIN45, muEff, contactLine,
 * gapHeight, spatialNoise) and draw.js (cssVar), both of which must be
 * loaded first.
 */
const ANIM = (function () {
  // ---- canvas + view-window state ----------------------------------
  let cv, W = 0, Hh = 0, DPR = 1, ctx, cv2 = null, MAG = null;
  const XMIN = -16, XMAX = 9, YMIN = -1.0, YMAX = 9.6;
  const SC = () => W / (XMAX - XMIN); // data units -> device pixels

  let GAP = 1.70, HF = 1.45, U = 4.667, Q = U * HF, S1 = 5, WET = false;
  let ST = { s: 0, pinned: true };
  const FT = 0.20;  // fibre thickness, mm (local view copy of P.tf at model build time)
  const RB = 50;    // blade roll radius in view units, purely for the cross-section art
  let NX = -12;     // feed nozzle x position

  // Blade geometry points, rebuilt by setModel(): E = metering edge,
  // (CX,CY) = blade roll centre, V = notch corner, Dd = dry second edge.
  let E, CX, CY, V, Dd, MEN = [[0, 0]], TH = 35;
  const under = x => CY - Math.sqrt(Math.max(RB * RB - (x - CX) * (x - CX), 0));

  // ---- small numeric helpers ----------------------------------------
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // fades an overlay in starting at time a, out ending at time b, over a transition width f
  const fadeWindow = (t, a, b, f) => smoothstep(a, a + f, t) * (1 - smoothstep(b - f, b, t));
  const CYCLE_T = 58; // seconds per animation loop

  let CL = {};
  function updateThemeColors() {
    CL.surface = cssVar('--surface'); CL.ink = cssVar('--ink'); CL.muted = cssVar('--muted');
    CL.line = cssVar('--line'); CL.blue = cssVar('--accent'); CL.red = cssVar('--bad');
    CL.green = cssVar('--ok'); CL.blade = cssVar('--blade'); CL.fibre = cssVar('--fibre');
    CL.backing = cssVar('--soft'); CL.sfill = '0.16'; CL.sans = cssVar('--sans');
  }

  // (a canvas's data-maxh, px, caps its height: it then narrows, keeping its proportions)
  function resizeCanvas() {
    const pw = cv.parentElement.clientWidth || 900, maxH = +cv.dataset.maxh || Infinity;
    const w = Math.min(pw, maxH * (XMAX - XMIN) / (YMAX - YMIN));
    cv.style.width = w + 'px';
    DPR = window.devicePixelRatio || 1;
    W = w;
    Hh = w * (YMAX - YMIN) / (XMAX - XMIN);
    cv.style.height = Hh + 'px';
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(Hh * DPR);
    ctx = cv.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  const X = x => (x - XMIN) * SC();
  const Y = y => Hh - (y - YMIN) * SC();

  // ------------------------------------------------------------------
  // Pool + downstream-film state. SIM.h is the live film-height field
  // solved by simStep() every frame; SIM.V/SIM.L track the upstream pool
  // via a volume balance (see simStep). Kept module-private — read it
  // through scene()/ANIM's public getters, never directly.
  // ------------------------------------------------------------------
  const SIM = {
    cl: 0, x0: 0, dx: 0.05, h: new Float64Array(2), t: 0, hc0: 0.02,
    V: 0, L: 4, Uf: 0, s: 0, qg: 0, feed: 0, safe: true, limited: false,
  };
  const HP = 0.02;       // floor film height, mm — keeps the solver away from h=0
  const TS = 3, TR = 1.5; // web start time and ramp-up duration, s
  let UN = 4.667;        // web speed once fully up to speed, mm/s (view units)
  let AT = [];           // pool cross-sectional area lookup table, indexed by pool level L

  /** Precompute pool cross-sectional area vs. level (used to convert volume <-> level without solving geometry every frame). */
  function buildAreaTable() {
    AT = [];
    const XL = CX - RB;
    for (let level = 0; level <= 10.0001; level += 0.05) {
      let area = level * Math.max(AN.Lp + XL, 0);
      for (let x = XL; x <= 0; x += 0.05) area += Math.min(level, under(x)) * 0.05;
      AT.push(area);
    }
  }
  const areaOf = level => {
    const f = clamp(level, 0, 10) / 0.05, i = Math.min(Math.floor(f), AT.length - 2);
    return AT[i] + (AT[i + 1] - AT[i]) * (f - i);
  };
  const levelOf = vol => {
    let lo = 0, hi = AT.length - 1;
    if (vol <= AT[0]) return 0;
    if (vol >= AT[hi]) return 10;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; AT[m] < vol ? lo = m : hi = m; }
    return (lo + (vol - AT[lo]) / (AT[hi] - AT[lo])) * 0.05;
  };

  function simReset() {
    SIM.h.fill(HP); SIM.hc0 = HP; SIM.t = 0; SIM.Uf = 0; SIM.s = 0; SIM.qg = 0; SIM.feed = 0;
    SIM.safe = true; SIM.limited = false;
    SIM.V = areaOf(AN.L0); SIM.L = AN.L0;
  }

  const TF = 1.0; // feed-pulse ramp time, s
  /** Feed-nozzle pulse shape at time tau since the web started (1 = full rate, dips between pulses). */
  const pulseAmp = tau => {
    if (tau < TF) return 0;
    const period = AN.fp, dutyFrac = AN.fd, depth = AN.fa;
    const k = Math.floor((tau - TF) / period);
    const ph = (tau - TF) - k * period;
    const w = smoothstep(0, 0.25, ph) * (1 - smoothstep(dutyFrac * period - 0.25, dutyFrac * period, ph));
    const on = 1 - depth + depth / dutyFrac, off = 1 - depth;
    return (off + (on - off) * w) / on;
  };

  /** Flow rate through the gap (mm^3/s per mm width) for web speed Uf and current pool level L — same lubrication formula as physics.js's filmThickness(), expressed as a flux instead of a thickness, with bead pressure scaled by pool depth (pe = P.Pup * L/L0). */
  function qgap(Uf, level) {
    const pe = P.Pup * (level / AN.L0);
    const H = GAP * 1e-3, u = Uf * 1e-3;
    const gd = Math.max(Uf / GAP, 1e-3);
    const mu = Math.max(muEff(gd), 0.05);
    const dpdx = pe * 1000 / (P.L * 1e-3);
    const q = (u * H / 2 + H * H * H * dpdx / (12 * mu)) * 1e6;
    return Math.max(0, q);
  }

  /** Re-grid SIM.h onto a fresh uniform mesh from x=0 to XMAX, resampling the old field (called whenever the model geometry changes). */
  function simGrid() {
    const xc = 0, N = Math.max(20, Math.round((XMAX - xc) / 0.05)), dx = (XMAX - xc) / N;
    const old = SIM.h, ox = SIM.x0, od = SIM.dx, on = old.length;
    const nh = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const x = xc + i * dx, f = (x - ox) / od;
      if (on < 3) { nh[i] = HP; continue; }
      if (f < 0) { nh[i] = old[0]; continue; }
      const k = Math.min(Math.floor(f), on - 2);
      nh[i] = old[k] + (old[k + 1] - old[k]) * Math.min(f - k, 1);
    }
    SIM.h = nh; SIM.x0 = xc; SIM.dx = dx;
  }

  /**
   * Advance the simulation by dt seconds:
   *  1) ramp the web speed up, compute the feed-pulse shape and the pool
   *     volume balance (feed in vs. gap flow out, supply-limited if the
   *     pool can't keep up — see the "Conservation" note in the UI),
   *  2) solve the downstream thin-film PDE implicitly on a banded system
   *     (flux = drag term + surface-tension curvature term + gravity
   *     term), starting from the contact-line height at the blade.
   * Any non-finite or non-physical result (NaN, negative height, height
   * past the top of the view) marks SIM.safe = false and freezes the
   * surface rather than ever drawing an invalid solution.
   */
  function simStep(dt) {
    const tn = SIM.t, dx = SIM.dx * 1e-3;

    const Uf = UN * smoothstep(TS, TS + TR, tn);
    SIM.Uf = Uf;
    const Um = Uf * 1e-3;

    const shape = tn < TS ? 0 : pulseAmp(tn - TS + TF);
    SIM.feed = shape;
    const Qf = UN * HF * shape * (1 - AN.fa + AN.fa / AN.fd);

    const requested = qgap(Uf, SIM.L);
    const Vmin = areaOf(0.3);
    const qg = Math.min(requested, Qf + Math.max(SIM.V - Vmin, 0) / dt);
    SIM.qg = qg;
    SIM.limited = qg + 1e-9 < requested;

    SIM.V = Math.max(Vmin, SIM.V + (Qf - qg) * dt);
    SIM.L = Math.max(levelOf(SIM.V), 0.3);
    SIM.s += Uf * dt;

    // Where the contact line currently sits, in grid-index terms. hc0Target
    // is where it's ultimately headed (gated by the web speed ramp); SIM.hc0
    // is rate-limited to reach it at no more than a tenth of a grid cell per
    // step (a quarter cell was enough for default and most single-slider
    // extremes, but a worst-case combination of four extreme sliders at once
    // still broke through it, so this leaves more margin). Without this
    // limiter, hc0Target can swing tens of mm/s during
    // the web start-up ramp (it goes from ~HP to past GAP in well under a
    // second), far faster than the dx=0.05mm grid can track — the pinned
    // region (k0 below) would engage abruptly with the just-pinned boundary
    // height completely disconnected from what the free-evolving field next
    // to it had actually reached, producing a severe local discontinuity
    // that the implicit solve can't absorb in one step (confirmed by
    // instrumenting a failing step: h0 was 2.10mm against an adjacent
    // free-field value of 0.86mm, a huge jump over a single 0.05mm cell).
    // That discontinuity was the actual cause of the animation freezing
    // (SIM.safe = false) early in nearly every run at default settings.
    const Hc = MEN[0][1];
    const hc0Target = HP + (Math.min(Hc, SIM.L) - HP) * smoothstep(0.05, 0.5, Uf / UN);
    if (SIM.hc0 === undefined) SIM.hc0 = HP;
    SIM.hc0 += clamp(hc0Target - SIM.hc0, -SIM.dx * 0.1, SIM.dx * 0.1);
    const hc0 = SIM.hc0;
    const Nall = SIM.h.length - 1;
    const k0 = Math.max(0, Math.min(Math.ceil((hc0 - GAP) / SIM.dx), Nall - 4));
    const h0mm = k0 > 0 ? GAP + k0 * SIM.dx : hc0;
    const h0 = h0mm * 1e-3, qin = qg * 1e-6;
    SIM.cl = k0 * SIM.dx;
    for (let i = 0; i < k0; i++) SIM.h[i] = GAP + i * SIM.dx;

    const h = SIM.h.subarray(k0), N = h.length - 1;
    const mu = Math.max(muEff(Math.max(UN / GAP, 1e-3)), 0.05);
    const gam = P.g, rg = RHO * GRAVITY;

    // Banded (5-wide) linear system for the implicit update of h[1..N-1].
    // A[j] holds coefficients for columns j-2..j+2 (index 2 = diagonal).
    const M = N - 1;
    const A = new Array(M), b = new Float64Array(M), x = new Float64Array(M);
    for (let j = 0; j < M; j++) { A[j] = [0, 0, 0, 0, 0]; b[j] = h[j + 1] * 1e-3 / dt; }

    const hm = i => (i === 0 ? h0 : h[Math.min(i, N)] * 1e-3);
    const mobility = i => { const q = (hm(i) + hm(i + 1)) / 2; return q * q * q / (3 * mu); };
    const add = (i, idx, coeff) => {
      const j = i - 1;
      if (idx === 0) { b[j] -= coeff * h0; return; }
      if (idx > N - 1) idx = N - 1;
      A[j][idx - i + 2] += coeff;
    };

    for (let i = 1; i <= N - 1; i++) {
      const m1 = mobility(i), capTerm = m1 * gam / (dx * dx * dx), gravTerm = m1 * rg / dx;
      const inv = 1 / dx;
      add(i, i + 2, capTerm * inv);
      add(i, i + 1, (-3 * capTerm - gravTerm) * inv);
      add(i, i, (3 * capTerm + Um + gravTerm) * inv);
      add(i, i - 1, (-capTerm) * inv);
      if (i === 1) {
        b[0] += qin * inv;
      } else {
        const m0 = mobility(i - 1), capTerm0 = m0 * gam / (dx * dx * dx), gravTerm0 = m0 * rg / dx;
        add(i, i + 1, -capTerm0 * inv);
        add(i, i, (3 * capTerm0 + gravTerm0) * inv);
        add(i, i - 1, (-3 * capTerm0 - Um - gravTerm0) * inv);
        add(i, i - 2, capTerm0 * inv);
      }
      A[i - 1][2] += 1 / dt;
    }

    // Banded Gaussian elimination (forward sweep)...
    for (let j = 0; j < M; j++) {
      const p = A[j][2];
      if (!Number.isFinite(p) || Math.abs(p) < 1e-14) { SIM.safe = false; SIM.t += dt; return; }
      for (let r = 1; r <= 2 && j + r < M; r++) {
        const f = A[j + r][2 - r] / p;
        if (!f) continue;
        for (let c = 0; c <= 2; c++) A[j + r][2 + c - r] -= f * A[j][2 + c];
        b[j + r] -= f * b[j];
      }
    }
    // ...and back-substitution.
    for (let j = M - 1; j >= 0; j--) {
      let sm = b[j];
      for (let c = 1; c <= 2 && j + c < M; c++) sm -= A[j][2 + c] * x[j + c];
      x[j] = sm / A[j][2];
    }

    if (x.some(v => !Number.isFinite(v) || v <= 0 || v * 1e3 > YMAX)) {
      SIM.safe = false; SIM.t += dt; return;
    }
    SIM.safe = true;
    for (let j = 0; j < M; j++) h[j + 1] = Math.max(x[j] * 1e3, HP * 0.5);
    h[N] = h[N - 1];
    h[0] = h0mm;
    SIM.t += dt;
  }

  /** Catch the simulation clock up to time t, one fixed dt=0.02s step at a time (re-seeding from t=0 if seeking backward). */
  function simSync(t) {
    if (t < SIM.t - 1e-6 || !SIM.init) { SIM.init = 1; simReset(); }
    const dt = 0.02;
    let guard = 0;
    while (SIM.safe && SIM.t + dt <= t + 1e-9 && guard++ < 4000) simStep(dt);
  }

  /**
   * Rebuild the static blade/gap/contact-line geometry from the current
   * parameters P and the across-web position AN.z (this is where the
   * "Position across web" slider and the waviness/wetting-variation
   * sliders enter the animation — same contactLine() physics as the
   * static tabs, just re-evaluated at a chosen z).
   */
  function setModel() {
    const z = AN.z;
    const H = gapHeight() + (P.dH * Math.sin(2 * Math.PI * z / P.lw) - P.dt * spatialNoise(z, 1.7)) / 1000;
    const th = P.th + P.dth * spatialNoise(z, 4.1);
    const st = contactLine(H, th);
    ST = st; GAP = H; UN = P.U / 60 * 1000; U = UN; HF = st.h; Q = U * HF;

    S1 = Math.min(P.face, 9.5);
    E = [0, GAP];
    CX = E[0] + RB * 50 / 190;
    CY = E[1] + RB * 183.3 / 190;
    V = [E[0] + S1 * SIN45, E[1] + S1 * SIN45];
    {
      // intersection of the notch face line with the blade roll's circular back
      const d1 = SIN45;
      const c = (V[0] - CX) ** 2 + (V[1] - CY) ** 2 - RB * RB;
      const qa = 2 * d1 * d1;
      const qb = 2 * ((V[0] - CX) * d1 - (V[1] - CY) * d1);
      const t = (-qb + Math.sqrt(qb * qb - 4 * qa * c)) / (2 * qa);
      Dd = [V[0] + t * d1, V[1] - t * d1];
    }
    WET = st.s >= P.face;
    const sd = Math.min(st.s, S1);
    const xq = sd * SIN45;
    MEN = [[xq, GAP + xq]];

    NX = Math.max(XMIN + 1.6, CX - Math.sqrt(Math.max(RB * RB - (CY - (AN.L0 + 2.5)) ** 2, 0)) - 0.5);
    simGrid();
    buildAreaTable();
    if (SIM.init) SIM.L = Math.max(levelOf(SIM.V), 0.3);

    initParticles();
    TH = th;
    AN.info = { H, th, st, WET };
  }

  /** Assemble the current visible scene (pool bead shape + downstream film) from SIM state, for drawing and for the streamfunction. */
  function scene(t) {
    const Lc = SIM.L;
    U = SIM.Uf; Q = SIM.qg;
    const bead = Lc > GAP + 0.02;
    const xb = bead ? CX - Math.sqrt(Math.max(RB * RB - (CY - Lc) * (CY - Lc), 0)) : 0;
    const ys = x => Lc;

    const xq = SIM.cl, xc = SIM.x0, dxm = SIM.dx, hh = SIM.h, n = hh.length, h0 = hh[0];
    const mp = new Array(n);
    for (let i = 0; i < n; i++) mp[i] = [xc + i * dxm, hh[i]];

    const Hc = MEN[0][1];
    let xm = Math.min(xq + 4, XMAX);
    for (let i = 1; i < n; i++) {
      if (hh[i] < HF + 0.03 * Math.max(Hc - HF, 0.05)) { xm = Math.max(mp[i][0], xq + 0.6); break; }
    }

    const kx = 1 - smoothstep(0.05, 0.3, SIM.Uf / UN), EXD = 0.5;
    const exitY = x => (x < 0 || x >= EXD) ? 0 : GAP * Math.sqrt(1 - x / EXD);
    const menY = x => {
      if (x <= 0) return GAP;
      let s;
      if (x >= XMAX) s = hh[n - 1];
      else { const f = (x - xc) / dxm, i = Math.min(Math.floor(f), n - 2); s = hh[i] + (hh[i + 1] - hh[i]) * (f - i); }
      return Math.max(s, kx * exitY(x));
    };
    const top = x => {
      if (x <= 0) return bead ? (x < xb ? Lc : under(x)) : Math.min(Lc, under(x));
      return menY(x);
    };
    return { L: Lc, xb, ys, xq, xm, mp, menY, top, bead };
  }

  // ------------------------------------------------------------------
  // Flow visualisation: a lubrication stream function blended between
  // the free-surface (bead) and no-slip (gap) velocity profiles, used
  // only to draw streamlines/particle traces — not part of the physics
  // that drives the film height itself.
  // ------------------------------------------------------------------
  function psi(sc, x, y) {
    const h = sc.top(x);
    if (h <= 1e-6) return 0;
    const qf = Math.min(Q, U * h);
    const a = 6 * (U * h / 2 - Q) / (h * h * h);
    const g = 3 * (U * h - qf) / (2 * h * h * h);
    const noSlip = U * (y - y * y / (2 * h)) - a * (y * y * h / 2 - y * y * y / 3);
    const freeSurface = U * y + g * (y * y * y / 3 - h * y * y);
    let w;
    if (x < 0) w = sc.bead ? smoothstep(sc.xb - 0.3, sc.xb + 0.7, x) : 0;
    else w = 1 - smoothstep(0, 1.3, x);
    return (1 - w) * freeSurface + w * noSlip;
  }
  function vort(sc, x, y) {
    if (!sc.bead) return 0;
    const h = sc.top(x);
    if (h <= 0.05) return 0;
    const b = smoothstep(sc.xb - 2.2, sc.xb + 0.2, x) * (1 - smoothstep(-1.6, -0.5, x));
    if (b <= 0) return 0;
    const s = y / h;
    if (s <= 0 || s >= 1) return 0;
    return 0.16 * Math.max(U * sc.L, 0.05) * b * s * s * (1 - s) * (1 - s) * 16;
  }
  function psi2(sc, x, y) { return psi(sc, x, y) + vort(sc, x, y); }
  function vel(sc, x, y) {
    const e = 0.012;
    return [
      (psi2(sc, x, y + e) - psi2(sc, x, y - e)) / (2 * e),
      -(psi2(sc, x + e, y) - psi2(sc, x - e, y)) / (2 * e),
    ];
  }
  function traceStreamline(sc, x0, y0, dir, maxSteps, closed) {
    const pts = [[x0, y0]];
    let x = x0, y = y0;
    const p0 = psi2(sc, x0, y0), ds = 0.05;
    for (let i = 0; i < maxSteps; i++) {
      let v = vel(sc, x, y);
      let m = Math.hypot(v[0], v[1]);
      if (m < 1e-4) break;
      const mx = x + dir * ds * 0.5 * v[0] / m, my = y + dir * ds * 0.5 * v[1] / m;
      const v2 = vel(sc, mx, my), m2 = Math.hypot(v2[0], v2[1]);
      if (m2 < 1e-4) break;
      x += dir * ds * v2[0] / m2; y += dir * ds * v2[1] / m2;
      const vv = vel(sc, x, y);
      if (Math.abs(vv[0]) > 0.02) y -= (psi2(sc, x, y) - p0) / vv[0]; // pull back onto the streamline's psi contour
      const h = sc.top(x);
      if (x > XMAX || x < XMIN || h < 0.05 || y < 0.003 || y > h) break;
      pts.push([x, y]);
      if (closed && i > 25 && Math.hypot(x - x0, y - y0) < ds * 1.2) { pts.push([x0, y0]); break; }
    }
    return pts;
  }
  function getStreamlines(sc) {
    if (sc.__sl) return sc.__sl;
    const lines = [];
    const N = 11;
    for (let k = 1; k < N; k++) {
      const p = Q * k / N;
      const h = sc.top(XMIN + 0.01);
      let lo = 0, hi = h;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; psi(sc, XMIN + 0.01, m) < p ? lo = m : hi = m; }
      lines.push(traceStreamline(sc, XMIN + 0.01, (lo + hi) / 2, 1, 900, false));
    }
    if (sc.bead) {
      const cx = (sc.xb - 1) * 0.5 + (-1.1) * 0.5 + 0.2;
      const h = sc.top(cx);
      for (const f of [0.25, 0.5, 0.75]) lines.push(traceStreamline(sc, cx, h * f, 1, 900, true));
    }
    sc.__sl = lines;
    return lines;
  }
  function velocityAt(sc, x, y) {
    const e = 0.01;
    const h = sc.top(x);
    const y1 = Math.max(y - e, 0), y2 = Math.min(y + e, h);
    return (psi(sc, x, y2) - psi(sc, x, y1)) / (y2 - y1);
  }

  // ---- particles carried by the flow field (purely visual) ----------
  let PT = [];
  function initParticles() {
    PT = [];
    const sc = SIM.init ? scene(0) : null;
    for (let i = 0; i < 220; i++) {
      const x = XMIN + Math.random() * (-XMIN), h = sc ? sc.top(x) : 1;
      PT.push({ x, y: Math.random() * Math.max(h, 0.05), tr: [] });
    }
  }
  let PP = []; // porous-fibre penetration dots
  function initPenetrationDots() {
    PP = [];
    for (let i = 0; i < 40; i++) PP.push({ x: 0.3 + Math.random() * 7.8, y: -Math.random() * FT, a: Math.random() });
  }
  function stepParticles(sc, dt) {
    for (const q of PT) {
      const n = 4;
      for (let k = 0; k < n; k++) {
        const h = sc.top(q.x);
        if (h < 0.05) { q.x += U * dt / n; q.y = Math.min(q.y, 0.01); continue; }
        const v = vel(sc, q.x, q.y);
        const mx = q.x + v[0] * dt / n / 2, my = q.y + v[1] * dt / n / 2;
        const v2 = vel(sc, mx, my);
        q.x += Math.max(v2[0], -U * 3) * dt / n;
        q.y += v2[1] * dt / n;
        const h2 = sc.top(q.x);
        q.y = clamp(q.y, 0, Math.max(h2 - 0.01, 0.005));
      }
      q.tr.push([q.x, q.y]);
      if (q.tr.length > 14) q.tr.shift();
      if (q.x > XMAX || q.x < XMIN - 1) {
        q.x = XMIN + Math.random() * 2;
        const h = sc.top(q.x);
        q.y = Math.random() * h; q.tr = [];
      }
    }
    for (const q of PP) {
      q.y -= 0.16 * dt; q.a -= 0.5 * dt;
      if (q.y < -FT || q.a <= 0) { q.x = 0.3 + Math.random() * 7.8; q.y = 0; q.a = 1; }
    }
  }

  // ---- drawing primitives (private to this module's canvas) ---------
  function path(pts) {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
  }
  function arrow(x1, y1, x2, y2, col, lw, al, head) {
    ctx.save(); ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    const a = Math.atan2(Y(y2) - Y(y1), X(x2) - X(x1)), hd = head || 9;
    ctx.beginPath(); ctx.moveTo(X(x1), Y(y1));
    ctx.lineTo(X(x2) - Math.cos(a) * hd * 0.6, Y(y2) - Math.sin(a) * hd * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(x2), Y(y2));
    ctx.lineTo(X(x2) - hd * Math.cos(a - 0.4), Y(y2) - hd * Math.sin(a - 0.4));
    ctx.lineTo(X(x2) - hd * Math.cos(a + 0.4), Y(y2) - hd * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function label(txt, x, y, col, size, al, align, bold) {
    ctx.save(); ctx.globalAlpha = al;
    ctx.font = (bold ? '600 ' : '500 ') + size + 'px ' + CL.sans;
    ctx.textAlign = align || 'left'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
    ctx.strokeStyle = CL.surface; ctx.strokeText(txt, x, y);
    ctx.fillStyle = col; ctx.fillText(txt, x, y);
    ctx.restore();
  }
  function dot(x, y, r, col, al) {
    ctx.save(); ctx.globalAlpha = al; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, 7); ctx.fill(); ctx.restore();
  }
  function arrow2(x1, y1, x2, y2, col, lw, al, head) {
    // like arrow(), but for the magnified inset which already works in device pixels
    ctx.save(); ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
    ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /** Render one frame of the main animation canvas: fibre/backing, slurry bead + film outline, streamlines/particles, blade, feed nozzle, and the sequence of explanatory overlays that fade in/out as the clock runs. */
  function draw(t, sc) {
    const fs = Math.max(11, W / 80);
    ctx.clearRect(0, 0, W, Hh);

    // backing and porous fibre, weave scrolls with the web
    ctx.fillStyle = CL.backing; ctx.fillRect(0, Y(-FT), W, (YMIN - (-FT)) * -SC());
    ctx.fillStyle = CL.fibre; ctx.fillRect(0, Y(0), W, FT * SC());
    ctx.save(); ctx.beginPath(); ctx.rect(0, Y(0), W, FT * SC()); ctx.clip();
    ctx.strokeStyle = CL.muted; ctx.globalAlpha = .6; ctx.lineWidth = 1;
    const weaveOff = SIM.s % 0.4;
    for (let x = XMIN - 1 + weaveOff; x < XMAX + 1; x += 0.4) {
      ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x + 0.18), Y(-FT)); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = CL.ink; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.moveTo(0, Y(-FT)); ctx.lineTo(W, Y(-FT)); ctx.stroke();
    label('fibre moves →', X(XMIN + 0.3), Y(-0.6), CL.muted, fs, 1, 'left');

    // slurry outline (from the pool bead through the downstream film)
    const pts = [];
    {
      const xs = [];
      for (let x = XMIN; x <= XMAX; x += 0.04) xs.push([x, sc.top(x)]);
      let i0 = xs.findIndex(p => p[1] > 0.03);
      if (i0 < 0) i0 = xs.length;
      let i1 = xs.length - 1;
      while (i1 > i0 && xs[i1][1] <= 0.03) i1--;
      if (i0 <= i1) {
        pts.push([xs[i0][0], 0]);
        for (let i = i0; i <= i1; i++) pts.push(xs[i]);
        pts.push([xs[i1][0], 0]);
      }
    }
    path(pts); ctx.closePath();
    ctx.save(); ctx.globalAlpha = +CL.sfill; ctx.fillStyle = CL.blue; ctx.fill(); ctx.restore();

    // streamlines and particle traces inside the slurry
    const streamlineAlpha = fadeWindow(t, 5, 60, 3);
    ctx.save(); path(pts); ctx.closePath(); ctx.clip();
    if (streamlineAlpha > 0) {
      const SL = getStreamlines(sc);
      ctx.strokeStyle = CL.ink; ctx.globalAlpha = 0.28 * streamlineAlpha; ctx.lineWidth = 1;
      for (const l of SL) {
        ctx.beginPath();
        l.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
        ctx.stroke();
      }
      ctx.globalAlpha = .9 * streamlineAlpha; ctx.strokeStyle = CL.ink; ctx.lineWidth = 2.2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const q of PT) {
        if (q.tr.length < 2 || sc.top(q.x) < 0.08) continue;
        ctx.beginPath();
        q.tr.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
        ctx.stroke();
      }
    }
    ctx.restore();

    // blade (fixed)
    const bp = [];
    for (let x = XMIN - 0.3; x <= 0; x += 0.1) bp.push([x, under(x)]);
    bp.push(E); bp.push(V); bp.push(Dd);
    for (let x = Dd[0]; x <= XMAX; x += 0.1) bp.push([x, under(x)]);
    bp.push([XMAX, YMAX + 3]); bp.push([XMIN - 0.3, YMAX + 3]);
    path(bp); ctx.closePath();
    ctx.fillStyle = CL.blade; ctx.fill(); ctx.strokeStyle = CL.ink; ctx.lineWidth = 2; ctx.stroke();

    // feed nozzle, tip just under the pool surface; slurry enters in pulses
    const px = NX, tip = Math.max(sc.L - 0.3, 0.4), feedOn = SIM.feed;
    ctx.fillStyle = CL.blade; ctx.strokeStyle = CL.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(X(px - 0.35), Y(YMAX), 0.7 * SC(), (YMAX - tip) * SC()); ctx.fill(); ctx.stroke();
    if (feedOn > 0.02) {
      ctx.save(); ctx.globalAlpha = 0.6 * feedOn; ctx.fillStyle = CL.blue;
      ctx.fillRect(X(px - 0.2), Y(YMAX), 0.4 * SC(), (YMAX - tip) * SC()); ctx.restore();
      for (let k = 0; k < 4; k++) {
        const yy = tip + (YMAX - tip) * (1 - ((t * 0.8 + k / 4) % 1));
        if (yy > tip + 0.4 && yy < YMAX - 0.4) arrow(px, yy + 0.4, px, yy - 0.3, CL.ink, 2, feedOn, 7);
      }
    }
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.9 + k / 3) % 1;
      ctx.save(); ctx.globalAlpha = (1 - ph) * 0.8 * feedOn;
      ctx.strokeStyle = CL.blue; ctx.lineWidth = 1.5 + 2 * feedOn;
      ctx.beginPath();
      ctx.ellipse(X(px), Y(sc.L), (0.3 + ph * 1.1) * SC(), (0.06 + ph * 0.12) * SC(), 0, 0, 7);
      ctx.stroke(); ctx.restore();
    }
    label('slurry feed nozzle' + (AN.fa > 0 ? ' (pulses, T = ' + AN.fp.toFixed(1) + ' s)' : ''),
      X(px) + 0.55 * SC(), Y(Math.min(YMAX - 0.8, 7.5)), CL.ink, fs * 1.05, 1, 'left', true);

    // outline of slurry on top of blade contact (drawn last so the attachment is visible)
    path(pts); ctx.strokeStyle = CL.blue; ctx.lineWidth = 2.4; ctx.stroke();
    dot(Dd[0], Dd[1], 5, CL.ink, 1); dot(E[0], E[1], 6, CL.ink, 1);
    label('upstream bead', X(-10.8), Y(sc.L - 0.6), CL.blue, fs * 1.05, fadeWindow(t, 3, 60, 2), 'left', true);

    // ---- sequenced explanatory overlays -----------------------------
    const pa = fadeWindow(t, 9, 17, 1.5); // P_up (bead pressure)
    if (pa > 0) {
      for (const [x, y] of [[-9.6, GAP * 0.25], [-9.6, GAP * 0.5], [-9.6, GAP * 0.75]]) arrow(x, y, x + 1.8, y, CL.blue, 3.2, pa, 11);
      label('P_up', X(-8.7), Y(GAP * 1.25), CL.blue, fs * 1.25, pa, 'center', true);
    }

    const ca = fadeWindow(t, 15, 27, 2); // velocity profile combs
    if (ca > 0) {
      for (const x of [-10, -4.5, -1.2]) {
        const h = sc.top(x);
        ctx.save(); ctx.globalAlpha = ca * .5; ctx.strokeStyle = CL.ink; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(h)); ctx.stroke(); ctx.restore();
        for (let k = 1; k <= 7; k++) { const y = h * k / 8, u = velocityAt(sc, x, y); arrow(x, y, x + u * 0.22, y, CL.ink, 2.2, ca, 8); }
      }
      label('wide bead: slow', X(-10), Y(sc.top(-10)) - 14, CL.ink, fs, ca, 'center');
      label('gap narrows: faster', X(-5.2), Y(GAP * 1.3), CL.ink, fs * 1.05, ca, 'center', true);
      const gx = -1.4;
      arrow(gx, 0.02, gx, GAP - 0.02, CL.ink, 1.6, ca, 7); arrow(gx, GAP - 0.02, gx, 0.02, CL.ink, 1.6, ca, 7);
      label('gap H = ' + GAP.toFixed(2) + ' mm', X(gx) - 8, Y(GAP * 0.5) + 5, CL.ink, fs, ca, 'right', true);
    }

    const ta = fadeWindow(t, 17, 27, 1.5); // web drag shear
    if (ta > 0) {
      for (let x = -7; x <= -0.6; x += 0.9) arrow(x, 0.09, x + 0.7, 0.09, CL.red, 3.4, ta, 10);
      label('τ_web  (drag from moving fibre)', X(-7), Y(-0.45), CL.red, fs * 1.1, ta, 'left', true);
    }

    const ea = fadeWindow(t, 27, 36, 1.5); // active metering edge
    if (ea > 0) {
      const ph = (t * 1.2) % 1;
      for (let k = 0; k < 2; k++) {
        const p = (ph + k * 0.5) % 1;
        ctx.save(); ctx.globalAlpha = ea * (1 - p); ctx.strokeStyle = CL.red; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(X(E[0]), Y(E[1]), (9 + p * 26), 0, 7); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.globalAlpha = ea; ctx.strokeStyle = CL.red; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = sc.xb; x <= 0; x += 0.05) { const px2 = X(x), py = Y(under(x)); x === sc.xb ? ctx.moveTo(px2, py) : ctx.lineTo(px2, py); }
      ctx.stroke(); ctx.restore();
      label('active metering edge', X(E[0]) - 14, Y(E[1]) - 34, CL.red, fs * 1.2, ea, 'right', true);
      label('last blade contact', X(E[0]) - 14, Y(E[1]) - 16, CL.red, fs, ea, 'right');
      ctx.save(); ctx.globalAlpha = ea; ctx.strokeStyle = CL.green; ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(X(Dd[0]), Y(Dd[1]), 14, 0, 7); ctx.stroke(); ctx.restore();
      if (WET) {
        label('slurry reached the notch corner', X(V[0]) + 16, Y(V[1]) + 4, CL.red, fs * 1.15, ea, 'left', true);
      } else {
        label('second edge: dry', X(Dd[0]) + 20, Y(Dd[1]) + 4, CL.green, fs * 1.15, ea, 'left', true);
        label('never touched by slurry', X(Dd[0]) + 20, Y(Dd[1]) + 4 + fs * 1.3, CL.green, fs, ea, 'left');
      }
      if (sc.xq > 0.02) {
        const xcl = sc.xq;
        dot(xcl, GAP + xcl, 6, CL.red, ea);
        label('contact line lifted up the face', X(xcl) + 12, Y(GAP + xcl) - 8, CL.red, fs, ea, 'left', true);
      }
    } else {
      label('active edge', X(E[0]) + 10, Y(E[1]) + 22, CL.ink, fs, fadeWindow(t, 20, 60, 3) * (1 - ea), 'left');
    }

    const wa = fadeWindow(t, 43, 58, 2); // wet film dimension
    if (wa > 0) {
      const fx = 7.4;
      arrow(fx, 0.02, fx, HF - 0.02, CL.ink, 1.8, wa, 7); arrow(fx, HF - 0.02, fx, 0.02, CL.ink, 1.8, wa, 7);
      label('wet film ' + HF.toFixed(2) + ' mm', X(fx) - 10, Y(0.75) + 5, CL.ink, fs * 1.1, wa, 'right', true);
      ctx.save(); ctx.globalAlpha = wa * .8; ctx.strokeStyle = CL.ink; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(X(0), Y(GAP)); ctx.lineTo(X(8.4), Y(GAP)); ctx.stroke(); ctx.restore();
      label('gap ' + GAP.toFixed(2) + ' mm is not the film thickness', X(3.2), Y(GAP) - 10, CL.ink, fs, wa, 'left');
    }

    const na = fadeWindow(t, 40, 60, 3) * 0.75; // porous fibre penetration
    if (na > 0) {
      for (const q of PP) dot(q.x, q.y - 0.01, 2.3, CL.blue, q.a * na);
      for (const x of [1.2, 2.7, 4.2, 5.7, 7.2]) arrow(x, -0.02, x, -0.17, CL.blue, 1.6, na * (0.55 + 0.4 * Math.sin(t * 2 + x)), 6);
    }

    MAG = { pts, bp, fs }; // feeds drawMag()'s field-of-view sizing
  }

  /** Render the magnified downstream-meniscus inset, sharing the same simulation state and clock as draw(). */
  function drawMag(t, sc) {
    if (!cv2 || !MAG) return;
    const w = Math.min(cv2.parentElement.clientWidth || 900, (+cv2.dataset.maxh || Infinity) / 0.46), h = Math.round(w * 0.46);
    if (cv2.__w !== w || cv2.__d !== DPR) {
      cv2.__w = w; cv2.__d = DPR; cv2.style.height = h + 'px'; cv2.style.width = w + 'px';
      cv2.width = Math.round(w * DPR); cv2.height = Math.round(h * DPR);
    }
    const c = cv2.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const c0 = ctx; ctx = c;

    const fs = Math.max(11, w / 62), Qx = sc.xq, Qy = GAP + sc.xq;
    const wy0 = -0.35, wy1 = Math.max(Qy + 0.9, GAP + 1.1, HF + 0.9), wh = wy1 - wy0, ww = wh * w / h;
    const wx0 = Math.min(0, Qx) - 0.25 * ww, wx1 = wx0 + ww;
    const mx = x => (x - wx0) / ww * w, my = y => h - (y - wy0) / wh * h;
    const K = w / ww;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CL.surface; ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = CL.backing; ctx.fillRect(0, my(-FT), w, h - my(-FT));
    ctx.fillStyle = CL.fibre; ctx.fillRect(0, my(0), w, my(-FT) - my(0));
    ctx.save(); ctx.beginPath(); ctx.rect(0, my(0), w, my(-FT) - my(0)); ctx.clip();
    ctx.strokeStyle = CL.muted; ctx.globalAlpha = .6; ctx.lineWidth = 1;
    const weaveOff = SIM.s % 0.4;
    for (let x = wx0 - 1 + weaveOff; x < wx1 + 1; x += 0.4) {
      ctx.beginPath(); ctx.moveTo(mx(x), my(0)); ctx.lineTo(mx(x + 0.18), my(-FT)); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = CL.ink; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, my(0)); ctx.lineTo(w, my(0)); ctx.stroke();

    const xs = [];
    const n = Math.ceil(ww / 0.02);
    for (let i = 0; i <= n; i++) { const x = wx0 + i * ww / n; xs.push([x, sc.top(x)]); }
    ctx.save();
    ctx.beginPath(); ctx.moveTo(mx(xs[0][0]), my(0));
    xs.forEach(p => ctx.lineTo(mx(p[0]), my(Math.max(p[1], 0))));
    ctx.lineTo(mx(xs[n][0]), my(0)); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = CL.blue; ctx.fill(); ctx.globalAlpha = 1; ctx.clip();
    ctx.strokeStyle = CL.ink; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
    for (const l of getStreamlines(sc)) {
      ctx.beginPath();
      l.forEach((p, i) => i ? ctx.lineTo(mx(p[0]), my(p[1])) : ctx.moveTo(mx(p[0]), my(p[1])));
      ctx.stroke();
    }
    ctx.globalAlpha = .9; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const q of PT) {
      if (q.tr.length < 2 || q.x < wx0 || q.x > wx1 || sc.top(q.x) < 0.08) continue;
      ctx.beginPath();
      q.tr.forEach((p, i) => i ? ctx.lineTo(mx(p[0]), my(p[1])) : ctx.moveTo(mx(p[0]), my(p[1])));
      ctx.stroke();
    }
    ctx.restore();

    const bpm = [];
    for (let x = wx0; x <= 0; x += 0.02) bpm.push([x, under(x)]);
    bpm.push(E); bpm.push(V); bpm.push(Dd);
    ctx.beginPath(); ctx.moveTo(mx(wx0), 0);
    bpm.forEach(p => ctx.lineTo(mx(p[0]), my(p[1])));
    ctx.lineTo(mx(Dd[0]), 0); ctx.closePath();
    ctx.fillStyle = CL.blade; ctx.fill(); ctx.strokeStyle = CL.ink; ctx.lineWidth = 2.4; ctx.stroke();

    ctx.beginPath();
    let on = false;
    for (let i = 0; i <= n; i++) {
      const p = xs[i];
      if (p[1] < 0.05) { on = false; continue; }
      on ? ctx.lineTo(mx(p[0]), my(p[1])) : ctx.moveTo(mx(p[0]), my(p[1]));
      on = true;
    }
    ctx.strokeStyle = CL.blue; ctx.lineWidth = 3.4; ctx.lineJoin = 'round'; ctx.stroke();

    ctx.fillStyle = CL.ink; ctx.beginPath(); ctx.arc(mx(0), my(GAP), 6, 0, 7); ctx.fill();
    label('active metering edge', mx(0) - 12, my(GAP) + 22, CL.ink, fs, 1, 'right', true);
    const xcl = sc.xq;
    if (xcl > 0.02) {
      ctx.fillStyle = CL.red; ctx.beginPath(); ctx.arc(mx(xcl), my(GAP + xcl), 6, 0, 7); ctx.fill();
      label('contact line', mx(xcl) + 12, my(GAP + xcl) - 6, CL.red, fs, 1, 'left', true);
    }

    const fx = wx1 - 0.07 * ww, fh = sc.top(fx);
    if (fh > 0.1) {
      arrow2(mx(fx), my(0.02), mx(fx), my(fh - 0.02), CL.ink, 1.8, 1, 7);
      arrow2(mx(fx), my(fh - 0.02), mx(fx), my(0.02), CL.ink, 1.8, 1, 7);
      label('film ' + fh.toFixed(2) + ' mm', mx(fx) - 10, my(fh / 2) + 5, CL.ink, fs, 1, 'right', true);
    }

    const ga = fadeWindow(t, 12, 60, 1.5), pa2 = fadeWindow(t, 16, 60, 1.5);
    const xa = f => sc.xq + (sc.xm - sc.xq) * f;
    const tangentAt = x => {
      const e = (sc.xm - sc.xq) * 0.03 + 1e-3;
      const x1 = Math.max(x - e, sc.xq), x2 = x + e;
      const sl = (sc.menY(x2) - sc.menY(x1)) / (x2 - x1);
      const l = Math.hypot(1, sl);
      return [1 / l, sl / l];
    };
    if (ga > 0 && sc.xm - sc.xq > 0.1) {
      const x = xa(0.45), y = sc.menY(x), tg = tangentAt(x), px = mx(x), py = my(y);
      arrow2(px, py, px + tg[0] * 70, py - tg[1] * 70, CL.green, 4, ga, 12);
      arrow2(px, py, px - tg[0] * 70, py + tg[1] * 70, CL.green, 4, ga, 12);
      label('γ  surface tension along the interface', 12, h - 38, CL.green, fs, ga, 'left', true);
    }
    if (pa2 > 0 && sc.xm - sc.xq > 0.1) {
      for (const f of [0.15, 0.45, 0.75]) {
        const x = xa(f), y = sc.menY(x), tg = tangentAt(x), px = mx(x), py = my(y);
        arrow2(px + tg[1] * 58, py + tg[0] * 58, px, py, CL.blue, 3.6, pa2, 12);
      }
      label('capillary pressure ⟂ interface', 12, h - 16, CL.blue, fs, pa2, 'left', true);
    }
    label('Downstream meniscus, magnified ×' + (K / SC()).toFixed(1) + ' (same simulation)', 12, fs * 1.6, CL.ink, fs * 1.05, 1, 'left', true);

    ctx = c0;
  }

  // ------------------------------------------------------------------
  // Public API — this is the only surface ui.js should touch.
  // ------------------------------------------------------------------
  const AN = {
    z: 0, tt: 0, fa: 1.0, fp: 6, fd: 0.3, L0: 4, Lp: 100, rate: 1,
    playing: true, raf: 0, last: 0, info: null,

    /** True when the pool can't currently supply the requested outlet flow (see the "Conservation" note in the UI). */
    get limited() { return SIM.limited; },
    /** False once the film solver has hit a non-physical result and frozen the surface rather than show it. */
    get safe() { return SIM.safe; },

    start(canvas, canvas2) {
      cv = canvas; cv2 = canvas2 || null;
      updateThemeColors(); resizeCanvas(); setModel();
      if (!PP.length) initPenetrationDots();
      AN.stop(); AN.last = 0;
      AN.raf = requestAnimationFrame(AN.frame);
    },
    // Console debugging helpers (not used by ui.js) — inspect the live film field,
    // a sampled top() profile, the sim clock/speed, or particle velocities.
    dbg() { return Array.from(SIM.h); },
    dbgT() { const sc = scene(AN.tt); const r = []; for (let x = -1; x <= 9.5; x += 0.5) r.push([x, +sc.top(x).toFixed(3)]); return r; },
    dbgS() { return [SIM.t, SIM.s, SIM.Uf, UN]; },
    dbgP() { const sc = scene(AN.tt); return PT.filter(q => sc.top(q.x) > 0.08).map(q => { const v = vel(sc, q.x, q.y); return [q.x, q.y, v[0], sc.top(q.x), v[1]]; }); },
    stop() { cancelAnimationFrame(AN.raf); AN.raf = 0; },
    refresh() { setModel(); updateThemeColors(); if (cv && !AN.raf) AN.paint(); },
    seek(t) { AN.tt = t; simSync(t); },
    reinit() { setModel(); SIM.init = 0; simSync(AN.tt); },
    paint() { const sc = scene(AN.tt); draw(AN.tt, sc); drawMag(AN.tt, sc); },
    frame(ts) {
      AN.raf = requestAnimationFrame(AN.frame);
      if (!AN.last) AN.last = ts;
      const dt = Math.min((ts - AN.last) / 1000, 0.08) * AN.rate;
      AN.last = ts;
      if (AN.playing && document.visibilityState === 'visible') {
        AN.tt = (AN.tt + dt) % CYCLE_T;
        simSync(AN.tt);
        const sc = scene(AN.tt);
        stepParticles(sc, dt);
      }
      const sc = scene(AN.tt);
      draw(AN.tt, sc);
      drawMag(AN.tt, sc);
      if (AN.onTime) AN.onTime(AN.tt);
    },
    onResize() { if (cv) { resizeCanvas(); updateThemeColors(); } },
  };

  return AN;
})();
