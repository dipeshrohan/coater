/*
 * materials.validate.js — checks of the materials and the process chain (materials.js). Run: node materials.validate.js
 *  1. The slurry's density from its solids: 1360 kg/m³ at the defaults (40 vol% GO of 1.9 g/cm³ in water); the
 *     liquid's at no solids, the solids' at all solids; linear in between. The solids' mass fraction.
 *  2. The mass balance: nothing lost (wet = solids + water), the dry film's thickness times its density = the dry coat
 *     weight, the numbers for a 100 µm wet film worked by hand, the water per second at a line speed over a width.
 *  3. The oven: 3 zones of 2 m by default, zone 1 the single setting the app had (1 m/s, 100 °C, 100 mm); its length
 *     and the time in it; no speed: never out.
 *  4. The cards: every default inside its own range, flagged and sourced; the defaults fresh copies each time.
 */
const M = require('./materials.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const close = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
const withV = (vals, m = M.matDefaults()) => { for (const k in vals) m.slurry[k].v = vals[k]; return m; };

// 1. density
{
  const d = M.matDefaults();
  check('density at the defaults: 0.4 × 1900 + 0.6 × 1000 = 1360 kg/m³', close(M.slurryRho(d), 1360), M.slurryRho(d));
  check('  no solids: the liquid\'s; all solids: the solids\'', close(M.slurryRho(withV({ phi: 0 })), 1000) && close(M.slurryRho(withV({ phi: 100 })), 1900));
  const r = [10, 20, 30].map(phi => M.slurryRho(withV({ phi })));
  check('  linear in the solids fraction', close(r[1] - r[0], r[2] - r[1]) && close(r[1] - r[0], 0.1 * (1900 - 1000)), r.join(', '));
  check('  the liquid\'s density counts: 998 kg/m³ water', close(M.slurryRho(withV({ rhoL: 998 })), 0.4 * 1900 + 0.6 * 998));
  check('solids by mass at the defaults: 760 / 1360', close(M.slurrySolidsMass(d), 760 / 1360), (M.slurrySolidsMass(d) * 100).toFixed(2) + ' %');
}

// 2. mass balance
{
  const d = M.matDefaults(), h = 100e-6, U = 1 / 60, W = 0.3, b = M.massBalance(h, U, W, d);
  check('nothing lost: wet coat weight = dry coat weight + water', close(b.coatWet, b.coatDry + b.water * 1000), `${b.coatWet} = ${b.coatDry} + ${b.water * 1000} g/m²`);
  check('dry film thickness × its density = the dry coat weight', close(b.dry * b.rhoDry * 1000, b.coatDry));
  check('100 µm wet at 40 vol%, packed at 0.85: dry film 47.06 µm', close(b.dry, 100e-6 * 0.4 / 0.85), (b.dry * 1e6).toFixed(2) + ' µm');
  check('  coat weight 76 g/m² dry, 136 g/m² wet; water 60 g/m²', close(b.coatDry, 76) && close(b.coatWet, 136) && close(b.water, 0.06));
  check('  dry film density 0.85 × 1900 = 1615 kg/m³', close(b.rhoDry, 1615));
  check('  water to take out at 1 m/min over 300 mm: 0.06 × (1/60) × 0.3 = 0.3 g/s', close(b.waterRate, 3e-4), (b.waterRate * 1000).toFixed(3) + ' g/s');
  const b2 = M.massBalance(2 * h, 2 * U, W, d);
  check('  twice the film: twice everything; twice the speed too: four times the water per second', close(b2.dry, 2 * b.dry) && close(b2.coatDry, 2 * b.coatDry) && close(b2.waterRate, 4 * b.waterRate));
  const tight = M.massBalance(h, U, W, withV({ phiDry: 1 }));
  check('  packed solid (1.0): the dry film is the solids\' own volume', close(tight.dry, 40e-6) && close(tight.rhoDry, 1900));
}

// 3. the oven
{
  const o = M.ovenDefaults();
  check('oven: 3 zones of 2 m by default', o.zones.length === 3 && o.zones.every(z => z.len === 2));
  check('  zone 1 = the single setting the app had: 1 m/s up into the fibre, 100 °C, plenum 100 mm; humidity 20 %',
    o.zones[0].airU === 1 && o.zones[0].airT === 100 && o.zones[0].plenum === 100 && o.zones[0].rh === 20);
  check('  the other zones start as zone 1', o.zones.every(z => JSON.stringify(z) === JSON.stringify(o.zones[0])));
  const t = M.ovenTime(0.1, o);
  check('  6 m long; 60 s at 0.1 m/s', close(t.len, 6) && close(t.t, 60), `${t.len} m, ${t.t} s`);
  o.zones[1].len = 3.5;
  check('  a longer zone counts: 7.5 m', close(M.ovenTime(1, o).len, 7.5));
  check('  no line speed: never out', M.ovenTime(0, o).t === Infinity);
}

// 4. the cards
{
  const d = M.matDefaults(), flags = M.MAT_FLAGS.map(f => f[0]);
  const bad = M.MAT_SLURRY.filter(([k, , , lo, hi]) => !(d.slurry[k].v >= lo && d.slurry[k].v <= hi)).map(q => q[0]);
  check('every slurry default inside its range', !bad.length, bad.join(', '));
  check('  each flagged (from you / assumed / measured) with its source', M.MAT_SLURRY.every(([k]) => flags.includes(d.slurry[k].flag) && d.slurry[k].src));
  check('  what you gave flagged as yours: solids fraction, particle sizes; GO density assumed',
    ['phi', 'dMean', 'dMin', 'dMax'].every(k => d.slurry[k].flag === 'given') && d.slurry.rhoS.flag === 'assumed' && d.slurry.rhoS.v === 1.9);
  check('  the particle sizes in order: smallest ≤ mean ≤ largest', d.slurry.dMin.v <= d.slurry.dMean.v && d.slurry.dMean.v <= d.slurry.dMax.v);
  const zbad = M.OVEN_ZONE_FIELDS.filter(([k, , , lo, hi]) => !(M.OVEN_ZONE_DEFAULT[k] >= lo && M.OVEN_ZONE_DEFAULT[k] <= hi)).map(q => q[0]);
  check('every oven zone default inside its range', !zbad.length && M.OVEN_ZONE_FIELDS.every(([k]) => k in M.OVEN_ZONE_DEFAULT), zbad.join(', '));
  const a = M.matDefaults(), b = M.matDefaults(), o1 = M.ovenDefaults(), o2 = M.ovenDefaults();
  a.slurry.phi.v = 50; o1.zones[0].airT = 150;
  check('  defaults are fresh copies (a change to one leaves the next alone; the zones apart too)', b.slurry.phi.v === 40 && o2.zones[0].airT === 100 && o1.zones[1].airT === 100);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
