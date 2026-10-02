/*
 * physics.js — pure physics/math for the Blade Coat Defect Lab.
 *
 * No DOM or canvas access happens in this file. Every function here is a
 * closed-form or near-closed-form formula that takes numbers in and returns
 * numbers out, so it can be read (or unit-tested) independently of the UI.
 *
 * Process picture: slurry sits in a bead upstream of a fixed blade. A web
 * (fibre) moves under the blade's land at speed U. The gap between the
 * blade and the web meters a thin film onto the fibre. Everything below
 * works in SI-ish mixed units (mm for lengths people set with sliders,
 * converted to metres right before use in an SI formula) — each function
 * says which it expects.
 */

// ---------------------------------------------------------------------
// Parameter schema: every slider the UI renders, its range, default value,
// and the physical meaning behind it. P holds the *current* values (read
// by every physics function below); ui.js builds the sliders from CFG and
// keeps P in sync as the user drags them.
// ---------------------------------------------------------------------
const CFG = [
  { g: 'Process', k: 'U', l: 'Web speed', min: 0.1, max: 1.0, step: 0.01, u: 'm/min', d: 2, v: 0.28 },
  { k: 'Hm', l: 'Machine scraper height', min: 1.5, max: 2.3, step: 0.01, u: 'mm', d: 2, v: 1.90 },
  { k: 'tf', l: 'Fibre thickness', min: 0.05, max: 1.0, step: 0.01, u: 'mm', d: 2, v: 0.20 },
  { k: 'oven', l: 'Distance to oven', min: 0.1, max: 2, step: 0.05, u: 'm', d: 2, v: 0.5 },

  { g: 'Slurry', k: 'mu', l: 'Viscosity μ (at 2.7 1/s)', min: 2, max: 30, step: 0.5, u: 'Pa·s', d: 1, v: 10.5, h: 'Newtonian: τ = μ γ̇; the other laws: the value they give at 2.7 1/s' },
  // (MH-3: the laws' own parameters; K for the default (Herschel–Bulkley, τy 5 Pa, n 1) is the one that gives your 10.5 Pa·s at
  //  2.7 1/s: 10.5 − 5/2.7 Pa·s; η0 the Carreau–Yasuda law's with n 1. P.mu also carries every law's viscosity at 2.7 1/s:
  //  rheo-params.js keeps it in step)
  { k: 'K', l: 'Consistency K', min: 0.01, max: 100, step: 0.01, u: 'Pa·sⁿ', d: 3, v: 10.5 - 5 / 2.7, h: 'τ = τy + K γ̇ⁿ (power law: τy = 0)' },
  { k: 'eta0', l: 'Zero-shear viscosity η0', min: 0.01, max: 10000, step: 0.01, u: 'Pa·s', d: 2, v: 10.5, h: 'Carreau–Yasuda, Cross: the plateau at low shear' },
  { k: 'n', l: 'Shear-thinning index n', min: 0.3, max: 1, step: 0.05, u: '', d: 2, v: 1, h: '1 = Newtonian' },
  { k: 'ty', l: 'Yield stress', min: 0, max: 40, step: 0.5, u: 'Pa', d: 1, v: 5 },
  { k: 'g', l: 'Surface tension', min: 0.03, max: 0.08, step: 0.005, u: 'N/m', d: 3, v: 0.07 },

  { g: 'Blade and bead', k: 'Pup', l: 'Bead pressure over the land', min: 0, max: 3, step: 0.01, u: 'kPa', d: 2, v: 0.49, h: 'set so the 2D gives the design wet film, 1.45 mm, at L1' },
  { k: 'L', l: 'Land length', min: 3, max: 25, step: 0.5, u: 'mm', d: 1, v: 10 },
  { k: 'th', l: 'Contact angle on blade', min: 5, max: 120, step: 1, u: '°', d: 0, v: 35 },
  { k: 'thw', l: 'Contact angle on the web', min: 5, max: 120, step: 1, u: '°', d: 0, v: 35, h: 'where the slurry\'s side meets the bare web (3D, open edges)' },
  { k: 'face', l: 'Notch face length to corner', min: 2, max: 12, step: 0.5, u: 'mm', d: 1, v: 8 },

  { g: 'Variation across the web', k: 'dH', l: 'Blade gap waviness (amplitude)', min: 0, max: 100, step: 1, u: 'µm', d: 0, v: 20 },
  { k: 'lw', l: 'Waviness wavelength', min: 20, max: 300, step: 5, u: 'mm', d: 0, v: 120 },
  { k: 'tilt', l: 'Blade tilt across the web', min: -500, max: 500, step: 5, u: 'µm', d: 0, v: 0, h: 'gap difference edge to edge, centred; + wider at z = 300 mm' },
  { k: 'skew', l: 'Blade skew across the web', min: -5, max: 5, step: 0.1, u: '°', d: 1, v: 0, h: 'edge\'s angle to the cross direction; + its end at z = 300 mm further downstream' },
  { k: 'dt', l: 'Fibre thickness variation', min: 0, max: 60, step: 1, u: 'µm', d: 0, v: 10 },
  { k: 'dth', l: 'Wetting variation on blade', min: 0, max: 20, step: 0.5, u: '°', d: 1, v: 4, h: 'contamination, residue' },

  // (the pool fed in pulses, Coating › 1D › Pool and feed: the paste falls from the outlets onto the pool's top, all of
  //  them together, when the level has dropped; each value editable)
  { g: 'Pool and feed', k: 'fN', l: 'Outlets', min: 1, max: 12, step: 1, u: '', d: 0, v: 4, h: 'all fire together; equidistant across the web unless placed on Pool and feed' },
  { k: 'fV', l: 'Paste per pulse, all outlets', min: 5, max: 1000, step: 1, u: 'ml', d: 0, v: 60, h: 'set it from your pump' },
  { k: 'fTau', l: 'Pulse length', min: 0.5, max: 60, step: 0.5, u: 's', d: 1, v: 3, h: 'set it from your pump' },
  { k: 'fTip', l: 'Outlet tip above the web', min: 5, max: 300, step: 1, u: 'mm', d: 0, v: 60, h: 'measure it on the line' },
  { k: 'fX', l: 'Outlets upstream of the blade edge', min: 5, max: 400, step: 1, u: 'mm', d: 0, v: 100, h: 'measure it on the line' },
  { k: 'fD', l: 'Outlet inner diameter', min: 1, max: 40, step: 0.5, u: 'mm', d: 1, v: 10, h: 'measure it on the line' },
  { k: 'fBack', l: 'Pool back edge upstream of the blade edge', min: 10, max: 500, step: 1, u: 'mm', d: 0, v: 130, h: 'where the paste ends behind the blade' },
  // (the pool's mesh, Coating › 2D and 3D › Pool and feed: each page its own)
  { g: 'Pool mesh', k: 'f2H', l: '2D pool: elements where the paste lands', min: 0.3, max: 10, step: 0.1, u: 'mm', d: 1, v: 1, h: 'smaller: finer and slower' },
  { k: 'f2Hm', l: '2D pool: elements elsewhere', min: 1, max: 40, step: 0.5, u: 'mm', d: 1, v: 5, h: 'the largest along the web' },
  { k: 'f2Ny', l: '2D pool: rows from the web to the top', min: 2, max: 20, step: 1, u: '', d: 0, v: 8, h: 'finer near the web' },
  { k: 'f3H', l: '3D pool: elements where the paste lands', min: 0.5, max: 10, step: 0.1, u: 'mm', d: 1, v: 3, h: 'smaller: finer and much slower' },
  { k: 'f3Hm', l: '3D pool: elements elsewhere', min: 2, max: 60, step: 0.5, u: 'mm', d: 1, v: 20, h: 'the largest along and across the web' },
  { k: 'f3Ny', l: '3D pool: rows from the web to the top', min: 2, max: 12, step: 1, u: '', d: 0, v: 4, h: 'finer near the web' },

  { g: 'Web edge and film', k: 'a0e', l: 'Edge irregularity at exit', min: 5, max: 200, step: 5, u: 'µm', d: 0, v: 30 },
  { k: 'lam', l: 'Ripple wavelength on film', min: 2, max: 40, step: 0.5, u: 'mm', d: 1, v: 8 },
  { k: 'vib', l: 'Vibration ripple on film', min: 0, max: 80, step: 1, u: 'µm', d: 0, v: 10 },
];

// Live parameter values, keyed the same as CFG[i].k. Populated with defaults
// now; ui.js overwrites individual keys as sliders move.
const P = {};
CFG.forEach(c => { P[c.k] = c.v; });
// The pool's outlets across the web (Coating › 1D › Pool and feed): their positions (mm from the web's edge at z = 0), or
// null: equidistant (each in the middle of its share of the width). Kept by the project file and the undo history.
const FEED_POS = { z: null };
/** The outlets' positions now (mm): as placed if placed for this many outlets, else equidistant. */
const feedZs = (n = P.fN, W = 300) => FEED_POS.z && FEED_POS.z.length === n ? FEED_POS.z.slice() : Array.from({ length: n }, (_, i) => +(W * (i + 0.5) / n).toFixed(3));

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
// (the slurry's density: materials.js's slurryRho, from its solids)
const GRAVITY = 9.81;          // m/s²
const SIN45 = Math.SQRT1_2;    // sin(45°) = cos(45°) — the blade's notch face is drawn at 45° to the land

/** Fibre-side gap actually available to the slurry: machine height minus the web itself. */
const gapHeight = () => P.Hm - P.tf;

/**
 * Apparent (shear-rate-dependent) viscosity, Herschel–Bulkley-style:
 *   mu_eff(gd) = ty/gd + base * (gd/2.7)^(n-1)
 * "base" is picked so that at the reference shear rate (2.7 1/s) mu_eff
 * reproduces exactly P.mu, the law's viscosity there (rheo-params.js keeps
 * it in step with τy, K, n):
 *   ty/2.7 + base = P.mu  =>  base = P.mu - ty/2.7 = K 2.7^(n-1) > 0
 * (MH-3: no floor -- it silently changed the law; NaN where none holds).
 * gd is clamped away from 0 because the yield-stress term diverges there
 * (physically correct for a yield-stress fluid — apparent viscosity really
 * does go to infinity as shear rate goes to zero — but a literal 0 would
 * produce Infinity in JS arithmetic downstream).
 */
function muEff(gd) {
  gd = Math.max(gd, 1e-6);
  const ref = P.mu, ty = P.ty;
  const base = ref - ty / 2.7;
  if (!(base > 0)) return NaN;
  return ty / gd + base * Math.pow(gd / 2.7, P.n - 1);
}

/**
 * Wet film thickness (mm) left behind a blade running over gap Hmm (mm),
 * from 1D lubrication theory for flow between a fixed blade (land) and a
 * web moving at U, with a pressure gradient dp/dx driven by the upstream
 * bead pressure over the land length:
 *   q = U*H/2 + H^3/(12*mu) * dp/dx        (flow rate per unit width)
 *   h = q / U                              (all of q becomes film downstream)
 * A representative shear rate U/H is used to evaluate mu_eff — this is an
 * engineering approximation (the exact profile for a shear-thinning fluid
 * varies across the gap), not a full nonlinear solve.
 */
function filmThickness(Hmm) {
  const U = P.U / 60;                    // m/min -> m/s
  const H = Hmm / 1000;                  // mm -> m
  const gd = U / H;                      // representative shear rate, 1/s
  const mu = muEff(gd);
  const dpdx = P.Pup * 1000 / (P.L / 1000); // kPa over mm -> Pa/m
  return 1000 * H * (0.5 + H * H * dpdx / (12 * mu * U)); // m -> mm
}

/** Capillary length sqrt(gamma / (rho*g)), in mm — the natural length scale for capillary effects. */
const capillaryLength = () => Math.sqrt(P.g / (slurryRho() * GRAVITY)) * 1000;

/**
 * Static meniscus / contact-line position on the blade's notch face, from
 * the 2D Young–Laplace balance (gravity + capillarity, no dynamic wetting).
 *
 * hc = 2*Lcap*sin(phi/2) is the closed-form climb height of a 2D static
 * meniscus for local surface slope angle phi (see meniscusProfile() below
 * for the matching profile integration) — phi here is derived from the measured
 * contact angle `th` via the blade's fixed notch-face geometry (the face
 * is drawn at 45° to the land; see draw.js/simulation.js).
 *
 * If the unconstrained climb doesn't reach past the gap, the contact line
 * is pinned at the sharp metering edge (Gibbs pinning); otherwise it has
 * moved `s` mm up the 45° face toward the notch corner.
 */
function contactLine(Hmm, th) {
  const h = filmThickness(Hmm);
  const capLen = capillaryLength();
  const phi = Math.min(Math.max(135 - th, 0), 180) * Math.PI / 180;
  const hc = 2 * capLen * Math.sin(phi / 2);
  const climbHeight = h + hc;

  if (climbHeight <= Hmm) {
    const pinnedRise = Math.max(Hmm - h, 0);
    return { h, s: 0, pinned: true, phi: 2 * Math.asin(Math.min(1, pinnedRise / (2 * capLen))), hc: pinnedRise };
  }
  return { h, s: (climbHeight - Hmm) / SIN45, pinned: false, phi, hc };
}

/**
 * Points along the static meniscus profile, parametrised by local slope
 * angle (the standard closed-form 2D Young–Laplace meniscus solution):
 *   z(phi) = 2*Lcap*sin(phi/2)
 *   dx/dphi = -Lcap*cos(phi) / (2*sin(phi/2))
 * integrated from the contact line (phi = phic) down to a near-flat
 * asymptote (phi ~ 0), matching the hc formula used in contactLine().
 */
function meniscusProfile(xq, filmY, phic) {
  const capLen = capillaryLength();
  const pts = [];
  const STEPS = 240, PHI_FLAT = 0.03;
  let x = xq;
  pts.push([x, filmY + 2 * capLen * Math.sin(phic / 2)]);
  for (let i = 1; i <= STEPS; i++) {
    const a = phic + (PHI_FLAT - phic) * (i - 1) / STEPS;
    const b = phic + (PHI_FLAT - phic) * i / STEPS;
    const mid = (a + b) / 2;
    x += Math.cos(mid) * capLen / (2 * Math.sin(mid / 2)) * (a - b);
    pts.push([x, filmY + 2 * capLen * Math.sin(b / 2)]);
  }
  return pts;
}

/**
 * Edge-bead relaxation: after metering, the wet edge is a ridge of slurry
 * along the fibre margin that surface tension pulls into beads (a
 * Rayleigh–Plateau instability) while viscosity resists it, and a yield
 * stress can arrest it outright.
 *
 * The growth rate and wavelength below are the classical inviscid/viscous
 * Rayleigh–Plateau estimate for a cylindrical thread of radius R — both
 * asymptotic limits (Rayleigh 1879 inviscid; the long-wave viscous-thread
 * limit) put the dominant wavelength within a few percent of 9*R, which is
 * why a single "9*R" is used here regardless of which regime applies. This
 * is explicitly an order-of-magnitude indicator (see the UI caption on the
 * Web Edge tab) — useful for seeing which lever matters, not for
 * predicting exact millimetres.
 *
 * The relaxation is slow (post-metering, not the high-shear gap), so a low
 * reference shear rate (0.1 1/s) is used for mu_eff — the same function
 * used everywhere else, so the yield stress correctly slows edge growth
 * here too.
 * h: the wet film at the web's edge (m) -- the solved answer (answers.js), not an estimate.
 */
function edgeBead(h) {
  const R = h / 2;                         // bead treated as a half-round ridge
  const gd = 0.1;                          // slow, near-static relaxation
  const capillaryPressure = P.g / R;           // Pa, Laplace pressure of the ridge
  const wavelength = 9 * R * 1000;             // m -> mm
  const st = rebuildOnWeb();
  if (st) {
    // the slurry rebuilding at rest on the web (GO-1): mu and the yield stress follow lambda(t) from just after the blade;
    // the bead grows at gamma / (6 mu(t) R) until the rebuilding yield stress beats the ridge's pressure (tArrest), then holds
    const { S, law, lam0 } = st, muOf = l => rheoMuStruct(gd, l, law, S), mu = muOf(lam0);
    const lamStop = P.ty > 0 ? ((capillaryPressure / P.ty) * (1 + S.cy) - 1) / S.cy : Infinity;   // (lambda where the yield stress reaches it)
    const arrested = lamStop <= lam0;
    const tArrest = arrested ? 0 : lamStop < 1 ? S.tb * Math.log((1 - lam0) / (1 - lamStop)) : Infinity;
    const growth = t => P.g / (6 * R) * rheoRestInv(muOf, lam0, S, Math.min(t, tArrest));   // (the growth exponent by time t)
    return { h, R, mu, sig: P.g / (6 * mu * R), lam: wavelength, pc: capillaryPressure, arrest: arrested, lam0, tArrest, growth, muRested: muOf(1) };
  }
  const mu = muEff(gd);
  const growthRate = P.g / (6 * mu * R);       // 1/s
  const arrested = capillaryPressure < P.ty;   // yield stress beats the driving pressure
  return { h, R, mu, sig: growthRate, lam: wavelength, pc: capillaryPressure, arrest: arrested };
}

/** Edge scallop amplitude (mm) at x mm downstream of the blade (the Web edge tab's curve), on the wet film h (m) at the edge. */
function edgeAmplitudeAt(xmm, h) {
  const e = edgeBead(h), U = P.U / 60;
  if (e.arrest) return P.a0e / 1000;
  return Math.min(P.a0e / 1000 * Math.exp(e.growth ? e.growth(xmm / 1000 / U) : e.sig * xmm / 1000 / U), e.lam / 4);
}

/**
 * The structure (thixotropy, GO-1) the quick tabs follow after the blade, when it is on: the Herschel–Bulkley law as
 * muEff (rheo.js), S (materials.js), and lambda just after the blade, lam0: steady at the land's shear rate U / H (the
 * representative rate these tabs use; the 1D carries it along the blade). Null when off.
 */
function rebuildOnWeb() {
  const S = typeof matStruct === 'function' ? matStruct() : null;
  if (!S) return null;
  return { S, law: rheoCompile(P.mu, P.ty, P.n), lam0: rheoLamEq((P.U / 60) / (gapHeight() / 1000), S) };
}

/** Local gap (mm) and contact angle (deg) at position z (mm) across the web (0 to 300 mm): waviness, the blade's tilt
 *  (the gap difference from edge to edge, centred on the middle), fibre thickness and wetting variation; and the blade
 *  across the web's other parts (across-ui.js: a bow, more sines, chamfered ends, a measured gap, a crown -- none on:
 *  nothing added, and the waviness's crest where it always was). */
const localGap = z => gapHeight() + (acrossWave(z) + P.tilt * (z / 300 - 0.5) - P.dt * spatialNoise(z, 1.7)) / 1000 + acrossExtraMm(z);
const localContactAngle = z => P.th + P.dth * spatialNoise(z, 4.1);
/** The blade skewed across the web: its metering edge at P.skew degrees to the cross direction (+: the end at z = 300 mm
 *  further downstream). The 1D, 2D and 3D work in the blade's frame: the web crosses the blade at U cos(skew) and moves
 *  along it at U sin(skew); distances along the flow are measured across the blade (the oven's: oven cos(skew)). */
const skewRad = () => (P.skew || 0) * Math.PI / 180;

/**
 * Dimensionless checks on whether the thin-film/lubrication assumptions
 * still hold for the current inputs. Used to gate the "model validity"
 * message shown throughout the UI — see updateScope() in ui.js.
 * The film checked is the solved answer at L1 (answers.js) once there is one.
 */
function modelScope() {
  const H = gapHeight() / 1000;
  const U = P.U / 60;
  const mu = muEff(U / H);
  const a = typeof ansAt === 'function' ? ansAt(0) : null, h = a ? a.film : 1;
  const Re = slurryRho() * U * H / mu;          // inertia vs viscous forces
  const Ca = mu * U / P.g;              // viscous vs capillary forces
  const aspect = H / (P.L / 1000);      // gap / land length

  const issues = [];
  if (aspect > 0.2) issues.push('gap/land ratio is too large for lubrication theory');
  if (Re > 1) issues.push('inertia is no longer negligible');
  if (Ca > 0.1) issues.push('the static contact-line model omits important dynamic wetting');
  if (h <= 0 || !Number.isFinite(h)) issues.push('no finite positive film solution');

  return { Re, Ca, aspect, issues };
}

/** Deterministic multi-harmonic "roughness" generator, used to synthesise plausible spatial variation (waviness, wetting noise) across the web width. Not a measurement — just a stand-in for real scatter. */
const spatialNoise = (z, seed) =>
  (Math.sin(z / 13.1 + seed) + 0.6 * Math.sin(z / 5.3 + 2.1 * seed) + 0.35 * Math.sin(z / 2.7 + 3.3 * seed)) / 1.95;
