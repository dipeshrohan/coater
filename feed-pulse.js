/*
 * feed-pulse.js — the pool fed in pulses (Coating › 1D › Pool and feed): the paste falls from the outlets onto the pool's
 * top, all outlets together, when the level has dropped (a camera fires the pulse); between pulses the web carries the
 * paste away under the blade. Over a cycle the pool's level, the bead pressure it gives (ρ g h at the web), and the wet
 * film the blade leaves follow from the volume balance of the pool:
 *   A(h) dh/dt = Qin(t) − Qout(h),   Qin = V / τ during a pulse (else 0),   Qout(h) = U W film(h)
 *   film(h) = film0 + (dfilm/dP) ρ g (h − h̄)   (the film's sensitivity to the bead pressure, from the 1D at each location)
 * A(h): the pool's top, between its back edge and where it meets the blade (W wide, side plates at the web's edges).
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
 *   tau (s, a pulse's length), n (steps per cycle, default 4000) }
 * Returns { T (s, between pulses), hLow, hHigh, hMean (m), swing (m), filmMin, filmMax (m), band (m: the film's repeat along
 *   the web, U T), Qmean (m³/s), t, h, film, Qin, Qout (arrays over a cycle, t from a pulse's start), filmAlong (s from the
 *   edge, m -> the film there, m, at the moment a pulse starts), volIn, volOut (m³ over a cycle), area (h -> A, m²) } or
 *   { error }.
 */
function feedCycle(o) {
  const { W, U, film0, dfdP, rho, g, Pup, R, H, xBack, V, tau } = o, n = o.n || 4000;
  const hBar = Pup / (rho * g), meets = o.meets || (h => feedMeetsBlade(h, R, H));
  const area = h => W * (xBack - meets(h));
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
 * The outlets: their stream and where it falls. o: { V (m³ per pulse, all), tau (s), n (outlets), d (m, bore), tip (m, above
 *   the web), x (m, upstream of the metering edge), zs (m, across the web), W (m), g, rho }, cycle: feedCycle's.
 * Returns { q (m³/s per outlet), v0 (m/s, out of the outlet), fall (m, tip above the highest level), vLand (m/s, free fall,
 *   no drag: at most this), dLand (m, the stream's diameter there by continuity), pLand (Pa, ρ v² / 2 at landing), checks: [{ ok,
 *   text }] }.
 */
function feedOutlets(o, cycle) {
  const q = o.V / o.tau / o.n, v0 = q / (Math.PI * o.d * o.d / 4), fall = o.tip - cycle.hHigh;
  const vLand = Math.sqrt(v0 * v0 + 2 * o.g * Math.max(0, fall)), dLand = o.d * Math.sqrt(v0 / vLand);
  const checks = [
    fall > 0 ? { ok: true, text: `The outlets' tips are ${(fall * 1e3).toFixed(1)} mm above the highest level: the paste falls onto the pool.` }
      : { ok: false, text: `The outlets' tips are ${(-fall * 1e3).toFixed(1)} mm below the highest level: they dip into the paste.` },
    o.x > cycle.meetsHigh ? { ok: true, text: `The streams land ${((o.x - cycle.meetsHigh) * 1e3).toFixed(1)} mm upstream of where the pool meets the blade (at the highest level).` }
      : { ok: false, text: `The streams fall on the blade's face: the outlets are ${((cycle.meetsHigh - o.x) * 1e3).toFixed(1)} mm downstream of where the pool meets the blade.` },
    o.x + o.d / 2 < o.xBack ? { ok: true, text: `The outlets are ${((o.xBack - o.x) * 1e3).toFixed(1)} mm in front of the pool's back edge.` }
      : { ok: false, text: 'The outlets are behind the pool\'s back edge.' },
  ];
  const zs = [...o.zs].sort((p, s) => p - s);
  const inside = zs.every(z => z - o.d / 2 >= 0 && z + o.d / 2 <= o.W), apart = zs.every((z, i) => i === 0 || z - zs[i - 1] >= o.d);
  checks.push(inside && apart ? { ok: true, text: 'Every outlet is between the side plates, and none overlaps another.' }
    : { ok: false, text: !inside ? 'An outlet is outside the side plates.' : 'Two outlets overlap.' });
  return { q, v0, fall, vLand, dLand, pLand: o.rho * vLand * vLand / 2, checks };
}

/** n outlets equidistant across the width W: each in the middle of its share (m). */
const feedEquidistant = (n, W) => Array.from({ length: n }, (_, i) => W * (i + 0.5) / n);

if (typeof module !== 'undefined' && module.exports) module.exports = { feedMeetsBlade, feedCycle, feedOutlets, feedEquidistant };
