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
  ['phi', 'Solids', 'vol%', 0.01, 74, 0.01, 3, 0.889, 'given', 'the Mixing recipe (SOP 1.3, 100 L: 1.68 wt% GO)'],
  ['rhoS', 'Solids density (GO)', 'g/cm³', 1, 3, 0.05, 2, 1.9, 'assumed', 'you: GO particles; GO 1.8–2.2 g/cm³ reported'],
  ['rhoL', 'Liquid density (water)', 'kg/m³', 900, 1100, 1, 0, 1000, 'assumed', 'water-based (you)'],
  ['dMean', 'Particle size, mean', 'µm', 0.1, 100, 0.1, 1, 5, 'given', 'you: 2–8 µm particles (the mean not given)'],
  ['dMin', 'Particle size, smallest', 'µm', 0.1, 100, 0.1, 1, 2, 'given', 'you: 2–8 µm'],
  ['dMax', 'Particle size, largest', 'µm', 0.1, 100, 0.1, 1, 8, 'given', 'you: 2–8 µm'],
  ['tFlake', 'Flake thickness', 'nm', 0.5, 1000, 0.5, 1, 1, 'assumed', 'a single GO sheet is about 1 nm'],
  ['co', 'C/O ratio', '', 1, 20, 0.1, 1, 2, 'assumed', 'typical for GO (about 2)'],
  ['phiDry', 'Dry film packing', 'fraction', 0.3, 1, 0.01, 2, 0.85, 'assumed', 'solids fraction of the dry film (stacked flakes)'],
];
/**
 * How the slurry flows beyond the sidebar's inputs (GO-1), the same shape: the Carreau–Yasuda and Cross laws'
 * extras ('law') and the structure (thixotropy) model's values ('struct'; rheo.js). All assumed until fitted.
 */
const MAT_RHEO = [
  ['etaInf', 'Viscosity at high shear, η∞', 'Pa·s', 0, 5, 0.001, 3, 0.01, 'assumed', 'Carreau–Yasuda and Cross; at most half the viscosity at 2.7 1/s', 'law'],
  ['lamT', 'Time constant λ', 's', 0.001, 1000, 0.01, 3, 1, 'assumed', 'Carreau–Yasuda and Cross: 1 / the shear rate where the slurry starts to thin', 'law'],
  ['aCY', 'Transition sharpness a', '', 0.2, 5, 0.1, 1, 2, 'assumed', 'Carreau–Yasuda (2: the Carreau law)', 'law'],
  ['tb', 'Rebuild time at rest', 's', 0.1, 100000, 1, 1, 30, 'assumed', 'tens of seconds, typical of GO dispersions in published thixotropy tests', 'struct'],
  ['gdc', 'Shear rate that halves the structure', '1/s', 0.0001, 10000, 0.1, 3, 1, 'assumed', 'steady at this shear rate, half the structure is broken', 'struct'],
  ['cy', 'Yield stress gain when rested, c_y', '', 0, 50, 0.1, 2, 2, 'assumed', 'rested, the yield stress is (1 + c_y)× the fully broken one', 'struct'],
  ['ce', 'Viscosity gain when rested, c_η', '', 0, 50, 0.1, 2, 2, 'assumed', 'rested, the viscosity is (1 + c_η)× the fully broken one', 'struct'],
];
/**
 * The flakes' alignment (GO-2; orient.js, cfd-orient.js), the same shape: the liquid crystal's (Doi–Hess, 'dh') and
 * the suspension's (Folgar–Tucker, 'ft') values; the flakes' shape comes from the slurry card (size and thickness).
 * 'num': how finely it is computed (streamlines through the film, flakes on each).
 */
const MAT_ORIENT = [
  ['U', 'Ordering strength U', '', 0, 50, 0.1, 1, 8, 'assumed', 'above about 4.5 the flakes line up with each other (a liquid crystal); 8: at rest they order to S 0.84', 'dh'],
  ['Dr', 'Rotary diffusion D_r', '1/s', 0, 100, 0.001, 3, 0.025, 'assumed', 'a 5 µm flake turning in water by Brownian motion; slower when crowded', 'dh'],
  ['Ci', 'Interaction coefficient C_i', '', 0, 1, 0.001, 3, 0.01, 'assumed', 'the flow knocks flakes about at C_i × the shear rate; fibre and platelet suspensions 0.001–0.03', 'ft'],
  ['nLines', 'Streamlines through the film', '', 4, 96, 1, 0, 24, 'given', 'each carries an equal share of the flow', 'num'],
  ['nFlakes', 'Flakes on each streamline', '', 100, 16000, 100, 0, 1000, 'given', '1000: the film within 0.02 of 4000 (cfd-orient.validate.js)', 'num'],
];
/**
 * The drying (GO-3; drying.js), the same shape: how the flakes move against the water, the skin, heat, the water the
 * dry GO keeps (its sorption isotherm, GAB), the room between the blade and the oven. All assumed until measured.
 */
const MAT_DRY = [
  ['mul', 'Flakes\' collective diffusion, × the hard-sphere law', '', 0.001, 1e6, 0.1, 3, 1, 'assumed', 'Routh–Russel for hard spheres (Carnahan–Starling) with a thin disc\'s Brownian diffusion; flakes in a gel may move together faster: raise it'],
  ['skinK', 'Water vapour through the skin', '×10⁻¹² kg/(m·s·Pa)', 0.001, 1e6, 0.1, 3, 1, 'assumed', 'GO laminates pass water vapour at about 10⁻⁵ mm·g/(cm²·s·bar) (Nair et al., Science 2012)'],
  ['kS', 'GO\'s heat conductivity through the film', 'W/(m·K)', 0.01, 10, 0.01, 2, 0.2, 'assumed', 'GO paper through its thickness: 0.1–0.3 reported'],
  ['kIn', 'GO\'s heat conductivity along the film', 'W/(m·K)', 0.01, 100, 0.01, 2, 1, 'assumed', 'GO paper along itself: about 0.5–3 reported, several times through it (its flakes lie flat); the pressed stack\'s heat (MP-1)'],
  ['cS', 'GO\'s specific heat', 'J/(kg·K)', 100, 3000, 10, 0, 850, 'assumed', 'graphite 710; GO with its oxygen groups higher'],
  ['emis', 'Film emissivity', '', 0.01, 1, 0.01, 2, 0.95, 'assumed', 'water and GO: nearly black in the infrared; the oven\'s walls radiate at its air\'s temperature'],
  ['irAbs', 'IR absorbed by the film', 'fraction', 0, 1, 0.01, 2, 0.9, 'assumed', 'of the IR heaters\' power reaching the film'],
  ['gabXm', 'Water the dry GO keeps: GAB X_m', 'kg/kg', 0.001, 1, 0.005, 3, 0.07, 'assumed', 'its sorption isotherm; these give about 5 % water at 20 % humidity, 10 % at 50 %, 24 % at 90 % (typical of GO films)'],
  ['gabC', 'Water the dry GO keeps: GAB C', '', 0.1, 1000, 0.5, 1, 8, 'assumed', 'the same isotherm'],
  ['gabK', 'Water the dry GO keeps: GAB K', '', 0.1, 0.99, 0.01, 2, 0.8, 'assumed', 'the same isotherm'],
  ['cpWeb', 'Fibre web\'s specific heat', 'J/(kg·K)', 500, 3000, 10, 0, 1300, 'assumed', 'PET'],
  ['kFib', 'Fibre web\'s fibres: heat conductivity', 'W/(m·K)', 0.02, 5, 0.01, 2, 0.2, 'assumed', 'PET 0.15–0.24, polypropylene 0.1–0.22 W/(m·K); the web\'s own (its fibres in the air) follows by Maxwell–Eucken (the drying\'s multiphysics)'],
  ['Troom', 'Room temperature', '°C', 0, 60, 1, 0, 25, 'assumed', 'between the blade and the oven: the film enters the oven at it'],
  ['rhRoom', 'Room humidity', '%', 0, 100, 1, 0, 50, 'assumed', 'between the blade and the oven'],
];
/**
 * The dry film on the fibre web (GO-4; film.js), the same shape: the GO film's stiffness, strength and toughness,
 * how it swells with water and heat, its hold on the web; the web's stiffness and expansion; the wet film under a
 * skin; the curl a roll sets. All assumed until measured (the measured curl, cracks and peel force give some).
 */
const MAT_FILM = [
  ['Ep', 'Dry film\'s stiffness along it, E_p', 'GPa', 0.1, 200, 0.5, 1, 20, 'assumed', 'GO paper 32 GPa (Dikin et al., Nature 2007); 1–40 GPa reported for other preparations'],
  ['Et', 'Dry film\'s stiffness through it, E_t', 'GPa', 0.01, 100, 0.1, 2, 3, 'assumed', 'GO paper is far softer through its thickness: its layers held by water and oxygen groups'],
  ['Gpt', 'Shear between its layers, G', 'GPa', 0.01, 50, 0.1, 2, 1, 'assumed', 'the layers slide on each other'],
  ['nup', 'Poisson\'s ratio along it, ν_p', '', 0, 0.49, 0.01, 2, 0.2, 'assumed', 'graphene 0.17; GO paper about 0.2'],
  ['nupt', 'Poisson\'s ratio through it, ν_pt', '', 0, 0.49, 0.01, 2, 0.1, 'assumed', 'its thickness change under an in-plane stress'],
  ['Xh', 'Softer with water: its stiffness halves at', 'kg/kg', 0.01, 10, 0.01, 2, 0.15, 'assumed', 'GO paper softens as it takes up water'],
  ['beta', 'Swelling along it with its water, β', 'per kg/kg', 0, 1, 0.005, 3, 0.08, 'assumed', 'GO paper shrinks −67e-6/K from 25 to 150 °C as its water leaves (Su et al., Carbon 2012): about 0.08 per kg/kg with the isotherm on the Drying card'],
  ['alphaF', 'Its own heat expansion along it', '×10⁻⁶/K', -50, 100, 0.5, 1, 0, 'assumed', 'GO\'s own in-plane expansion is near zero (Su et al. 2012; the shrinkage is its water leaving)'],
  ['sigF', 'Dry film\'s strength', 'MPa', 1, 2000, 1, 0, 100, 'assumed', 'GO paper 120 MPa (Dikin et al. 2007); 4–120 MPa reported'],
  ['GcF', 'Its fracture energy (a crack through it)', 'J/m²', 0.1, 10000, 1, 1, 40, 'assumed', 'multilayer GO about 39 J/m² (J-integral); thicker films may be tougher: the crack spacing measured gives it'],
  ['Gil', 'Between its layers (it splits)', 'J/m²', 0.1, 10000, 1, 1, 20, 'assumed', 'GO paper splits between its layers more easily than across them'],
  ['Gi', 'Its hold on the fibre web', 'J/m²', 0.01, 10000, 0.5, 2, 10, 'assumed', 'not known: the peel force measured gives it'],
  ['setFrac', 'Curl the roll sets (of the roll\'s)', 'fraction', 0, 1, 0.01, 2, 0, 'assumed', 'GO paper is viscoelastic (Su et al. 2012): the curl measured after the roll gives it'],
  ['Ew', 'Fibre web\'s stiffness along it', 'GPa', 0.01, 50, 0.05, 2, 1, 'assumed', 'PET filament about 8 GPa (60–90 gf/den); about a quarter of a plain weave\'s fibres run along the line and their crimp lowers it'],
  ['soft', 'Fibre web through its thickness and in shear', '× along it', 0.001, 1, 0.01, 3, 0.1, 'assumed', 'a fabric: its yarns flatten and slide'],
  ['nuw', 'Fibre web\'s Poisson\'s ratio', '', 0, 0.49, 0.01, 2, 0.3, 'assumed', 'a typical polymer'],
  ['alphaW', 'Fibre web\'s heat expansion', '×10⁻⁶/K', -50, 300, 1, 0, 20, 'assumed', 'polyester fibre expands about 0.4 % from 25 to 230 °C'],
  ['Eg', 'Wet film under a skin: its stiffness', 'kPa', 0.01, 1e6, 1, 1, 100, 'assumed', 'a GO paste: soft (its yield stress a few pascals, the Rheology card)'],
  ['stackK', 'Water along the pieces in the pressed stack', '×10⁻⁷ kg/(m·s·Pa)', 1e-4, 1e6, 0.1, 3, 3, 'assumed', 'not measured: 3 is the least that fits your answers -- dry all over out of the pre heat treatment, the size back to as cut 1–2 h later, the same a day later'],
  ['creepTau', 'Its creep time wet (as cut), in the pre heat treatment', 'min', 0.1, 1e5, 1, 1, 10, 'assumed', 'GO paper creeps, the more so with water (Su et al. 2012); not known: the waves in your photos will give it'],
];
/**
 * The furnace (GO-5; furnace.js), the same shape plus its group: the GO's chemistry as it heats (each stage's share of
 * its oxygen, where it leaves heated at 10 °C/min, its spread, the gas it leaves as), its layers ordering into graphite,
 * the gas through the film and what holds its layers, the graphite paper. All assumed until measured (your measured
 * thickness and heat conduction give some).
 */
const MAT_FURN = [
  ['Tw', 'Its water leaves around', '°C at 10 °C/min', 40, 250, 1, 0, 100, 'assumed', 'the water a piece holds from the room', 'chem'],
  ['hc', 'Its hydrogen, H/C', 'per C', 0, 1, 0.01, 2, 0.3, 'assumed', 'GO about 0.2–0.4 H per C (its hydroxyl and carboxyl groups); its C/O is the slurry card\'s', 'chem'],
  ['s1', 'Labile oxygen (epoxide, hydroxyl)', 'share of its O', 0, 1, 0.01, 2, 0.6, 'assumed', 'most of GO\'s oxygen leaves at 150–300 °C: a sharp step of about a third of its weight', 'chem'],
  ['T1', '… leaves around', '°C at 10 °C/min', 100, 600, 1, 0, 210, 'assumed', 'GO\'s sharp step, 200–230 °C heated at 10 °C/min', 'chem'],
  ['w1', '… its spread', 'kJ/mol', 0, 100, 0.5, 1, 5, 'assumed', 'a sharp step: a few tens of degrees', 'chem'],
  ['c1CO2', '… out as CO₂', 'share', 0, 1, 0.01, 2, 0.3, 'assumed', 'GO heated gives off CO₂, CO and water; the rest as water, as far as its hydrogen goes (then CO)', 'chem'],
  ['c1CO', '… out as CO', 'share', 0, 1, 0.01, 2, 0.3, 'assumed', 'the same', 'chem'],
  ['s2', 'Stable oxygen (carbonyl, ether)', 'share of its O', 0, 1, 0.01, 2, 0.3, 'assumed', 'leaves slowly over 300–1000 °C: GO films reach C/O about 10–15 by 1000 °C', 'chem'],
  ['T2', '… leaves around', '°C at 10 °C/min', 200, 1500, 5, 0, 600, 'assumed', 'a broad loss', 'chem'],
  ['w2', '… its spread', 'kJ/mol', 0, 200, 1, 0, 40, 'assumed', 'broad: over 300–1000 °C', 'chem'],
  ['c2CO', '… out as CO', 'share', 0, 1, 0.01, 2, 0.7, 'assumed', 'the rest as CO₂', 'chem'],
  ['T3', 'The last oxygen and the hydrogen leave around', '°C at 10 °C/min', 800, 2800, 10, 0, 1500, 'assumed', 'the rest of its oxygen (as CO) and its hydrogen (as H₂) over 1000–2500 °C: C/O over 100 by 2000 °C', 'chem'],
  ['w3', '… its spread', 'kJ/mol', 0, 300, 1, 0, 80, 'assumed', 'broad', 'chem'],
  ['Tg', 'Its layers order into graphite around', '°C at 10 °C/min', 1500, 3300, 10, 0, 2650, 'assumed', 'GO films 1 h at 2800 °C: layer spacing about 3.36 Å, 93 % graphitized; these give it', 'graph'],
  ['wg', '… its spread', 'kJ/mol', 0, 300, 1, 0, 80, 'assumed', 'graphitizing goes on over 2000–2800 °C', 'graph'],
  ['dIn', 'Its layers\' spacing going in', 'nm', 0.4, 1.5, 0.01, 2, 0.8, 'assumed', 'GO 0.7–0.9 nm with a little water; 0.344 nm with its oxygen gone, graphite 0.3354 nm', 'graph'],
  ['La0', 'Crystallites before graphitizing, La', 'nm', 1, 1000, 1, 0, 10, 'assumed', 'reduced GO about 10 nm', 'graph'],
  ['La1', 'Crystallites graphitized, La', 'nm', 10, 10000, 10, 0, 1000, 'assumed', 'GO films at 2800–3000 °C: several hundred nm to a few µm', 'graph'],
  ['kG', 'Graphite\'s heat conduction along its layers', 'W/(m·K)', 100, 5000, 10, 0, 2000, 'assumed', 'perfect graphite (highly oriented pyrolytic) about 2000 W/(m·K)', 'graph'],
  ['ell', 'Crystallites\' size that halves it, ℓ', 'nm', 1, 10000, 10, 0, 250, 'assumed', 'their boundaries scatter the heat: × La / (La + ℓ); your measured heat conduction gives it', 'graph'],
  ['Dgal', 'Gas through its layers, open (GO)', '×10⁻¹⁰ m²/s', 0.001, 1e6, 0.1, 2, 5.6, 'assumed', 'not measured: the least that keeps the first run from puffing (Q101), with the programs as they came (your cycles may give another)', 'gas'],
  ['Dmin', '… through its defects, closed', '×10⁻¹³ m²/s', 0, 1e6, 0.1, 2, 1, 'assumed', 'the way left when its layers close up: small (it hardly changes the thickness)', 'gas'],
  ['es', 'Puffed: its gas way out doubles at', '× its thickness', 0.01, 100, 0.01, 2, 1.04, 'assumed', 'not measured: fits a 125 µm graphene film from a 90 µm GO piece (the middles of Q95 and Q99); your measured thickness gives it', 'gas'],
  ['sigZ', 'Its layers\' hold (their cohesion)', 'kPa', 1, 1e5, 10, 0, 200, 'assumed', 'the layers held by van der Waals: not known', 'gas'],
  ['rhoP', 'Graphite paper\'s density', 'g/cm³', 0.1, 2.3, 0.05, 2, 1, 'assumed', 'flexible graphite paper 0.7–1.3 g/cm³', 'paper'],
  ['Dp', 'Gas along the paper', '×10⁻⁶ m²/s', 0.0001, 1e6, 0.1, 2, 1, 'assumed', 'not known: under a light paper the gas lifts it and gets by anyway', 'paper'],
  ['Ez', 'Paper\'s stiffness through it', 'MPa', 0.1, 1e4, 1, 1, 10, 'assumed', 'flexible graphite gives easily through its thickness: with the holder\'s plates on the stack', 'paper'],
  ['bO', 'Shrinks along it, all its oxygen gone', '%', 0, 20, 0.1, 1, 3, 'assumed', 'reduced GO films shrink along themselves a few % as their oxygen leaves: your size after the furnace gives it', 'plane'],
  ['bG', '… as its layers order into graphite', '%', -5, 10, 0.1, 1, 0.5, 'assumed', 'a little more as it graphitizes; below 0, it grows', 'plane'],
  ['am', 'Its heat expansion along it, less the paper\'s', '×10⁻⁶/K', -10, 10, 0.1, 1, 0, 'assumed', 'both are graphite: about the same', 'plane'],
  ['mu', 'Friction on the graphite paper', '', 0, 2, 0.01, 2, 0.15, 'assumed', 'graphite on graphite about 0.1–0.2', 'plane'],
  ['Tst', 'It sticks to the paper from', '°C', 500, 3300, 10, 0, 2200, 'assumed', 'you find it stuck after the second run (Q112), all over (Q125): where between 1000 and 2800 °C is not known', 'plane'],
  ['pSt', '… where pressed at least', 'kPa', 0, 100000, 0.001, 3, 0, 'assumed', 'the waved top pieces come off free, the cracked bottom ones stuck (GO-7c): 0 sticks it wherever pressed; where in the stack yours stick (Measured) sets it', 'plane'],
  ['tauB', 'Its bond to the paper, stuck', 'MPa', 0.001, 100, 0.01, 3, 1, 'assumed', 'not known: when it is stuck and cracks, the cracks\' spacing gives it', 'plane'],
  // (the holder's plates, isostatic graphite (the user): the top and bottom pieces touch them directly, GO-7e)
  ['Bpl', 'Gas through the plate', '×10⁻⁶ m²/s', 0, 1e4, 0.1, 2, 2, 'assumed', 'isostatic graphites\' permeability coefficient (DIN 51935) 0.01–0.06 cm²/s, fine grains the least: 1–6; your plate\'s datasheet gives it', 'plate'],
  ['muPl', 'Friction on the plate', '', 0, 2, 0.01, 2, 0.15, 'assumed', 'graphite on graphite about 0.1–0.2, as on the paper', 'plate'],
  ['TstPl', 'It sticks to the plate from', '°C', 500, 3300, 10, 0, 2200, 'assumed', 'not known: as to the paper; where pressed at least the paper\'s pressure', 'plate'],
  ['tauPl', 'Its bond to the plate, stuck', 'MPa', 0.001, 100, 0.01, 3, 1, 'assumed', 'not known: as to the paper', 'plate'],
  // (the stack's heat, MP-2: the multiphysics solver takes each piece's temperature from the holder's heat-up, not the
  //  program's)
  ['Hr', 'GO\'s heat as its labile oxygen leaves', 'kJ/g', 0, 8, 0.05, 2, 1.6, 'assumed', 'DSC of GO: one exotherm from about 150 °C, 1.6 kJ/g (Qiu et al., Carbon 2014; reported 1–8, 1.4–1.7 the likeliest); your DSC gives it', 'heat'],
  ['kPin', 'Graphite paper\'s heat conduction along it', 'W/(m·K)', 1, 2000, 1, 0, 150, 'assumed', 'flexible graphite paper 140–500 along itself (the denser, the more); your paper\'s datasheet gives it', 'heat'],
  ['kPthr', '… through it', 'W/(m·K)', 0.1, 50, 0.1, 1, 5, 'assumed', 'flexible graphite paper 3–7 through its thickness', 'heat'],
  ['Rc', 'A piece\'s face on its paper: contact resistance', '×10⁻⁴ m²·K/W', 0, 100, 0.1, 1, 1, 'assumed', 'graphite lightly pressed on graphite 10⁻⁴–10⁻³: not known', 'heat'],
  ['kPl', 'The holder\'s plates: heat conduction', 'W/(m·K)', 1, 500, 1, 0, 100, 'assumed', 'isostatic graphite 80–130 at the room, less as it heats; the plates\' datasheet gives it', 'heat'],
  ['rhoPl', '… their density', 'g/cm³', 1, 2.3, 0.01, 2, 1.8, 'assumed', 'isostatic graphite 1.75–1.9', 'heat'],
  ['epsF', 'The holder\'s faces to the hot zone: emissivity', '', 0.05, 1, 0.01, 2, 0.8, 'assumed', 'graphite 0.7–0.9; the hot zone at the program\'s temperature', 'heat'],
];
/**
 * The material constants the solvers had fixed in their code (MH-2), the same shape: the pre heat's aluminium plate,
 * the holder's isostatic graphite plates' stiffness, the fibre web's and the wet film's Poisson's ratios. Their first
 * values are the solvers' own (stack-mp.js SMP_AL, furnace.js FU_EPL, film.js), so a project solves as before.
 */
const MAT_LIB = [
  ['alK', 'Aluminium plate: thermal conductivity', 'W/(m·K)', 20, 400, 1, 0, 200, 'assumed', 'aluminium alloys 150–235 W/(m·K) (pure 237); your plate\'s alloy gives it'],
  ['alRho', 'Aluminium plate: density', 'kg/m³', 2500, 2900, 5, 0, 2700, 'assumed', 'aluminium and its alloys 2640–2810 kg/m³'],
  ['alC', 'Aluminium plate: specific heat capacity', 'J/(kg·K)', 800, 1100, 5, 0, 900, 'assumed', 'aluminium 897 J/(kg·K) at 25 °C, rising about 10 % to 200 °C'],
  ['plE', 'Isostatic graphite plates: Young\'s modulus', 'GPa', 1, 40, 0.5, 1, 10, 'assumed', 'isostatic graphites 8–14 GPa; the plates\' datasheet gives it'],
  ['webNupt', 'Fibre web: Poisson\'s ratio, plane to thickness', '', 0, 0.49, 0.01, 2, 0.1, 'assumed', 'a fabric\'s thickness change under an in-plane stress: small'],
  ['gelNu', 'Wet GO film: Poisson\'s ratio', '', 0, 0.499, 0.005, 3, 0.45, 'assumed', 'a water-filled gel: nearly incompressible'],
  // (MC-1b: the fluids' constants the solvers had in their code -- drying.js DR_CL and drAir, stack-mp.js SMP_CW,
  //  furnace-mp.js FMP_CW and fmpArgon; their first values the solvers' own)
  ['waterCp', 'Water: specific heat capacity', 'J/(kg·K)', 3500, 4500, 1, 0, 4180, 'assumed', 'liquid water 4178–4216 J/(kg·K) from 20 to 100 °C'],
  ['airCp', 'Air: specific heat capacity', 'J/(kg·K)', 900, 1200, 1, 0, 1007, 'assumed', 'dry air near the room temperature'],
  ['arCp', 'Argon: specific heat capacity', 'J/(kg·K)', 400, 700, 0.1, 1, 520.3, 'assumed', 'a monatomic ideal gas: 5/2 R / M'],
  ['arPr', 'Argon: Prandtl number', '', 0.4, 1, 0.001, 4, 2 / 3, 'assumed', 'a monatomic gas (Eucken): Pr = ⅔'],
];
/**
 * The materials the spec names that no solver reads at present (MC-2): the GO paste the slurry is made from, the film
 * between the furnace's two runs (carbonized), the blade's material. No value until one is given (null), none made up.
 */
const MAT_XREC = [
  ['paRhoS', 'GO paste: solids content', 'wt%', 0, 100, 0.1, 1, null, 'assumed', ''],
  ['paRho', 'GO paste: density', 'kg/m³', 500, 3000, 1, 0, null, 'assumed', ''],
  ['paMu', 'GO paste: viscosity', 'Pa·s', 0.001, 1e6, 0.1, 2, null, 'assumed', ''],
  ['paTy', 'GO paste: yield stress', 'Pa', 0, 1e5, 0.1, 1, null, 'assumed', ''],
  ['paCp', 'GO paste: specific heat capacity', 'J/(kg·K)', 100, 6000, 10, 0, null, 'assumed', ''],
  ['paK', 'GO paste: thermal conductivity', 'W/(m·K)', 0.01, 10, 0.01, 2, null, 'assumed', ''],
  ['cfRho', 'Carbonized film: density', 'kg/m³', 100, 2300, 1, 0, null, 'assumed', ''],
  ['cfCp', 'Carbonized film: specific heat capacity', 'J/(kg·K)', 100, 3000, 10, 0, null, 'assumed', ''],
  ['cfKin', 'Carbonized film: thermal conductivity in the plane', 'W/(m·K)', 0.01, 3000, 0.1, 1, null, 'assumed', ''],
  ['cfKthr', 'Carbonized film: thermal conductivity through the thickness', 'W/(m·K)', 0.001, 100, 0.01, 2, null, 'assumed', ''],
  ['cfE', 'Carbonized film: Young\'s modulus in the plane', 'GPa', 0.01, 1000, 0.1, 1, null, 'assumed', ''],
  ['cfCO', 'Carbonized film: C/O ratio', '', 1, 1000, 0.1, 1, null, 'assumed', ''],
  ['blRho', 'Blade: density', 'kg/m³', 500, 20000, 1, 0, null, 'assumed', ''],
  ['blCp', 'Blade: specific heat capacity', 'J/(kg·K)', 100, 3000, 1, 0, null, 'assumed', ''],
  ['blK', 'Blade: thermal conductivity', 'W/(m·K)', 0.1, 500, 0.1, 1, null, 'assumed', ''],
  ['blE', 'Blade: Young\'s modulus', 'GPa', 0.1, 1000, 0.5, 1, null, 'assumed', ''],
  ['blNu', 'Blade: Poisson\'s ratio', '', 0, 0.5, 0.01, 2, null, 'assumed', ''],
  ['blAlpha', 'Blade: thermal expansion', '×10⁻⁶/K', -10, 100, 0.1, 1, null, 'assumed', ''],
];
const MAT_FURN_GROUPS = { chem: 'The GO\'s chemistry as it heats', graph: 'Its layers: graphite', gas: 'The gas and the puffing', paper: 'The graphite paper', plane: 'Along the piece: its size, cracks and sticking', plate: 'The holder\'s plates (isostatic graphite)' , heat: 'The stack\'s heat (the multiphysics)' };
const MAT_FLAGS = [['given', 'From you'], ['assumed', 'Assumed'], ['measured', 'Measured']];
const matCard = rows => Object.fromEntries(rows.map(([k, , , , , , , v, flag, src]) => [k, { v, flag, src }]));
// (rheo.side: the sidebar's slurry inputs a rheometer fit set, { k: { v, src } }: Measured while the input keeps that value;
// tests: the rheometer tests imported, rheo-ui.js)
// (orient: the flakes' alignment card, on or off, its model 'dh' (Doi–Hess, the default: Q49) or 'ft' (Folgar–Tucker);
// sem: the measured alignment -- SEM images and tables of flake angles, orient-ui.js;
// dry: the drying card; dryMeas: the drying measured -- temperatures in the oven and values at its exit, drying-ui.js;
// film: the dry film's card; filmMeas: the film measured -- its curl, its cracks, the peel force, film-ui.js;
// mixLink: the slurry's solids follow the Mixing recipe (the mixed slurry goes straight to the coater) -- off, typed here;
// furn: the furnace's card; furnMeas: the graphene film measured -- its thickness, weight and heat conduction, furnace-ui.js;
// prov: the provenance of the inputs bar's material values, { 'in.k': { kind, src } }, the material hub's (MH-5): a card value keeps
// its own in its entry, as prov beside its flag)
const matDefaults = () => ({ slurry: matCard(MAT_SLURRY), rheo: { ...matCard(MAT_RHEO), structOn: true, side: {} }, tests: [],
  orient: { ...matCard(MAT_ORIENT), on: true, model: 'dh' }, sem: { images: [], tables: [] }, dry: matCard(MAT_DRY), dryMeas: { temps: [], exit: [] },
  film: matCard(MAT_FILM), filmMeas: { curl: [], cracks: [], peel: [], size: [] }, furn: matCard(MAT_FURN), furnMeas: { out: [] }, prov: {}, lib: matCard(MAT_LIB), meta: {}, law: {}, inst: {}, assign: {}, xrec: matCard(MAT_XREC), mixLink: true });
let MAT = matDefaults();
/** The slurry's solids as written (vol%): three significant figures (0.889, 40). */
const matPhiTxt = (m = MAT) => String(+(+m.slurry.phi.v).toPrecision(3));
/** A slurry card value (its number). */
const matV = k => MAT.slurry[k].v;
/** A rheology value (its number). */
const matR = k => MAT.rheo[k].v;
/** The structure model's values for rheo.js, or null when it is off. */
const matStruct = (m = MAT) => m.rheo.structOn ? { tb: m.rheo.tb.v, gdc: m.rheo.gdc.v, cy: m.rheo.cy.v, ce: m.rheo.ce.v } : null;

/** The flakes' thickness / width (the slurry card's thickness over its mean size). */
const matFlakeRatio = (m = MAT) => m.slurry.tFlake.v * 1e-9 / (m.slurry.dMean.v * 1e-6);
/**
 * The alignment's model for the 2D (cfd-orient.js), or null when it is off: { model: orient.js's model (kind, the
 * shape factor β = (r² − 1) / (r² + 1) of r = thickness / width, and its values), nLines, n, seed }.
 */
function matOrient(m = MAT) {
  const o = m.orient;
  if (!o || !o.on) return null;
  const r = matFlakeRatio(m), beta = (r * r - 1) / (r * r + 1);
  const model = o.model === 'ft' ? { kind: 'ft', beta, Ci: o.Ci.v } : { kind: 'dh', beta, Dr: o.Dr.v, U: o.U.v };
  // (collapse: the dried film over the wet one, φ0 / φ_m -- the flakes flattened as it dries, GO-3; none if the packing
  // is below the solids)
  const col = m.slurry.phi.v / 100 / m.slurry.phiDry.v;
  return { model, nLines: Math.round(o.nLines.v), n: Math.round(o.nFlakes.v), seed: 1, ...(col < 1 ? { collapse: +col.toFixed(6) } : {}) };
}

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
// what is above the film in each zone (Q52: every option): nothing blown (the oven's still air), hot air blown on the
// top through slot nozzles, IR heaters, or air and IR; the jets' and the IR's values (assumed)
const OVEN_TOPS = { none: 'Nothing blown (the oven\'s still air)', air: 'Hot air blown on top (slot nozzles)', ir: 'IR heaters', 'air+ir': 'Hot air on top and IR' };
const OVEN_TOP_FIELDS = [['jetU', 'Jet speed at the nozzles', 'm/s', 0.5, 150, 0.5, 1, 'air'], ['jetT', 'Jet air temperature', '°C', 0, 400, 5, 0, 'air'],
  ['jetB', 'Slot width', 'mm', 0.5, 50, 0.5, 1, 'air'], ['jetH', 'Nozzles above the film', 'mm', 1, 500, 1, 0, 'air'], ['jetS', 'Slot pitch along the line', 'mm', 5, 1000, 5, 0, 'air'],
  ['ir', 'IR power reaching the film', 'kW/m²', 0, 200, 0.5, 1, 'ir']];
const OVEN_ZONE_DEFAULT = { len: 2, airU: 1, airT: 100, plenum: 100, rh: 20, top: 'none', jetU: 10, jetT: 100, jetB: 5, jetH: 20, jetS: 100, ir: 5 };
// (peel: after the oven the film runs through the room to where it is peeled (Q63: a stretch, its length yours) and is
// wound on the winder's core (Q61: not known, 76 mm assumed); lenSet / coreSet: set by you, else assumed)
// (pieceL / pieceW: the pieces cut from the roll later, GO-4d -- Q65: 30 × 30 cm, from you; Q70: cut from the roll; dryT: the
// the pre heat treatment oven the pieces are stacked in -- Q72: about 100 °C, from you; Q73/Q74: 1–2 h, pressed)
// (tOven: the pieces' time in the pre heat treatment -- Q73: 1–2 h, 1.5 from you; tRest: under the plate after it, in the room,
// until they are taken out to be looked at and measured -- Q84/Q85: 1–2 h, 1.5 from you; GO-4f)
// (MP-1, the stack's heat: plateT -- the aluminium plate's thickness, Q78's 1 kPa over the pieces as a plate their size
// (1000 / (2700 × 9.81) m); stackAirU -- the oven's air along the stack, 0: still air (natural convection); epsPl -- the
// plate's emissivity (bare aluminium 0.04–0.1); shelf -- what the stack stands on in the oven: 'wire' (the air and the walls
// below it) or 'solid' (a shelf at the oven's temperature); all assumed until you say)
const OVEN_PEEL_DEFAULT = { len: 2, core: 76, lenSet: false, coreSet: false, pieceL: 300, pieceW: 300, pieceSet: true, dryT: 100, drySet: true, tOven: 1.5, tRest: 1.5, stackSet: true,
  plateT: 37.8, plateSet: false, stackAirU: 0, stackAirSet: false, epsPl: 0.09, epsPlSet: false, shelf: 'wire', shelfSet: false };
const OVEN_SHELVES = { wire: 'A wire shelf', solid: 'A solid shelf' };
const OVEN_PEEL_FIELDS = [['len', 'Oven\'s exit to the peel', 'm', 0, 100, 0.1, 2, 'lenSet'], ['core', 'Winder\'s core diameter', 'mm', 10, 1000, 1, 0, 'coreSet'],
  ['pieceL', 'Piece\'s length (along the line)', 'mm', 10, 2000, 1, 0, 'pieceSet'], ['pieceW', 'Piece\'s width', 'mm', 10, 2000, 1, 0, 'pieceSet'],
  ['dryT', 'Pre heat treatment oven', '°C', 20, 300, 1, 0, 'drySet'], ['tOven', 'Time in the pre heat treatment', 'h', 0.05, 48, 0.1, 2, 'stackSet'],
  ['tRest', 'Under the plate after, until taken out', 'h', 0, 72, 0.1, 2, 'stackSet'],
  ['plateT', 'Aluminium plate\'s thickness', 'mm', 1, 200, 0.5, 1, 'plateSet'], ['stackAirU', 'Oven\'s air along the stack (0: still)', 'm/s', 0, 20, 0.1, 1, 'stackAirSet'],
  ['epsPl', 'Plate\'s emissivity', '', 0.02, 1, 0.01, 2, 'epsPlSet']];
// (furn: the furnace, GO-5 -- Q87: two runs, to about 1000 °C then to 2800 °C, in argon (Q91); each a program of steps
// (heat at a rate to a temperature, hold) and its cooling, or a cycle from your file (Q97: yours to come; these assumed,
// 12–48 h a run, Q88); Q89: one piece between two graphite papers, bigger than it (Q104: by how much not known), 0.3–1 mm
// thick (Q105); Q103: the pieces in a stack depend on the product (20 assumed, as the drying stack); the graphite holder
// snug (Q106/Q107) with a gap above the stack or its plates on it, by the product (Q108))
const FURN_RUNS_DEFAULT = [
  { steps: [{ rate: 1, to: 300, hold: 0 }, { rate: 3, to: 1000, hold: 60 }], cool: 5, file: null },
  { steps: [{ rate: 10, to: 1000, hold: 0 }, { rate: 5, to: 2000, hold: 0 }, { rate: 2, to: 2800, hold: 60 }], cool: 10, file: null },
];
// (GO-7e: the top and bottom pieces touch the holder's plates directly (the user), their thickness assumed)
const FURN_DEFAULT = { N: 200, paperT: 0.5, margin: 20, room: 'gap', gap: 50, plateW: 7, plateT: 30, sdMax: 30, dTload: null, ends: 'plates', runsSet: false, nSet: false, paperSet: true, marginSet: false, roomSet: false, plateSet: false, plateTSet: false, sdSet: true, dTSet: false, endsSet: true };
const FURN_FIELDS = [['N', 'Pieces in a stack', '', 1, 1000, 1, 0, 'nSet'], ['paperT', 'Graphite paper\'s thickness', 'mm', 0.01, 10, 0.05, 2, 'paperSet'],
  ['margin', 'Paper bigger than the piece, each side', 'mm', 0, 500, 1, 0, 'marginSet'], ['gap', 'Gap above the stack', 'mm', 0, 1000, 1, 0, 'roomSet'],
  ['plateW', 'A plate resting on the stack', 'kg', 0, 1000, 0.5, 1, 'plateSet'], ['sdMax', 'Its thickness may spread (standard deviation)', 'µm', 0.1, 1000, 1, 1, 'sdSet'],
  // (GO-7e: the holder's plates' thickness, the gas's way through them)
  ['plateT', 'The holder\'s plates\' thickness', 'mm', 1, 500, 1, 0, 'plateTSet'],
  // (GO-7: the load's temperature spread, its hottest stack less its coldest: not known until you give it -- empty, not assumed)
  ['dTload', 'The load\'s temperature spread (its hottest stack less its coldest)', '°C', 0, 1000, 5, 0, 'dTSet']];
const FURN_STEP_LIMITS = { rate: [0.01, 100], to: [0, 3300], hold: [0, 100000], cool: [0.01, 100] };
const furnDefaults = () => ({ ...FURN_DEFAULT, runs: JSON.parse(JSON.stringify(FURN_RUNS_DEFAULT)) });
// (mp: the stages' multiphysics mesh and time settings as set on their Mesh steps, MP-W -- { stage: { dim: { k: v } } };
//  none set: each solve's defaults)
// (mix: the mixer's inputs and program, MIX-1 -- mixer.js's, in the units its page shows; none where mixer.js is not loaded)
const ovenDefaults = () => ({ zones: [0, 1, 2].map(() => ({ ...OVEN_ZONE_DEFAULT })), peel: { ...OVEN_PEEL_DEFAULT }, furn: furnDefaults(), mp: {}, mix: typeof mixInDefaults === 'function' ? mixInDefaults() : null });
let OVEN = ovenDefaults();
const OVEN_MAX_ZONES = 8;
/** The oven's length (m) and the time the film spends in it at the line speed U (m/s). */
function ovenTime(U, oven = OVEN) {
  const len = oven.zones.reduce((a, z) => a + z.len, 0);
  return { len, t: U > 0 ? len / U : Infinity };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MAT_XREC, MAT_FURN, MAT_FURN_GROUPS, FURN_RUNS_DEFAULT, FURN_DEFAULT, FURN_FIELDS, FURN_STEP_LIMITS, furnDefaults, MAT_FILM, OVEN_PEEL_DEFAULT, OVEN_PEEL_FIELDS, OVEN_SHELVES, MAT_DRY, OVEN_TOPS, OVEN_TOP_FIELDS, MAT_SLURRY, MAT_RHEO, MAT_ORIENT, MAT_FLAGS, matDefaults, matPhiTxt, matStruct, matOrient, matFlakeRatio, slurryRho, slurrySolidsMass, massBalance, OVEN_ZONE_FIELDS, OVEN_ZONE_DEFAULT, ovenDefaults, ovenTime };
