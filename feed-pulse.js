/*
 * feed-pulse.js — the pool fed in pulses (Coating › 1D › Pool and feed): the paste falls from the outlets onto the pool's
 * top, all outlets together, when the level has dropped (a camera fires the pulse); between pulses the web carries the
 * paste away under the blade. Over a cycle the pool's level, the bead pressure it gives (ρ g h at the web), and the wet
 * film the blade leaves follow from the volume balance of the pool:
 *   A(h) dh/dt = Qin(t) − Qout(h),   Qin = V / τ during a pulse (else 0),   Qout(h) = U W film(h)
 *   film(h) = film0 + (dfilm/dP) ρ g (h − h̄)   (the film's sensitivity to the bead pressure, from the 1D at each location)
 * A(h): the pool's top, between its back edge and where it meets the blade (W wide, side plates at the web's edges), less
 * what the outlets take of it: their pipes where they stand in the paste (the level above their tips), and the heaps that
 * stand from the top up to the tips when the paste enters by a heap (as wide as the pipes: the paste hangs from their rim)
 * -- the paste in a heap shortens as the level rises, so the level rises as if the top were smaller by the heaps.
 * h̄, the level over a cycle on average, is the one the bead pressure input gives (Pup = ρ g h̄); the level where the camera
 * fires is found so the cycle's mean is h̄. The outlets: the stream each gives, its speed out of the outlet and where it
 * lands (a falling stream, free fall without drag: an upper bound on its speed), and checks of where it is. Pure
 * computation, SI units, no DOM.
 */

/** Where the pool's top meets a round-entry blade (radius R, gap H at the metering edge) at level h: its distance upstream of
 *  the edge (m), the blade's face being at height H + R − √(R² − x²) there; above the blade's top (h ≥ R + H): R. */
function feedMeetsBlade(h, R, H) {
  const c = R + H - h;
  return c <= 0 ? R : c >= R ? 0 : Math.sqrt(R * R - c * c);
}

/**
 * One pulse cycle in its steady repeat.
 * o: { W (m, between the side plates), U (m/s), film0 (m, at the mean level), dfdP (m/Pa), rho, g, Pup (Pa: the mean level
 *   Pup / (ρ g)), R, H (m, the blade), meets (optional: h -> distance upstream where the pool meets the blade, m; default
 *   the round entry's), xBack (m, the pool's back edge upstream of the metering edge), V (m³ per pulse, all outlets),
 *   tau (s, a pulse's length), n (steps per cycle, default 4000), pipes (optional: { n (outlets), Do (m, the pipes' outer
 *   diameter), tip (m, above the web), entry: 'fall' | 'heap' | 'dip' }: what they take of the top, above) }
 * Returns { T (s, between pulses), hLow, hHigh, hMean (m), swing (m), filmMin, filmMax (m), band (m: the film's repeat along
 *   the web, U T), Qmean (m³/s), t, h, film, Qin, Qout (arrays over a cycle, t from a pulse's start), filmAlong (s from the
 *   edge, m -> the film there, m, at the moment a pulse starts), volIn, volOut (m³ over a cycle), area (h -> A, m²) } or
 *   { error }.
 */
function feedCycle(o) {
  const { W, U, film0, dfdP, rho, g, Pup, R, H, xBack, V, tau } = o, n = o.n || 4000;
  const hBar = Pup / (rho * g), meets = o.meets || (h => feedMeetsBlade(h, R, H));
  // (the outlets' share of the top: each pipe's footprint where the level is above its tip; with heaps, at every level)
  const pp = o.pipes, foot = pp ? pp.n * Math.PI * pp.Do * pp.Do / 4 : 0;
  const area = h => W * (xBack - meets(h)) - (pp && (pp.entry === 'heap' || h > pp.tip) ? foot : 0);
  const film = h => film0 + dfdP * rho * g * (h - hBar), Qout = h => U * W * film(h), Qin = V / tau;
  if (!(V > 0 && tau > 0 && U > 0 && W > 0)) return { error: 'the pulse, the web\'s speed and the width must be above zero' };
  if (!(area(hBar) > 0)) return { error: 'the pool\'s back edge must be upstream of where the pool meets the blade' };
  if (Qin <= Qout(hBar)) return { error: 'a pulse feeds slower than the web carries the paste away: lengthen the pulse\'s paste or shorten it' };
  // (the pulse on or off for a whole step: the inflow jumps at its end, so a step never straddles it)
  const rhs = (on, h) => ((on ? Qin : 0) - Qout(h)) / area(h);
  // one cycle from the level the camera fires at: the pulse, then the drain until the level is back (RK4, the end found on
  // the last step by its cubic Hermite interpolant); the step a fraction of the cycle's estimate V / Q
  const run = hLow => {
    const T0 = V / Qout(hBar), dt = Math.min(tau, T0) / Math.max(200, Math.round(n * Math.min(tau, T0) / T0));
    const ts = [0], hs = [hLow]; let t = 0, h = hLow;
    const step = (on, h, d) => { const k1 = rhs(on, h), k2 = rhs(on, h + d / 2 * k1), k3 = rhs(on, h + d / 2 * k2), k4 = rhs(on, h + d * k3); return h + d / 6 * (k1 + 2 * k2 + 2 * k3 + k4); };
    // the pulse: exactly τ long (its last step trimmed)
    const nP = Math.ceil(tau / dt - 1e-9);
    for (let k = 1; k <= nP; k++) { h = step(true, h, tau / nP); t = tau * k / nP; ts.push(t); hs.push(h); }
    if (h <= hLow) return null;
    // the drain: the steps cover the rest at the pulse's own step, until the level falls back to hLow
    for (let k = 0; k < 50 * n; k++) {
      const h1 = step(false, h, dt);
      if (h1 <= hLow) {
        // the crossing, on the step's Hermite cubic (h, h1 and their slopes)
        const f0 = rhs(false, h), f1 = rhs(false, h1), H01 = s => { const a = 2 * s ** 3 - 3 * s * s + 1, b = s ** 3 - 2 * s * s + s, c = -2 * s ** 3 + 3 * s * s, e = s ** 3 - s * s; return a * h + b * dt * f0 + c * h1 + e * dt * f1; };
        let lo = 0, hi = 1; for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2; if (H01(m) > hLow) lo = m; else hi = m; }
        const s = (lo + hi) / 2; ts.push(t + s * dt); hs.push(hLow); break;
      }
      h = h1; t += dt; ts.push(t); hs.push(h);
    }
    const T = ts[ts.length - 1];
    // the cycle's mean level (trapezoids; the steps are small)
    let m = 0; for (let i = 1; i < ts.length; i++) m += (ts[i] - ts[i - 1]) * (hs[i] + hs[i - 1]) / 2;
    return { ts, hs, T, mean: m / T };
  };
  // the level the camera fires at: so the cycle's mean is h̄ (secant; the mean moves almost one for one with it)
  const swing0 = (Qin - Qout(hBar)) * tau / area(hBar);
  let a = hBar - swing0 / 2, ra = run(a), b = a - 1e-3 * swing0, rb = run(b);
  if (!ra || !rb) return { error: 'the cycle could not be found' };
  for (let it = 0; it < 40 && Math.abs(ra.mean - hBar) > 1e-12 * hBar; it++) {
    const c = a - (ra.mean - hBar) * (a - b) / (ra.mean - rb.mean); b = a; rb = ra; a = c; ra = run(a);
    if (!ra) return { error: 'the cycle could not be found' };
  }
  const { ts, hs, T } = ra, fs = hs.map(film);
  let volIn = 0, volOut = 0;
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    volIn += ts[i] <= tau + 1e-12 * tau ? Qin * d : 0;
    volOut += d * (Qout(hs[i]) + Qout(hs[i - 1])) / 2;
  }
  const hHigh = Math.max(...hs), hLow = hs[0];
  // the film along the web at the moment a pulse starts: s from the metering edge left the blade s / U ago
  const filmAlong = s => { let tb = ((-s / U) % T + T) % T; let i = 1; while (i < ts.length - 1 && ts[i] < tb) i++; const w = (tb - ts[i - 1]) / ((ts[i] - ts[i - 1]) || 1); return fs[i - 1] + w * (fs[i] - fs[i - 1]); };
  return { T, hLow, hHigh, hMean: ra.mean, hBar, swing: hHigh - hLow, filmMin: Math.min(...fs), filmMax: Math.max(...fs), band: U * T, Qmean: volOut / T,
    t: ts, h: hs, film: fs, Qin: ts.map(t => (t < tau ? Qin : 0)), Qout: hs.map(Qout), filmAlong, volIn, volOut, area, meetsHigh: meets(hHigh), meetsLow: meets(hLow) };
}

/**
 * The outlets: their stream and where it enters the pool. o: { V (m³ per pulse, all), tau (s), n (outlets), d (m, bore), Do
 *   (m, the pipe's outer diameter; default d), tip (m, above the web), x (m, upstream of the metering edge), zs (m, across the
 *   web), W (m), g, rho, entry ('fall', default: the paste falls from the tips onto the top; 'heap': a heap stands from the top
 *   up to each tip, the paste running down it; 'dip': the tips in the paste, the paste leaving the bore inside the pool) },
 *   cycle: feedCycle's.
 * Returns { entry, q (m³/s per outlet), v0 (m/s, out of the outlet), fall (m, tip above the highest level; below it, negative),
 *   depth (m, the tip below the lowest level), vLand (m/s: where the paste meets the pool -- falling, free fall without drag:
 *   at most this; down a heap, its mean speed across the heap; out of a tip in the paste, the bore's), dLand (m, the stream's
 *   diameter there: by continuity; the heap's; the bore's), pLand (Pa, ρ v² / 2 there), checks: [{ ok, text }] }.
 */
function feedOutlets(o, cycle) {
  const entry = o.entry || 'fall', Do = o.Do || o.d, q = o.V / o.tau / o.n, v0 = q / (Math.PI * o.d * o.d / 4);
  const fall = o.tip - cycle.hHigh, depth = cycle.hLow - o.tip;
  const vLand = entry === 'heap' ? q / (Math.PI * Do * Do / 4) : entry === 'dip' ? v0 : Math.sqrt(v0 * v0 + 2 * o.g * Math.max(0, fall));
  const dLand = entry === 'heap' ? Do : entry === 'dip' ? o.d : o.d * Math.sqrt(v0 / vLand);
  const mm = v => (v * 1e3).toFixed(1);
  const first = entry === 'heap'
    ? (fall > 0 ? { ok: true, text: `A heap stands from the top up to each tip: ${mm(fall)} mm at the highest level, ${mm(o.tip - cycle.hLow)} mm at the lowest.` }
      : { ok: false, text: `The tips are ${mm(-fall)} mm below the highest level: they are in the paste then, with no heap under them.` })
    : entry === 'dip'
      ? (depth > 0 ? { ok: true, text: `The tips stay in the paste through the cycle: ${mm(depth)} mm below the lowest level.` }
        : { ok: false, text: `The tips come out of the paste when the level is low: ${mm(-depth)} mm above the lowest level.` })
      : (fall > 0 ? { ok: true, text: `The outlets' tips are ${mm(fall)} mm above the highest level: the paste falls onto the pool.` }
        : { ok: false, text: `The outlets' tips are ${mm(-fall)} mm below the highest level: they dip into the paste.` });
  const checks = [
    first,
    o.x > cycle.meetsHigh ? { ok: true, text: `The streams land ${((o.x - cycle.meetsHigh) * 1e3).toFixed(1)} mm upstream of where the pool meets the blade (at the highest level).` }
      : { ok: false, text: `The streams fall on the blade's face: the outlets are ${((cycle.meetsHigh - o.x) * 1e3).toFixed(1)} mm downstream of where the pool meets the blade.` },
    o.x + Do / 2 < o.xBack ? { ok: true, text: `The outlets are ${((o.xBack - o.x) * 1e3).toFixed(1)} mm in front of the pool's back edge.` }
      : { ok: false, text: 'The outlets are behind the pool\'s back edge.' },
  ];
  const zs = [...o.zs].sort((p, s) => p - s);
  const inside = zs.every(z => z - Do / 2 >= 0 && z + Do / 2 <= o.W), apart = zs.every((z, i) => i === 0 || z - zs[i - 1] >= Do);
  checks.push(inside && apart ? { ok: true, text: 'Every outlet is between the side plates, and none overlaps another.' }
    : { ok: false, text: !inside ? 'An outlet is outside the side plates.' : 'Two outlets overlap.' });
  return { entry, q, v0, fall, depth, vLand, dLand, pLand: o.rho * vLand * vLand / 2, checks };
}

/**
 * The start-up (the owner: time starts when the web is running and the paste is fed in): the web runs, the gap and the
 * pool are empty, the pump's pulses start. The pool fills as in the cycle (feedCycle's volume balance, A(h) dh/dt = in −
 * out); at each location the paste is drawn into the gap from its inlet, its front moving along under the blade at the
 * flow over the gap's height there, the flow the 1D's (the stations' exact profiles, cfd-1d.js's gapTable1D) between the
 * pool's head ρ g h at the inlet (the 1D's bead pressure) and, at the front, its meniscus across the gap (p = −γ (cos θweb +
 * cos θblade) / gap: suction); when the front reaches the edge the film starts on the web, the flow then the 1D's between
 * the pool's head and the edge (p = 0, as the steady 1D). While the pool is empty the gaps take what the pulse brings, no
 * more, shared as they would draw it. The camera fires a pulse when the level is at or below its own, the pump waiting
 * `pause` after a pulse before the next: at start-up, pulse after pulse until the level is up; then the cycle as
 * feedCycle's. RK4, the step at most dt and a tenth of each front's own run so far; a pulse's end, the camera's level and a
 * front reaching the edge landed on (secant).
 * o: { W, U, rho, g, area (h -> m²: the pool's top outside the gaps the fronts fill, upstream of the 1D's inlet), V (m³ a
 *   pulse), tau (s), pause (s, default 0), hCam (m, the camera's level: feedCycle's hLow), locs: [{ T (gapTable1D), gamma,
 *   thWeb, thBlade (deg) }], dt (s; default tau / 100), cyclesAfter (the camera's pulses followed once the level is first
 *   up, default 3), tEnd (s, instead), tMax (s, default 3600), h0, xf0 (m, a start other than empty: the checks) }
 * Returns { t, h, Qin, Qout (arrays), locs: [{ xf, q, film (null until the front is at the edge), tEdge }], pulses (their
 *   start times), tCam (the level first at the camera's), volIn, volOut, volGaps (m³), Lx, completed } or { error }.
 */
function feedStartup(o) {
  const gapTableQ = typeof globalThis.gapTableQ === 'function' ? globalThis.gapTableQ : require('./cfd-1d.js').gapTableQ;
  const { W, U, rho, g, area, V, tau } = o, pause = o.pause || 0, hCam = o.hCam, locs = o.locs, n = locs.length;
  if (!(V > 0 && tau > 0 && U > 0 && W > 0 && n > 0)) return { error: 'the pulse, the web\'s speed, the width and the locations must be given' };
  const Qp = V / tau, dt0 = o.dt || tau / 100, tMax = o.tMax || 3600, cyclesAfter = o.cyclesAfter ?? 3, Lx = locs.map(L => L.T.Lx);
  const suction = locs.map(L => L.gamma * (Math.cos(L.thWeb * Math.PI / 180) + Math.cos(L.thBlade * Math.PI / 180)));
  // the flows and the rates of change at y = [h, xf_1..xf_n] with Qin coming in; front[i]: location i's paste still a front
  // in the gap (fixed over a step, so the step that brings a front to the edge is smooth to it)
  const rates = (y, Qin, front) => {
    const h = Math.max(y[0], 0), qs = new Float64Array(n);
    let demand = 0;
    for (let i = 0; i < n; i++) {
      const T = locs[i].T, xf = front[i] ? y[1 + i] : Lx[i];
      qs[i] = gapTableQ(T, Math.min(xf, Lx[i]), rho * g * h + (front[i] ? suction[i] / T.h0(xf) : 0));
      demand += W * qs[i] / n;
    }
    // (an empty pool: the gaps take what the pulse brings, shared as they would draw it)
    if (y[0] <= 0 && demand > Qin) { const s = Qin / demand; for (let i = 0; i < n; i++) qs[i] *= s; demand = Qin; }
    const d = new Float64Array(n + 1);
    d[0] = y[0] <= 0 && Qin <= demand ? 0 : (Qin - demand) / area(h);
    for (let i = 0; i < n; i++) d[1 + i] = front[i] ? qs[i] / locs[i].T.h0(y[1 + i]) : 0;
    let outflow = 0; for (let i = 0; i < n; i++) if (!front[i]) outflow += W * qs[i] / n;
    return { d, qs, outflow };
  };
  const add = (a, b, s) => { const c = new Float64Array(n + 1); for (let i = 0; i <= n; i++) c[i] = a[i] + s * b[i]; return c; };
  // one RK4 step; its volume out under the blade (Simpson on the stages)
  const frontNow = y => Array.from({ length: n }, (_, i) => y[1 + i] < Lx[i]);
  const step = (y, dt, Qin) => {
    const f = frontNow(y), k1 = rates(y, Qin, f), k2 = rates(add(y, k1.d, dt / 2), Qin, f), k3 = rates(add(y, k2.d, dt / 2), Qin, f), k4 = rates(add(y, k3.d, dt), Qin, f);
    const y1 = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) y1[i] = y[i] + dt / 6 * (k1.d[i] + 2 * k2.d[i] + 2 * k3.d[i] + k4.d[i]);
    y1[0] = Math.max(0, y1[0]);
    return { y1, k1, volOut: dt / 6 * (k1.outflow + 2 * k2.outflow + 2 * k3.outflow + k4.outflow) };
  };
  // the step's length landing on f(y) = 0 (f of the state; secant from the full step's two ends)
  const landOn = (y, dt, Qin, f) => {
    let a = 0, fa = f(y), b = dt, fb = f(step(y, dt, Qin).y1);
    for (let it = 0; it < 30 && Math.abs(b - a) > 1e-13 * dt; it++) {
      const c = b - fb * (b - a) / (fb - fa), fc = f(step(y, c, Qin).y1);
      a = b; fa = fb; b = c; fb = fc;
      if (Math.abs(fc) < 1e-14) break;
    }
    return Math.min(dt, Math.max(1e-12 * dt, b));
  };
  const out = { t: [0], h: [], Qin: [], Qout: [], locs: locs.map(() => ({ xf: [], q: [], film: [], tEdge: null })), pulses: [0], tCam: null, volIn: 0, volOut: 0, Lx };
  // (each front starts a hair inside its gap's inlet unless given: there the gap takes whatever reaches it)
  let y = new Float64Array(n + 1);
  y[0] = o.h0 || 0;
  for (let i = 0; i < n; i++) y[1 + i] = o.xf0 != null ? Math.min(o.xf0, Lx[i]) : 1e-6 * Lx[i];
  for (let i = 0; i < n; i++) if (y[1 + i] >= Lx[i]) out.locs[i].tEdge = 0;
  const record = (yy, on) => {
    const r = rates(yy, on ? Qp : 0, frontNow(yy));
    out.h.push(yy[0]); out.Qin.push(on ? Qp : 0); out.Qout.push(r.outflow);
    for (let i = 0; i < n; i++) { const L = out.locs[i]; L.xf.push(yy[1 + i]); L.q.push(r.qs[i]); L.film.push(yy[1 + i] >= Lx[i] ? r.qs[i] / U : null); }
  };
  let t = 0, on = true, pulseEnd = tau, nextAt = null, fired = 0, done = false;
  if (out.tCam == null && y[0] >= hCam) out.tCam = 0;
  record(y, on);
  for (let k = 0; k < 2e6 && !done && t < tMax; k++) {
    const Qin = on ? Qp : 0;
    // the step: dt, a tenth of each moving front's run so far, never past a pulse's end, the next pulse or the end
    let dt = dt0;
    const r0 = rates(y, Qin, frontNow(y));
    for (let i = 0; i < n; i++) if (y[1 + i] < Lx[i] && r0.d[1 + i] > 0) dt = Math.min(dt, 0.1 * y[1 + i] / r0.d[1 + i]);
    if (on) dt = Math.min(dt, pulseEnd - t); else if (nextAt != null) dt = Math.min(dt, nextAt - t);
    if (o.tEnd) dt = Math.min(dt, o.tEnd - t);
    dt = Math.max(dt, 1e-12);
    let st = step(y, dt, Qin);
    // events inside the step: a front reaching its edge, the level falling to the camera's (the step cut there)
    let ev = null;
    for (let i = 0; i < n; i++) if (y[1 + i] < Lx[i] && st.y1[1 + i] >= Lx[i]) { const d = landOn(y, dt, Qin, yy => yy[1 + i] - Lx[i]); if (!ev || d < ev.dt) ev = { dt: d, front: i }; }
    if (!on && nextAt == null && y[0] > hCam && st.y1[0] <= hCam) { const d = landOn(y, dt, Qin, yy => yy[0] - hCam); if (!ev || d < ev.dt) ev = { dt: d, cam: true }; }
    if (ev) { dt = ev.dt; st = step(y, dt, Qin); }
    out.volIn += Qin * dt; out.volOut += st.volOut;
    y = st.y1; t += dt;
    if (ev && ev.front != null) { y[1 + ev.front] = Lx[ev.front]; out.locs[ev.front].tEdge = t; }
    for (let i = 0; i < n; i++) if (out.locs[i].tEdge == null && y[1 + i] >= Lx[i]) { y[1 + i] = Lx[i]; out.locs[i].tEdge = t; }
    if (out.tCam == null && y[0] >= hCam) out.tCam = t;
    // the pump and the camera
    if (on && t >= pulseEnd - 1e-9 * tau) { on = false; nextAt = y[0] <= hCam ? t + pause : null; }
    else if (!on && nextAt == null && ev && ev.cam) nextAt = t;
    if (!on && nextAt != null && t >= nextAt - 1e-9 * tau) {
      if (out.tCam != null) fired++;
      if (fired > cyclesAfter && !o.tEnd) done = true;
      else { on = true; pulseEnd = t + tau; nextAt = null; out.pulses.push(t); }
    }
    out.t.push(t); record(y, on);
    if (o.tEnd && t >= o.tEnd - 1e-12 * o.tEnd) done = true;
  }
  // (the paste in the gaps: each filled from its inlet to its front, Simpson on the blade's own height)
  let volGaps = 0;
  for (let i = 0; i < n; i++) { const h0 = locs[i].T.h0, xf = y[1 + i], m = 2000; let v = h0(0) + h0(xf); for (let j = 1; j < m; j++) v += (j % 2 ? 4 : 2) * h0(xf * j / m); volGaps += v * xf / (3 * m) * W / n; }
  out.volGaps = volGaps; out.completed = done;
  return out;
}

/** The pool's top area at level h (m²): between its back edge and where it meets the blade, W wide, less the outlets' pipes
 *  where they stand in the paste or heaps stand up to them (feedCycle's; o as feedCycle's). */
function feedArea(o) {
  const { W, R, H, xBack } = o, meets = o.meets || (h => feedMeetsBlade(h, R, H)), pp = o.pipes, foot = pp ? pp.n * Math.PI * pp.Do * pp.Do / 4 : 0;
  return h => W * (xBack - meets(h)) - (pp && (pp.entry === 'heap' || h > pp.tip) ? foot : 0);
}

/** n outlets equidistant across the width W: each in the middle of its share (m). */
const feedEquidistant = (n, W) => Array.from({ length: n }, (_, i) => W * (i + 0.5) / n);

if (typeof module !== 'undefined' && module.exports) module.exports = { feedMeetsBlade, feedCycle, feedOutlets, feedEquidistant, feedStartup, feedArea };
