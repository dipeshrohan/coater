/*
 * materials.js — the materials and the process chain (GO-0): the slurry's card (its GO solids, their density and
 * size, the liquid, the dry film's packing), the slurry density that follows from it, the oven's zones, and the mass
 * balance from the wet film under the blade to the dry film peeled off the fibre web.
 *
 * The line (the user's): the slurry is coated onto the PET fibre web, dried in the oven by the air blown up through the
 * web, then peeled off as a free-standing GO film. The fibre web is the carrier; its card is the 2D setup's Fibre.
 *
 * Every value on a card carries its unit, a source and a flag: 'given' (from the user), 'assumed' or 'measured'.
 * Loaded after physics.js (the slurry density, slurryRho, replaces its fixed one) and before cfd-ui.js.
 */

/** The slurry card's values: [key, label, unit, min, max, step, decimals, default, flag, source]. */
const MAT_SLURRY = [
  ['phi', 'Solids', 'vol%', 1, 74, 0.5, 1, 40, 'given', 'you: over 40 vol% solids (the exact fraction not given)'],
  ['rhoS', 'Solids density (GO)', 'g/cm³', 1, 3, 0.05, 2, 1.9, 'assumed', 'you: GO particles; GO 1.8–2.2 g/cm³ reported'],
  ['rhoL', 'Liquid density (water)', 'kg/m³', 900, 1100, 1, 0, 1000, 'assumed', 'water-based (you)'],
  ['dMean', 'Particle size, mean', 'µm', 0.1, 100, 0.1, 1, 5, 'given', 'you: 2–8 µm particles (the mean not given)'],
  ['dMin', 'Particle size, smallest', 'µm', 0.1, 100, 0.1, 1, 2, 'given', 'you: 2–8 µm'],
  ['dMax', 'Particle size, largest', 'µm', 0.1, 100, 0.1, 1, 8, 'given', 'you: 2–8 µm'],
  ['tFlake', 'Flake thickness', 'nm', 0.5, 1000, 0.5, 1, 1, 'assumed', 'a single GO sheet is about 1 nm'],
  ['co', 'C/O ratio', '', 1, 20, 0.1, 1, 2, 'assumed', 'typical for GO (about 2)'],
  ['phiDry', 'Dry film packing', 'fraction', 0.3, 1, 0.01, 2, 0.85, 'assumed', 'solids fraction of the dry film (stacked flakes)'],
];
const MAT_FLAGS = [['given', 'From you'], ['assumed', 'Assumed'], ['measured', 'Measured']];
const matDefaults = () => ({ slurry: Object.fromEntries(MAT_SLURRY.map(([k, , , , , , , v, flag, src]) => [k, { v, flag, src }])) });
let MAT = matDefaults();
/** A slurry card value (its number). */
const matV = k => MAT.slurry[k].v;

/** The slurry's density (kg/m³) from its solids: phi rho_solids + (1 - phi) rho_liquid. */
function slurryRho(m = MAT) {
  const f = m.slurry.phi.v / 100;
  return f * m.slurry.rhoS.v * 1000 + (1 - f) * m.slurry.rhoL.v;
}
/** The solids' mass fraction (0..1). */
const slurrySolidsMass = (m = MAT) => m.slurry.phi.v / 100 * m.slurry.rhoS.v * 1000 / slurryRho(m);

/**
 * The mass balance of a wet film h (m) on the web: what is left when its water is gone (the solids packed at the dry
 * film's packing) and what must leave. At the line speed U (m/s) over a width W (m): the water per second.
 * Returns { dry (m), coatDry, coatWet (g/m²), water (kg/m²), waterRate (kg/s), rhoDry (kg/m³) }.
 */
function massBalance(h, U, W, m = MAT) {
  const f = m.slurry.phi.v / 100, rS = m.slurry.rhoS.v * 1000, rL = m.slurry.rhoL.v, pd = m.slurry.phiDry.v;
  const water = h * (1 - f) * rL;
  return { dry: h * f / pd, coatDry: h * f * rS * 1000, coatWet: h * slurryRho(m) * 1000, water, waterRate: water * U * W, rhoDry: pd * rS };
}

// ---- the oven: zones in a row along the line, each with its own drying air ----
// (today's single setting -- air blown up through the fibre, 1 m/s, 100 C, over a 100 mm plenum -- is zone 1's; the
// other zones start as it; lengths along the line and the air's humidity are assumed)
const OVEN_ZONE_FIELDS = [['len', 'Length', 'm', 0.1, 100, 0.1, 1], ['airU', 'Air speed up into the fibre', 'm/s', 0, 50, 0.1, 1], ['airT', 'Air temperature', '°C', 0, 400, 5, 0],
  ['plenum', 'Plenum length', 'mm', 1, 5000, 10, 0], ['rh', 'Air humidity', '%', 0, 100, 1, 0]];
const OVEN_ZONE_DEFAULT = { len: 2, airU: 1, airT: 100, plenum: 100, rh: 20 };
const ovenDefaults = () => ({ zones: [0, 1, 2].map(() => ({ ...OVEN_ZONE_DEFAULT })) });
let OVEN = ovenDefaults();
const OVEN_MAX_ZONES = 8;
/** The oven's length (m) and the time the film spends in it at the line speed U (m/s). */
function ovenTime(U, oven = OVEN) {
  const len = oven.zones.reduce((a, z) => a + z.len, 0);
  return { len, t: U > 0 ? len / U : Infinity };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MAT_SLURRY, MAT_FLAGS, matDefaults, slurryRho, slurrySolidsMass, massBalance, OVEN_ZONE_FIELDS, OVEN_ZONE_DEFAULT, ovenDefaults, ovenTime };
