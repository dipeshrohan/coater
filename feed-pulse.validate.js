/*
 * feed-pulse.validate.js — checks of feed-pulse.js (the pool fed in pulses) against exact solutions. Run: node feed-pulse.validate.js
 *  1. Where the pool meets a round-entry blade: the blade's face is at the pool's level there; at the gap, at the edge.
 *  2. The film not depending on the level, the pool's top not depending on it: the exact saw-tooth (the cycle V / Q, the
 *     swing (V − Q τ) / A, the camera's level h̄ − swing / 2).
 *  3. The film depending on the level, linearly (the 1D's sensitivity), the pool's top fixed: the exact exponential
 *     cycle (the linear equation solved by hand on each part of the cycle), its period V / Q at the mean level.
 *  4. The pool's top growing with the level on the round blade: the cycle conserves the paste (in = out over a cycle =
 *     the pulse's volume), and twice the steps change the period and the swing by less than 1e-9 (RK4).
 *  5. The outlets: the stream's flow and speed, free fall, its diameter by continuity, and each check failing when it should.
 *  6. How the paste enters: the pipes standing in the paste, or the heaps up to the tips, take their footprints off the top
 *     (the exact saw-tooth on the smaller top); tips above the paste with the paste falling: the cycle unchanged.
 *  7. The outlets for each entry: where the paste meets the pool (down a heap, out of a tip in the paste) and the checks.
 */
const F = require('./feed-pulse.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rho = 1360, g = 9.81, R = 0.1, H = 1.725e-3, W = 0.3, U = 0.28 / 60, film0 = 1.448e-3, Pup = 490;

// 1. where the pool meets the blade
{
  let e = 0; for (const h of [0.005, 0.02, 0.0367, 0.08]) { const x = F.feedMeetsBlade(h, R, H); e = Math.max(e, Math.abs(H + R - Math.sqrt(R * R - x * x) - h)); }
  check('where the pool meets the round blade: the blade\'s face is at the pool\'s level there; at the gap: the edge; above the blade: R', e < 1e-15 && F.feedMeetsBlade(H, R, H) === 0 && F.feedMeetsBlade(R + H + 1e-3, R, H) === R,
    `largest height error ${e.toExponential(1)} m; at 36.7 mm: ${(F.feedMeetsBlade(0.0367, R, H) * 1e3).toFixed(2)} mm upstream`);
}

// 2. the exact saw-tooth: film independent of the level, the pool's top fixed
{
  const V = 60e-6, tau = 3, xBack = 0.13, A = W * xBack, c = F.feedCycle({ W, U, film0, dfdP: 0, rho, g, Pup, R, H, xBack, V, tau, meets: () => 0 });
  const Q = U * W * film0, T = V / Q, sw = (V - Q * tau) / A, hBar = Pup / (rho * g);
  const eT = Math.abs(c.T / T - 1), eS = Math.abs(c.swing / sw - 1), eL = Math.abs(c.hLow - (hBar - sw / 2));
  check('film independent of the level, the pool\'s top fixed: the exact saw-tooth (cycle V/Q, swing (V − Qτ)/A, camera level h̄ − swing/2)', eT < 1e-10 && eS < 1e-9 && eL < 1e-12,
    `cycle ${c.T.toFixed(4)} s (exact ${T.toFixed(4)}), swing ${(c.swing * 1e3).toFixed(6)} mm (exact ${(sw * 1e3).toFixed(6)}), camera level off by ${eL.toExponential(1)} m`);
}

// 3. the exact exponential cycle: the film linear in the level, the pool's top fixed
{
  const V = 60e-6, tau = 3, xBack = 0.13, A = W * xBack, dfdP = 0.66e-6;   // (m/Pa: the 2D's 0.66 mm/kPa)
  const c = F.feedCycle({ W, U, film0, dfdP, rho, g, Pup, R, H, xBack, V, tau, meets: () => 0 });
  // by hand: y = h − h̄; pulse y' = (Qin − Q0)/A − λ y, drain y' = −Q0/A − λ y, λ = k/A, k = U W dfdP ρ g. The mean of y is 0,
  // so the paste out over a cycle is Q0 T: T = V / Q0. Periodicity fixes y0.
  const Q0 = U * W * film0, k = U * W * dfdP * rho * g, lam = k / A, Qin = V / tau, T = V / Q0, yp = (Qin - Q0) / k, yd = -Q0 / k;
  const e1 = Math.exp(-lam * tau), e2 = Math.exp(-lam * (T - tau));
  // y1 = yp + (y0 − yp) e1;  y0 = yd + (y1 − yd) e2  ->  y0 (1 − e1 e2) = yd (1 − e2) + yp (1 − e1) e2
  const y0 = (yd * (1 - e2) + yp * (1 - e1) * e2) / (1 - e1 * e2), y1 = yp + (y0 - yp) * e1, hBar = Pup / (rho * g);
  // the mean of y over the cycle (exact integrals): it must be 0 for this to be the app's cycle
  const meanY = (yp * tau + (y0 - yp) * (1 - e1) / lam + yd * (T - tau) + (y1 - yd) * (1 - e2) / lam) / T;
  const eT = Math.abs(c.T / T - 1), eL = Math.abs(c.hLow - (hBar + y0)), eH = Math.abs(c.hHigh - (hBar + y1));
  check('film linear in the level (the 1D\'s sensitivity), the pool\'s top fixed: the exact exponential cycle', eT < 1e-9 && eL < 1e-11 && eH < 1e-11 && Math.abs(meanY) < 1e-12,
    `cycle ${c.T.toFixed(4)} s (exact V/Q0 ${T.toFixed(4)}), low ${((c.hLow - hBar) * 1e6).toFixed(3)} µm (exact ${(y0 * 1e6).toFixed(3)}), high ${((c.hHigh - hBar) * 1e6).toFixed(3)} µm (exact ${(y1 * 1e6).toFixed(3)}); the exact mean ${meanY.toExponential(1)}`);
  check('  the film follows: thinnest at the camera\'s level, thickest at the pulse\'s end; it repeats along the web every U T', Math.abs(c.filmMin - (film0 + dfdP * rho * g * y0)) < 1e-12 && Math.abs(c.filmMax - (film0 + dfdP * rho * g * y1)) < 1e-12 && Math.abs(c.band - U * T) < 1e-12 * U * T
    && Math.abs(c.filmAlong(0) - c.filmMin) < 1e-12 && Math.abs(c.filmAlong(c.band) - c.filmMin) < 1e-10,
    `film ${(c.filmMin * 1e6).toFixed(2)} to ${(c.filmMax * 1e6).toFixed(2)} µm, repeating every ${(c.band * 1e3).toFixed(1)} mm along the web`);
}

// 4. the pool's top growing with the level (the round blade): paste conserved; the steps converged
{
  const o = { W, U, film0, dfdP: 0.66e-6, rho, g, Pup, R, H, xBack: 0.13, V: 60e-6, tau: 3 };
  const a = F.feedCycle(o), b = F.feedCycle({ ...o, n: 8000 });
  const eIn = Math.abs(a.volIn / o.V - 1), eOut = Math.abs(a.volOut / o.V - 1);
  check('the pool\'s top growing with the level (round blade): the paste in and out over a cycle both the pulse\'s volume', eIn < 1e-12 && eOut < 1e-8,
    `in ${(a.volIn * 1e6).toFixed(6)} ml, out ${(a.volOut * 1e6).toFixed(6)} ml (pulse ${o.V * 1e6} ml); the top ${(a.area(a.hLow) * 1e4).toFixed(2)} to ${(a.area(a.hHigh) * 1e4).toFixed(2)} cm²`);
  check('  twice the steps: the cycle and the swing change by less than 1e-9', Math.abs(b.T / a.T - 1) < 1e-9 && Math.abs(b.swing / a.swing - 1) < 1e-9,
    `cycle ${a.T.toFixed(6)} → ${b.T.toFixed(6)} s, swing ${(a.swing * 1e6).toFixed(4)} → ${(b.swing * 1e6).toFixed(4)} µm`);
}

// 5. the outlets
{
  const c = F.feedCycle({ W, U, film0, dfdP: 0.66e-6, rho, g, Pup, R, H, xBack: 0.13, V: 60e-6, tau: 3 });
  const o = { V: 60e-6, tau: 3, n: 4, d: 0.01, tip: 0.06, x: 0.1, zs: F.feedEquidistant(4, W), W, g, rho, xBack: 0.13 };
  const r = F.feedOutlets(o, c), q = 5e-6, v0 = q / (Math.PI * 0.01 * 0.01 / 4), vL = Math.sqrt(v0 * v0 + 2 * g * (0.06 - c.hHigh));
  const ok = Math.abs(r.q - q) < 1e-18 && Math.abs(r.v0 - v0) < 1e-15 && Math.abs(r.vLand - vL) < 1e-15 && Math.abs(r.dLand - 0.01 * Math.sqrt(v0 / vL)) < 1e-15 && r.checks.every(k => k.ok);
  const low = F.feedOutlets({ ...o, tip: c.hHigh - 1e-3 }, c), onBlade = F.feedOutlets({ ...o, x: c.meetsHigh - 1e-3 }, c), behind = F.feedOutlets({ ...o, x: 0.14 }, c);
  const out = F.feedOutlets({ ...o, zs: [0.002, 0.1, 0.2, 0.29] }, c), overlap = F.feedOutlets({ ...o, zs: [0.05, 0.055, 0.2, 0.25] }, c);
  check('the outlets: the stream (V/(n τ)), its speed out, free fall, its diameter by continuity; every check passes on the defaults', ok,
    `${(r.q * 1e6).toFixed(2)} ml/s each, ${(r.v0 * 1e3).toFixed(1)} mm/s out, at most ${(r.vLand * 1e3).toFixed(0)} mm/s landing after ${(r.fall * 1e3).toFixed(1)} mm, ${(r.dLand * 1e3).toFixed(2)} mm across there`);
  check('  each check fails when it should: tips in the paste, the stream on the blade, behind the pool, outside the plates, overlapping',
    !low.checks[0].ok && !onBlade.checks[1].ok && !behind.checks[2].ok && !out.checks[3].ok && !overlap.checks[3].ok);
  const e = F.feedEquidistant(4, 0.3);
  check('  equidistant outlets: each in the middle of its share of the width', e.every((z, i) => Math.abs(z - 0.3 * (i + 0.5) / 4) < 1e-15), e.map(z => (z * 1e3).toFixed(1)).join(', ') + ' mm');
}

// 6. how the paste enters: the pipes in the paste (tips below the lowest level) and the heaps (at every level) take their
//  footprints off the top -- the exact saw-tooth on the smaller top; tips above the paste, falling: nothing taken
{
  const V = 60e-6, tau = 3, xBack = 0.13, A = W * xBack, Do = 0.014, n = 4, foot = n * Math.PI * Do * Do / 4, hBar = Pup / (rho * g);
  const base = { W, U, film0, dfdP: 0, rho, g, Pup, R, H, xBack, V, tau, meets: () => 0 };
  const Q = U * W * film0, sw = (V - Q * tau) / (A - foot);
  const dip = F.feedCycle({ ...base, pipes: { n, Do, tip: hBar - 0.02, entry: 'dip' } }), heap = F.feedCycle({ ...base, pipes: { n, Do, tip: hBar + 0.02, entry: 'heap' } });
  const fall = F.feedCycle({ ...base, pipes: { n, Do, tip: hBar + 0.02, entry: 'fall' } }), none = F.feedCycle(base);
  check('how the paste enters: the pipes in the paste, or the heaps up to the tips, take their footprints off the top (the exact saw-tooth on A − n π Do²/4)',
    Math.abs(dip.swing / sw - 1) < 1e-9 && Math.abs(heap.swing / sw - 1) < 1e-9 && Math.abs(dip.T / (V / Q) - 1) < 1e-10,
    `swing ${(dip.swing * 1e3).toFixed(6)} mm (tips in the paste), ${(heap.swing * 1e3).toFixed(6)} mm (heaps), exact ${(sw * 1e3).toFixed(6)}; without the pipes ${(none.swing * 1e3).toFixed(6)} mm`);
  check('  falling from tips above the paste: the cycle exactly as without the pipes', fall.swing === none.swing && fall.T === none.T && fall.hLow === none.hLow);
}

// 7. the outlets for each entry: where the paste meets the pool, and the checks
{
  const c = F.feedCycle({ W, U, film0, dfdP: 0.66e-6, rho, g, Pup, R, H, xBack: 0.13, V: 60e-6, tau: 3 });
  const o = { V: 60e-6, tau: 3, n: 4, d: 0.01, Do: 0.014, x: 0.1, zs: F.feedEquidistant(4, W), W, g, rho, xBack: 0.13 };
  const q = 5e-6, v0 = q / (Math.PI * 0.01 * 0.01 / 4), vh = q / (Math.PI * 0.014 * 0.014 / 4);
  const heap = F.feedOutlets({ ...o, entry: 'heap', tip: c.hHigh + 0.005 }, c), dip = F.feedOutlets({ ...o, entry: 'dip', tip: c.hLow - 0.005 }, c);
  const heapLow = F.feedOutlets({ ...o, entry: 'heap', tip: c.hHigh - 0.001 }, c), dipHigh = F.feedOutlets({ ...o, entry: 'dip', tip: c.hLow + 0.001 }, c);
  check('the outlets for each entry: down a heap, its mean speed across the pipe\'s width; out of a tip in the paste, the bore\'s speed; each check passes',
    Math.abs(heap.vLand - vh) < 1e-15 && heap.dLand === 0.014 && Math.abs(dip.vLand - v0) < 1e-15 && dip.dLand === 0.01 && heap.checks.every(k => k.ok) && dip.checks.every(k => k.ok)
    && Math.abs(heap.fall - 0.005) < 1e-15 && Math.abs(dip.depth - 0.005) < 1e-15,
    `heap ${(heap.vLand * 1e3).toFixed(2)} mm/s over ${(heap.dLand * 1e3).toFixed(1)} mm; in the paste ${(dip.vLand * 1e3).toFixed(2)} mm/s over ${(dip.dLand * 1e3).toFixed(1)} mm; "${heap.checks[0].text}" "${dip.checks[0].text}"`);
  check('  and fails when it should: a heap whose tip is in the paste at the highest level; tips in the paste that come out at the lowest', !heapLow.checks[0].ok && !dipHigh.checks[0].ok);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
