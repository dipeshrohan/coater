/*
 * sem.validate.js — checks of the SEM image reading (sem.js). Run: node sem.validate.js
 *  1. Streaks at a known angle (a grating of bright lines): the angle read, everywhere in the film, within 1°.
 *  2. The web's line tilted in the image: angles to it (the grating tilted with it reads as before).
 *  3. Two layers at +20° and −20°: each depth band reads its own.
 *  4. No direction (noise): the angles spread evenly (⟨cos 2θ⟩ about 0).
 *  5. Flakes clicked by hand: their angles and depths exactly.
 *  6. Tables of angles: columns by name, cuts, depths in µm or as fractions, the bad rows counted.
 */
const S = require('./sem.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const wmean = (a, w) => { let s = 0, c = 0, sw = 0; a.forEach((x, i) => { s += w[i] * Math.sin(2 * x * Math.PI / 180); c += w[i] * Math.cos(2 * x * Math.PI / 180); sw += w[i]; }); return { mean: 0.5 * Math.atan2(s, c) * 180 / Math.PI, S2: Math.hypot(s, c) / sw, c2: c / sw }; };

/** A grating: bright lines at angle(y) degrees (y up), spacing lam px, rotated about the image by rot degrees too. */
function grating(w, h, angleOf, lam = 7) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = angleOf(x, y) * Math.PI / 180, yu = h - y;
    g[y * w + x] = 0.5 + 0.5 * Math.cos(2 * Math.PI * (-Math.sin(t) * x + Math.cos(t) * yu) / lam);
  }
  return g;
}
const W = 240, H = 160;
// 1. known angles, a level web's line along the bottom (drawn left to right), the top at the image's top
for (const a of [0, 15, -30, 60, -75]) {
  const g = grating(W, H, () => a), r = S.semAngles(g, W, H, { web: [0, H - 1, W - 1, H - 1], top: [W / 2, 0] });
  const m = wmean(r.angles, r.weights);
  let dm = Math.abs(m.mean - a); if (dm > 90) dm = 180 - dm;
  check(`streaks at ${a}°: read ${m.mean.toFixed(2)}° within 1°, ⟨cos 2(θ − ${a}°)⟩ ≥ 0.98`, dm < 1 && m.S2 >= 0.98, `${r.angles.length} points, order ${m.S2.toFixed(4)}, depths ${Math.min(...r.depths).toFixed(2)}–${Math.max(...r.depths).toFixed(2)}`);
}
// 2. the web's line tilted by 10° in the image, the streaks at 10° + 20°: 20° to the web
{
  const tilt = 10, g = grating(W, H, () => tilt + 20);
  const x1 = 10, y1 = H - 10, x2 = W - 10, y2 = y1 - Math.tan(tilt * Math.PI / 180) * (x2 - x1);
  const r = S.semAngles(g, W, H, { web: [x1, y1, x2, y2], top: [W / 2, 0] }), m = wmean(r.angles, r.weights);
  check('the web\'s line tilted 10° in the image, streaks at 30°: 20° to the web within 1°', Math.abs(m.mean - 20) < 1, `${m.mean.toFixed(2)}°`);
  // drawn right to left: the angle's sign follows the web's direction
  const rr = S.semAngles(g, W, H, { web: [x2, y2, x1, y1], top: [W / 2, 0] }), mr = wmean(rr.angles, rr.weights);
  check('  the web\'s line drawn the other way: the same streaks read −20° (rising the other way)', Math.abs(mr.mean + 20) < 1, `${mr.mean.toFixed(2)}°`);
}
// 3. two layers: +20° below the middle, −20° above
{
  const g = grating(W, H, (x, y) => (y > H / 2 ? 20 : -20));
  const r = S.semAngles(g, W, H, { web: [0, H - 1, W - 1, H - 1], top: [W / 2, 0] });
  const lo = r.angles.map((a, i) => [a, r.weights[i], r.depths[i]]).filter(q => q[2] < 0.4), hi = r.angles.map((a, i) => [a, r.weights[i], r.depths[i]]).filter(q => q[2] > 0.6);
  const ml = wmean(lo.map(q => q[0]), lo.map(q => q[1])), mh = wmean(hi.map(q => q[0]), hi.map(q => q[1]));
  check('two layers: +20° in the lower band, −20° in the upper, each within 1°', Math.abs(ml.mean - 20) < 1 && Math.abs(mh.mean + 20) < 1, `${ml.mean.toFixed(2)}°, ${mh.mean.toFixed(2)}°`);
}
// 4. noise: no direction
{
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = new Float32Array(W * H).map(() => rnd());
  const r = S.semAngles(g, W, H, { web: [0, H - 1, W - 1, H - 1], top: [W / 2, 0] }, { minCoh: 0 }), m = wmean(r.angles, r.weights);
  check('noise: no preferred direction (|⟨cos 2θ⟩| and the order below 0.1)', Math.abs(m.c2) < 0.1 && m.S2 < 0.1, `order ${m.S2.toFixed(3)}, ⟨cos 2θ⟩ ${m.c2.toFixed(3)}, ${r.angles.length} points`);
}
// 5. by hand
{
  const geom = { web: [0, 100, 200, 100], top: [50, 20] };   // (film 80 px thick)
  const r = S.semHand([[10, 90, 30, 90], [10, 60, 30, 40], [50, 30, 60, 40], [5, 5, 5, 5]], geom);
  const ok = r.angles.length === 3 && Math.abs(r.angles[0]) < 1e-12 && Math.abs(r.angles[1] - 45) < 1e-12 && Math.abs(r.angles[2] + 45) < 1e-12
    && Math.abs(r.depths[0] - 10 / 80) < 1e-12 && Math.abs(r.depths[1] - 50 / 80) < 1e-12 && Math.abs(r.depths[2] - 65 / 80) < 1e-12;
  check('by hand: level, rising 45°, falling 45°; depths 0.125, 0.625, 0.8125; a click on one point left out', ok, `${r.angles.map(a => a.toFixed(1)).join(', ')}°; ${r.depths.map(d => d.toFixed(4)).join(', ')}`);
}
// 6. tables
{
  const t1 = S.semTable('cut,depth_um,angle_deg\nMD,12.5,-3.2\nMD,40.1,6.8\nCD,15.0,1.1\nCD,77.3,-9.4\nMD,,\nacross,5,95');
  const ok1 = t1.rows.length === 5 && t1.rows[2][0] === 'cd' && t1.rows[0][0] === 'md' && t1.rows[4][0] === 'cd' && Math.abs(t1.rows[4][2] + 85) < 1e-12 && t1.skipped === 1 && !t1.fraction;
  const t2 = S.semTable('Depth\tAngle (°)\tThickness µm\n0.1\t2\t50\n0.9\t-4\t');
  const t3 = S.semTable('angle;depth\n3,5;0,25\n-1;0,75');
  const t4 = S.semTable('x,y\n1,2');
  check('tables: columns by name, cut words, angles folded to −90..90, bad rows counted; tab and semicolon separated, decimal commas; thickness; no angle column', ok1
    && t2.rows.length === 2 && t2.thickness === 50 && !t2.fraction && t3.rows.length === 2 && t3.rows[0][2] === 3.5 && t3.fraction && t4.rows.length === 0 && t4.problems.length === 1,
    `${t1.rows.length} rows, ${t1.skipped} skipped; thickness ${t2.thickness}; fractions ${t3.fraction}; ${t4.problems[0]}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
