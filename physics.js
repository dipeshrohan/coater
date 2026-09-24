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

  { g: 'Slurry', k: 'mu', l: 'Apparent viscosity at 2.7 1/s', min: 2, max: 30, step: 0.5, u: 'Pa·s', d: 1, v: 10.5 },
  { k: 'n', l: 'Shear-thinning index n', min: 0.3, max: 1, step: 0.05, u: '', d: 2, v: 1, h: '1 = Newtonian (assumed)' },
  { k: 'ty', l: 'Yield stress', min: 0, max: 40, step: 0.5, u: 'Pa', d: 1, v: 5, h: 'assumed, not measured' },
  { k: 'g', l: 'Surface tension', min: 0.03, max: 0.08, step: 0.005, u: 'N/m', d: 3, v: 0.07, h: 'assumed, water-like' },

  { g: 'Blade and bead', k: 'Pup', l: 'Bead pressure over the land', min: 0, max: 3, step: 0.02, u: 'kPa', d: 2, v: 0.72, h: 'set to give 1.45 mm at default' },
  { k: 'L', l: 'Land length', min: 3, max: 25, step: 0.5, u: 'mm', d: 1, v: 10, h: 'assumed' },
  { k: 'th', l: 'Contact angle on blade', min: 5, max: 120, step: 1, u: '°', d: 0, v: 35, h: 'assumed' },
  { k: 'face', l: 'Notch face length to corner', min: 2, max: 12, step: 0.5, u: 'mm', d: 1, v: 8, h: 'assumed, measure on the blade' },

  { g: 'Variation across the web', k: 'dH', l: 'Blade gap waviness (amplitude)', min: 0, max: 100, step: 1, u: 'µm', d: 0, v: 20 },
  { k: 'lw', l: 'Waviness wavelength', min: 20, max: 300, step: 5, u: 'mm', d: 0, v: 120 },
  { k: 'dt', l: 'Fibre thickness variation', min: 0, max: 60, step: 1, u: 'µm', d: 0, v: 10 },
  { k: 'dth', l: 'Wetting variation on blade', min: 0, max: 20, step: 0.5, u: '°', d: 1, v: 4, h: 'contamination, residue' },

  { g: 'Web edge and film', k: 'a0e', l: 'Edge irregularity at exit', min: 5, max: 200, step: 5, u: 'µm', d: 0, v: 30 },
  { k: 'lam', l: 'Ripple wavelength on film', min: 2, max: 40, step: 0.5, u: 'mm', d: 1, v: 8 },
  { k: 'vib', l: 'Vibration ripple on film', min: 0, max: 80, step: 1, u: 'µm', d: 0, v: 10 },
];

// Live parameter values, keyed the same as CFG[i].k. Populated with defaults
// now; ui.js overwrites individual keys as sliders move.
const P = {};
CFG.forEach(c => { P[c.k] = c.v; });

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const RHO = 1020;              // slurry density, kg/m³ (assumed, typical for an aqueous coating slurry)
const GRAVITY = 9.81;          // m/s²
const SIN45 = Math.SQRT1_2;    // sin(45°) = cos(45°) — the blade's notch face is drawn at 45° to the land

/** Fibre-side gap actually available to the slurry: machine height minus the web itself. */
const gapHeight = () => P.Hm - P.tf;

/**
 * Apparent (shear-rate-dependent) viscosity, Herschel–Bulkley-style:
 *   mu_eff(gd) = ty/gd + base * (gd/2.7)^(n-1)
 * "base" is picked so that at the reference shear rate (2.7 1/s, where the
 * viscosity slider is defined) mu_eff reproduces exactly P.mu:
 *   ty/2.7 + base = P.mu  =>  base = P.mu - ty/2.7
 * floored at 5% of P.mu so a large yield stress can't drive it negative.
 * gd is clamped away from 0 because the yield-stress term diverges there
 * (physically correct for a yield-stress fluid — apparent viscosity really
 * does go to infinity as shear rate goes to zero — but a literal 0 would
 * produce Infinity in JS arithmetic downstream).
 */
function muEff(gd) {
  gd = Math.max(gd, 1e-6);
  const ref = P.mu, ty = P.ty;
  const base = Math.max(ref - ty / 2.7, 0.05 * ref);
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
const capillaryLength = () => Math.sqrt(P.g / (RHO * GRAVITY)) * 1000;

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
 */
function edgeBead() {
  const H = gapHeight();
  const h = contactLine(H, P.th).h / 1000; // mm -> m
  const R = h / 2;                         // bead treated as a half-round ridge
  const gd = 0.1;                          // slow, near-static relaxation
  const mu = muEff(gd);
  const growthRate = P.g / (6 * mu * R);       // 1/s
  const wavelength = 9 * R * 1000;             // m -> mm
  const capillaryPressure = P.g / R;           // Pa, Laplace pressure of the ridge
  const arrested = capillaryPressure < P.ty;   // yield stress beats the driving pressure
  return { h, R, mu, sig: growthRate, lam: wavelength, pc: capillaryPressure, arrest: arrested };
}

/**
 * Dimensionless checks on whether the thin-film/lubrication assumptions
 * still hold for the current inputs. Used to gate the "model validity"
 * message shown throughout the UI — see updateScope() in ui.js.
 */
function modelScope() {
  const H = gapHeight() / 1000;
  const U = P.U / 60;
  const mu = muEff(U / H);
  const h = contactLine(gapHeight(), P.th).h / 1000;
  const Re = RHO * U * H / mu;          // inertia vs viscous forces
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
