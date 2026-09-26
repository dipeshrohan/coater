/*
 * across-ui.js — the blade across the web (Phase 4): its settings (ACR), the gap's change they make at each position
 * across the web (physics.js's localGap adds it: every page takes the gap from there), the computed bow, and the
 * design on the 1D Across the web page.
 *
 * Parts of the gap's change (µm, + = the gap larger), on top of what the sidebar always had (waviness, tilt, fibre
 * thickness): the bow (typed: its amount and shape; computed: the blade as a beam on its two ends under the slurry's
 * pressure from the 1D and its own weight), more sines (the first is today's waviness, with its crest where asked),
 * chamfered ends, a measured gap profile, a crown. The blade runs from -left to W + right: its ends relative to the
 * web's edges. Every new part is off until switched on: then the gap is today's, bit for bit.
 */
const ACR_DEFAULTS = {
  bladeEnds: { left: 0, right: 0 },                 // mm: + the blade overhangs the web's edge, - it ends inside
  bow: { on: false, mode: 'computed', um: 20, shape: 'parabola', supports: 'simple', E: 200, rhoB: 7850, h: 50, t: 20, I: null },
  crest: null,                                      // today's waviness: where its first crest is (mm); null: a quarter wavelength in
  sines: [],                                        // more sines: { a (µm), lw (mm), crest (mm or null) }
  ends: { on: false, left: { c: 15, d: 30 }, right: { c: 15, d: 30 } },
  meas: { on: false, name: '', pts: [] },           // a measured gap profile: [[z mm, change µm], ...]
  crown: { on: false, kind: 'parabola', um: 0, pts: [], name: '' },
  edgeBand: 10,                                     // mm: the crown evens the film between a band this wide at each edge
};
const ACR = JSON.parse(JSON.stringify(ACR_DEFAULTS));
const ACR_W = 300;   // the web's width (mm), as the sidebar's positions across it

/** The blade's span (mm): its left and right ends. */
const acrossSpanNow = () => acrossSpan(ACR_W, ACR.bladeEnds);
/** Is any new part on (the gap then differs from today's)? */
const acrossAny = () => !!(ACR.bow.on || ACR.sines.length || ACR.ends.on || (ACR.meas.on && ACR.meas.pts.length) || ACR.crown.on);

// ---- the gap ----
/** Today's waviness (µm), its first crest where set (physics.js's localGap). */
const acrossWave = z => acrossSine(z, P.dH, P.lw, ACR.crest);
let ACR_MEAS_F = null, ACR_CROWN_F = null;
const acrossMeasF = () => { const k = ACR.meas.pts; if (!ACR_MEAS_F || ACR_MEAS_F.k !== k) ACR_MEAS_F = { k, f: acrossPchip(k) }; return ACR_MEAS_F.f; };
const acrossCrownF = () => { const k = ACR.crown.pts; if (!ACR_CROWN_F || ACR_CROWN_F.k !== k) ACR_CROWN_F = { k, f: acrossPchip(k) }; return ACR_CROWN_F.f; };
/** The new parts, each (µm) at z; noBow: without the computed bow (the bow's own load needs the gap without it). */
function acrossParts(z, noBow = false) {
  const span = acrossSpanNow(), o = { bow: 0, sines: 0, ends: 0, meas: 0, crown: 0 };
  if (ACR.bow.on) o.bow = ACR.bow.mode === 'typed' ? acrossBowTyped(z, ACR.bow.um, ACR.bow.shape, span) : noBow ? 0 : acrossBowComputedAt(z);
  for (const s of ACR.sines) o.sines += acrossSine(z, s.a, s.lw, s.crest);
  if (ACR.ends.on) o.ends = acrossEnds(z, ACR.ends, span);
  if (ACR.meas.on && ACR.meas.pts.length) o.meas = acrossMeasF()(z);
  if (ACR.crown.on) o.crown = ACR.crown.kind === 'free' ? acrossCrownF()(z) : acrossBowTyped(z, ACR.crown.um, 'parabola', span);
  return o;
}
/** The new parts' sum (mm) at z; zero (exactly) when none is on. */
function acrossExtraMm(z, noBow = false) {
  if (!acrossAny()) return 0;
  const o = acrossParts(z, noBow || ACR_BOW_BUSY);
  return (o.bow + o.sines + o.ends + o.meas + o.crown) / 1000;
}

// ---- the computed bow ----
// (the blade as a beam on its two ends: the slurry's pressure under it from the 1D at 13 positions across the web,
// its own weight; the pressure depends on the gap and the gap on the bow, so solved again until the bow settles;
// cached on the inputs, so every page sees the same gap and it is worked out once)
let ACR_BOW = null, ACR_BOW_BUSY = false;
const ACR_BOW_N = 13;
const acrossBowSig = () => JSON.stringify([CFG.map(c => P[c.k]), CFDG, ACR]);
function acrossBowComputed() {
  const sig = acrossBowSig();
  if (ACR_BOW && ACR_BOW.sig === sig) return ACR_BOW;
  const t0 = performance.now(), span = acrossSpanNow(), L = (span[1] - span[0]) / 1000, b = ACR.bow;
  const sec = beamSection(b), EI = b.E * 1e9 * sec.I, weight = b.rhoB * GRAVITY * sec.A;
  // (where there are both web and blade: the slurry's load; elsewhere none)
  const c0 = Math.max(0, span[0]), c1 = Math.min(ACR_W, span[1]), zs = Array.from({ length: ACR_BOW_N }, (_, k) => c0 + (c1 - c0) * k / (ACR_BOW_N - 1));
  const out = { sig, span, EI, weight, zs, loads: null, s: null, w: null, iters: 0, error: null, ms: 0 };
  ACR_BOW_BUSY = true;
  try {
    const base = zs.map(z => oneDGeoAt(z));   // (the gap there without the computed bow: ACR_BOW_BUSY)
    let wAt = () => 0, prev = null;
    for (let it = 1; it <= 30; it++) {
      const F = base.map(g => {
        const r = gapFlow1D({ ...g, H: g.H + wAt(g.z) * 1e-6 }, { nx: 40, ny: 50 });
        let f = 0; for (let i = 1; i < r.x.length; i++) f += (r.x[i] - r.x[i - 1]) * (r.p[i] + r.p[i - 1]) / 2;
        return f;
      });
      const qz = z => { if (z < c0 || z > c1) return 0; let k = 0; while (k < zs.length - 2 && zs[k + 1] < z) k++; const t = (z - zs[k]) / (zs[k + 1] - zs[k]); return F[k] + (F[k + 1] - F[k]) * t; };
      const bm = beamBow({ L, EI, supports: b.supports, q: s => qz(span[0] + s * 1000) - weight });
      const s = Array.from(bm.s, v => span[0] + v * 1000), w = Array.from(bm.w, v => v * 1e6);
      Object.assign(out, { loads: F, s, w, iters: it });
      const hMin = Math.min(...base.map(g => g.H)) * 1e6;
      if (w.some(v => !Number.isFinite(v) || Math.abs(v) > 0.5 * hMin)) { out.error = `the blade bends ${(Math.max(...w.map(Math.abs)) / 1000).toFixed(2)} mm: more than half the gap, too far for this model (a stiffer blade, or typed bow)`; break; }
      const change = prev ? Math.max(...w.map((v, i) => Math.abs(v - prev[i]))) : Infinity;
      prev = w;
      wAt = z => { if (z <= s[0]) return w[0]; if (z >= s[s.length - 1]) return w[w.length - 1]; const h = s[1] - s[0], k = Math.min(w.length - 2, Math.floor((z - s[0]) / h)), t = (z - s[k]) / h; return w[k] + (w[k + 1] - w[k]) * t; };
      if (change < 1e-4) break;
      if (it === 30) out.error = 'the bow did not settle in 30 rounds';
    }
    out.at = wAt;
  } catch (e) { out.error = e.message; out.at = () => 0; }
  finally { ACR_BOW_BUSY = false; }
  out.ms = performance.now() - t0;
  ACR_BOW = out;
  return out;
}
/** The computed bow (µm) at z; zero beyond the blade or when it could not be worked out (the page says why). */
function acrossBowComputedAt(z) {
  const B = acrossBowComputed(), sp = B.span;
  if (B.error || !B.at || z < sp[0] || z > sp[1]) return 0;
  return B.at(z);
}
