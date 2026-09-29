'use strict';
/*
 * Help cards: a short themed card for the inputs, the toolbar controls, the result names and the
 * DOE -- what it is, its range and source, what raising it does, and which modules use it.
 * Shown on hover (after a moment) and on keyboard focus; the model tree's inputs also have an (i)
 * button for touch. Cards are attached after each render (applyHelp), by id or by label.
 */

// ---- the texts: t title, d meaning, r range / source (the sidebar's come from CFG), e effect, u used by ----
const ALL_MODULES = 'all modules, the DOE';
const HELP = {
  // process
  'in.U': { d: 'Speed of the web (fibre) under the blade. It drags the slurry through the metering gap.', e: 'Faster: the film (Q/U) gets thinner when the bead pressure drives part of the flow, the capillary number rises, and in the CFD the contact line sits lower on the exit face.', u: ALL_MODULES },
  'in.Hm': { d: 'Height of the scraper blade\'s metering edge above the web support. The gap at the edge is this height less the fibre thickness.', e: 'Higher: a wider gap and a thicker wet film.', u: ALL_MODULES },
  'in.tf': { d: 'Thickness of the fibre (web) under the blade. It takes up part of the scraper height, and sets the fibre\'s porosity with its basis weight.', e: 'Thicker: a narrower gap and a thinner film; a more open fibre if the basis weight stays the same.', u: 'all modules, CFD fibre results, the DOE' },
  'in.oven': { d: 'Distance from the blade to the drying oven: the time the wet film has to level before it is fixed.', e: 'Longer: more time for surface tension to level ripples (unless the yield stress stops it), and the edge disturbances grow further.', u: 'Web edge, Film surface, CFD (film up to the oven)' },
  // slurry
  'in.mu': { d: 'Apparent viscosity measured at a shear rate of 2.7 1/s: the reference point of the rheology law.', e: 'Higher: less pressure-driven flow (a thinner film when the bead pressure matters), slower levelling, a higher capillary number.', u: ALL_MODULES },
  'in.n': { d: 'Shear-thinning index of the power law part: 1 = Newtonian, below 1 the viscosity falls as the shear rate rises.', e: 'Lower: the slurry thins more in the high-shear gap, so the gap flow sees a lower viscosity than at 2.7 1/s.', u: 'Contact line, Film surface, CFD (Power law, Herschel–Bulkley), the DOE' },
  'in.ty': { d: 'Stress below which the slurry does not flow (Herschel–Bulkley yield stress). Assumed, not measured.', e: 'Higher: larger unyielded (plug) regions, levelling stops at a residual ripple; very high values slow or stop the CFD solver.', u: 'Contact line, Film surface, CFD (Herschel–Bulkley), the DOE' },
  'in.g': { d: 'Surface tension of the slurry against air. Assumed, water-like.', e: 'Higher: faster levelling, a stronger pull of the meniscus, a lower capillary number.', u: 'Contact line, Web edge, Film surface, CFD, the DOE' },
  // blade and bead
  'in.Pup': { d: 'Gauge pressure of the slurry bead upstream of the blade, pushing it into the gap. Set to give a 1.45 mm film at the defaults.', e: 'Higher: more flow through the gap, a thicker film, the contact line climbs higher.', u: 'Start-up, Contact line, CFD, the DOE' },
  'in.L': { d: 'Length of the flat land under the blade: the flat-land shape\'s land, the metering land of a bevel, an edge radius or a two-step, a wedge\'s length.', e: 'Longer: more resistance to the pressure-driven flow, a thinner film at a given bead pressure.', u: 'Start-up, Contact line, CFD (every shape but the round entry and custom), the DOE' },
  'in.th': { d: 'Contact angle of the slurry on the blade\'s exit face (wetting). Assumed.', e: 'Smaller (better wetting): the meniscus climbs further up the exit face, toward the notch corner.', u: 'Start-up, Contact line, CFD, the DOE' },
  'in.thw': { d: 'Contact angle of the slurry on the bare web, where its side meets the web at an open edge (the 3D\'s Edge region, and the full width with its edges open). It sets the angle where the slurry first touches the web; the web carries its contact line on from there. Assumed.', e: 'Smaller (better wetting): the slurry spreads further out on the web past the blade\'s end, the edge flatter.', u: 'Flow › 3D (open edges)' },
  'in.face': { d: 'Length of the blade\'s exit face from the metering edge up to the notch corner. Measure it on the blade.', e: 'Shorter: the contact line reaches the corner, and the slurry the dry edge, sooner.', u: 'Start-up, Contact line' },
  // across the web
  'in.dH': { d: 'Amplitude of the sinusoidal variation of the gap along the blade (blade straightness, deflection).', e: 'Larger: the local gap, film and contact line vary more across the web.', u: 'Start-up, Contact line, CFD (the locations\' gaps)' },
  'in.lw': { d: 'Wavelength of that gap variation along the blade.', e: 'Sets where across the web the gap is widest and narrowest.', u: 'Start-up, Contact line, CFD (the locations\' gaps)' },
  'in.skew': { d: 'The blade not square to the web\'s travel: the metering edge at this angle to the cross direction, in the web\'s plane (+: its end at z = 300 mm further downstream).', e: 'The pressure under the blade pushes the slurry at right angles to the blade, not along the web\'s travel, so part of it moves across the web (Flow › 3D: the Cross-web speed field and the streamlines). The 1D and 2D see the web crossing the blade at its speed x cos(skew).', u: '1D, CFD (2D), 3D' },
  'in.tilt': { d: 'The blade not parallel to the web in height: the gap difference from one web edge (z = 0) to the other (z = 300 mm), centred, so the middle of the web keeps the machine\'s gap; + is a wider gap at z = 300 mm.', e: 'The local gap, film and contact line change steadily across the web, and the difference drives some slurry across it (Flow › 3D).', u: 'Start-up, Contact line, 1D, CFD (the locations\' gaps), 3D' },
  'in.dt': { d: 'Random variation of the fibre thickness across the web.', e: 'Larger: the local gap varies more, adding irregular streaks.', u: 'Start-up, Contact line, CFD (the locations\' gaps)' },
  'in.dth': { d: 'Variation of the contact angle along the blade, e.g. from contamination or dried residue.', e: 'Larger: the contact line climbs unevenly, and reaches the corner first where wetting is best.', u: 'Start-up, Contact line, CFD (the locations\' contact angles)' },
  // web edge and film
  'in.a0e': { d: 'Size of the irregularity of the film edge as it leaves the blade.', e: 'Larger: the edge disturbance (Rayleigh–Plateau type growth) reaches a visible size sooner.', u: 'Web edge' },
  'in.lam': { d: 'Wavelength of the ripple left on the film surface.', e: 'Longer: much slower levelling (the rate falls with the fourth power of the wavenumber).', u: 'Film surface' },
  'in.vib': { d: 'Amplitude of the ripple from blade or web vibration.', e: 'Larger: a larger starting ripple to level before the oven.', u: 'Film surface' },
  // CFD: blade geometry
  'cfd.shape': { t: 'Blade shape', d: 'Shape of the blade: a round entry (a radius) or a flat land ahead of the metering edge; a bevel or an edge radius between the land and the exit face; a wedge; a two-step land; or a custom profile from points, a DXF drawing or a section of a 3D blade.', e: 'The underside changes how the pressure builds up in the gap; a shaped exit (bevel, edge radius, custom) changes where the contact line can sit.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.bevelDeg': { t: 'Bevel angle to the web', d: 'The chamfer between the land and the exit face, degrees from the web.', e: 'The contact line can sit on the bevel only where the contact angle plus this angle is between 94° and 175°; otherwise it runs up to the bevel\'s top corner or stays at the land\'s end.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.bevelLen': { t: 'Bevel length', d: 'The chamfer\'s length along it, from the land\'s end to its top corner (C).', e: 'A longer bevel lifts C: a contact line pinned there leaves a different meniscus.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.edgeR': { t: 'Edge radius', d: 'The metering edge rounded with this radius into the exit face.', e: 'No corner: the contact line settles somewhere on the curve (it has no pinned state there).', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.inletGap': { t: 'Inlet gap', d: 'The wedge\'s gap at its inlet (absolute), falling straight to the gap at the metering edge over the length.', e: 'A wider inlet: a converging gap that builds more pressure, a thicker film.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.land1': { t: 'Land 1 length', d: 'The two-step blade\'s first land, at the gap plus the step height, before the step down to the metering land.', e: 'Longer: more of the gap at the larger height, less resistance upstream.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.stepH': { t: 'Step height', d: 'How much higher the first land is than the metering land.', e: 'A bigger step: less resistance on land 1, a corner eddy at the step.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.riserDeg': { t: 'Riser angle to the web', d: 'The step\'s riser, degrees from the web; 90° is a vertical step (meshed with a fan of elements).', e: 'Steeper: a sharper corner and a stronger eddy in it.', u: 'CFD, 1D, 3D, the DOE' },
  'cfd.clModel': { t: 'Contact line model', d: 'Full: the face is a curve of pieces; the contact line can be pinned at any corner (while the surface\'s angle lies between the contact angles either side, Gibbs\' condition) or sit anywhere on a piece at its contact angle. Simple: the face up to C (the bevel\'s or radius\'s top, a custom profile\'s C) always wetted; the contact line pinned at C or climbing the exit face above it.', e: 'Where the liquid does not wet the bevel, the full model lets the film leave the land early; the simple model keeps it wetted.', u: 'CFD, 3D' },
  'acr.bow': { t: 'Bow', d: 'The blade\'s sag or lift across the web, zero at its two ends. Computed: the blade as a beam on its ends (simply supported or clamped), its section (height x thickness, or its second moment of area) and modulus, loaded by the slurry\'s pressure under it (the 1D at 13 positions) and its own weight, solved again with the gap it makes until it settles. Typed: its amount at the middle (+ the gap larger) and shape (parabola, circular arc, cosine).', e: 'A bow changes the gap in the middle against the edges: the film is thicker where the gap is larger.', u: 'Everything across the web: 1D, the 2D locations\' gaps, 3D, Results' },
  'acr.crest': { t: 'Waviness crest', d: 'Where the waviness\'s first crest is, mm from the left edge. Empty: a quarter wavelength in, as it always was.', e: 'Moves the waviness along the web: which positions get the larger gap.', u: 'Everything across the web' },
  'acr.sines': { t: 'More sines', d: 'Further sines added to the waviness: each its amplitude, wavelength and first crest.', e: 'A gap that varies at more than one wavelength (e.g. a long bow-like wave and a short ripple).', u: 'Everything across the web' },
  'acr.ends': { t: 'Chamfered ends', d: 'Seen from the front: over the last length at each of the blade\'s ends the gap grows straight to the depth at the end. Each end its own.', e: 'A larger gap near the edges: more slurry there, a thicker edge.', u: 'Everything across the web' },
  'acr.meas': { t: 'Measured gap', d: 'Readings of the gap across the web (position, gap), pasted or from a CSV: a smooth curve through them without overshoot, flat beyond the first and last, added to the other parts.', e: 'The gap as it was measured on the machine.', u: 'Everything across the web' },
  'acr.crown': { t: 'Crown', d: 'A shape put on the blade to make the film even: a parabola (its amount at the middle, zero at the ends) or a free curve found by the crown finder.', e: 'Takes out a bow or other variation of the gap across the web.', u: 'Everything across the web' },
  'acr.bladeEnds': { t: 'Blade\'s ends', d: 'Each end of the blade relative to the web\'s edge: + it overhangs the edge, - it ends inside. The bow\'s supports and the chamfers are at the blade\'s ends; past an end inside the web no blade meters the film.', e: 'Where the blade stops across the web: the edge bead forms there (Flow › 3D).', u: '1D, 2D locations, 3D' },
  'acr.front': { t: 'The blade across the web', d: 'The gap\'s change across the web seen from the front: each part (dashed) and their sum (the blade\'s edge, solid). Drag a handle: the bow and crown at the middle, the tilt at the right edge, the waviness\'s crest, a chamfer\'s depth and length, the blade\'s ends; arrow keys on a focused handle.', e: 'Shows where the gap and so the film are larger.', u: 'Flow › 1D › Across the web' },
  'cfd.custom': { t: 'Custom profile', d: 'Points from the inlet round the metering point M and up the face: pasted, from a DXF drawing (arcs kept), from a side section of an STL or STEP blade, or placed on the drawing (a spline). Corners where the outline turns more than the set angle, or where ticked; M (the gap there) and C found or picked.', e: 'Any blade: the underside and face as drawn.', u: 'CFD, 1D, 3D' },
  'cfd.R': { t: 'Radius', d: 'Radius of the curved blade underside (round entry).', r: 'Range 10 to 500 mm · default 100 mm', e: 'Larger: a longer, flatter converging gap.', u: 'CFD, the DOE' },
  'cfd.pool': { t: 'Pool edge upstream', d: 'How far upstream of the metering edge the slurry pool begins: where the 2D domain starts. At most 0.8 × the radius is used.', r: 'Range 5 to 150 mm · default 40 mm', e: 'Further: a longer domain under the blade.', u: 'CFD, the DOE' },
  'cfd.exit': { t: 'Exit face to the web', d: 'Angle between the blade\'s exit face and the web, measured in the slurry (90° = vertical face).', r: 'Range 30 to 150° · default 90°. With the contact angle it must total 94 to 175°.', e: 'Changes where the meniscus sits and how far the contact line climbs.', u: 'CFD, the DOE' },
  'cfd.model': { t: 'Rheology model', d: 'The viscosity law: Newtonian (constant), Power law (shear-thinning, n), Herschel–Bulkley (yield stress + power law), Carreau–Yasuda or Cross (a plateau at low and high shear; their extras on Materials). Chosen here or on Materials.', e: 'Which of n and the yield stress the CFD uses.', u: 'CFD, the 1D, the DOE' },
  // CFD: fibre
  'cfd.fibre': { t: 'Test report', d: 'The fibre\'s data sheet: fills in the basis weight, density, yarn and air permeability.', u: 'CFD fibre results (porosity, permeability, slip, drying air)' },
  'cfd.gsm': { t: 'Basis weight', d: 'Mass of fibre per square metre (from the report).', r: 'Range 10 to 3000 g/m²', e: 'Higher, same thickness: a denser, less porous fibre.', u: 'CFD fibre results' },
  'cfd.rhoF': { t: 'Fibre density', d: 'Density of the fibre material (e.g. about 1380 kg/m³ for PET, 910 for PP).', r: 'Range 800 to 3000 kg/m³', u: 'CFD fibre results' },
  'cfd.dFrom': { t: 'Filament diameter from', d: 'Where the filament diameter comes from: the yarn\'s denier and filament count, or a Kozeny–Carman fit to the air permeability.', u: 'CFD fibre results' },
  'cfd.den': { t: 'Yarn', d: 'Yarn linear density in denier (grams per 9000 m).', r: 'Range 5 to 3000 denier', u: 'CFD fibre results' },
  'cfd.nf': { t: 'Filaments per yarn', d: 'Number of filaments in one yarn: with the denier it gives the filament diameter.', r: 'Range 1 to 1000', u: 'CFD fibre results' },
  'cfd.airPerm': { t: 'Air permeability', d: 'Air flow through the fibre per area in the permeability test (from the report).', r: 'Range 0.1 to 5000 × 10⁻³ m³/m²·s', e: 'Higher: a more open fibre (larger permeability).', u: 'CFD fibre results' },
  'cfd.airDP': { t: 'Test pressure', d: 'Pressure difference of that air permeability test (0 = not stated in the report).', r: 'Range 0 to 2000 Pa', u: 'CFD fibre results' },
  'cfd.koz': { t: 'Kozeny constant', d: 'Constant of the Kozeny–Carman relation between porosity, filament size and permeability (about 5 for random fibres).', r: 'Range 1 to 20', u: 'CFD fibre results' },
  'cfd.airFrac': { t: 'Air fraction, top surface', d: 'Share of the fibre\'s top surface that is air pockets under the slurry: sets the slip of the slurry over the fibre.', r: 'Range 0.05 to 0.95', e: 'Higher: more slip at the web, the web drags the slurry less.', u: 'CFD (web slip), fibre results' },
  // Materials: the slurry's card
  'mat.phi': { t: 'Solids', d: 'Volume fraction of the GO solids in the slurry. From you: over 40 vol% (the exact fraction not given).', r: 'Range 1 to 74 vol%', e: 'Higher: a denser slurry (the flow models), a thicker dry film and less water to take out.', u: 'Slurry density (all flow models), Process (mass balance)' },
  'mat.rhoS': { t: 'Solids density (GO)', d: 'Density of the GO particles. Assumed: 1.9 g/cm³ (1.8–2.2 reported).', r: 'Range 1 to 3 g/cm³', u: 'Slurry density, dry coat weight' },
  'mat.rhoL': { t: 'Liquid density (water)', d: 'Density of the liquid the solids are in: water.', r: 'Range 900 to 1100 kg/m³', u: 'Slurry density, the water to take out' },
  'mat.dMean': { t: 'Particle size, mean', d: 'Mean size of the particles (flakes, across). From you: 2–8 µm (the mean not given).', r: 'Range 0.1 to 100 µm', u: 'The card (the flakes\' alignment in a later phase)' },
  'mat.dMin': { t: 'Particle size, smallest', d: 'Smallest particle size. From you: 2 µm.', r: 'Range 0.1 to 100 µm', u: 'The card' },
  'mat.dMax': { t: 'Particle size, largest', d: 'Largest particle size. From you: 8 µm.', r: 'Range 0.1 to 100 µm', u: 'The card' },
  'mat.tFlake': { t: 'Flake thickness', d: 'Thickness of a GO flake. Assumed: about 1 nm (a single sheet).', r: 'Range 0.5 to 1000 nm', u: 'The card (the flakes\' aspect ratio in a later phase)' },
  'mat.co': { t: 'C/O ratio', d: 'Carbon to oxygen ratio of the GO. Assumed: about 2.', r: 'Range 1 to 20', u: 'The card (reduction in a later phase)' },
  'mat.phiDry': { t: 'Dry film packing', d: 'Solids fraction of the dry film: the stacked flakes and the pores between them. Assumed: 0.85.', r: 'Range 0.3 to 1', e: 'Higher: a thinner, denser dry film for the same wet film.', u: 'Process (dry film thickness, its density)' },
  'mat.flag': { t: 'Where the value is from', d: 'From you (you gave it), Assumed (a typical value until measured) or Measured. The counts at the top of the card and the pills follow it.', u: 'Materials' },
  'mat.src': { t: 'Source', d: 'Where the value comes from, in words: a datasheet, a test, a paper, you.', u: 'Materials, the report' },
  'mat.reset': { t: 'Defaults', d: 'The slurry card back to its first values (with Undo to go back).', u: 'Materials' },
  // (how it flows, GO-1: the laws' extras and the structure, on the rheology card)
  'matr.etaInf': { t: 'Viscosity at high shear, η∞', d: 'The Carreau–Yasuda and Cross laws\' plateau at high shear rates. Assumed until fitted to a flow curve.', r: 'Range 0 to 5 Pa·s (the laws use at most half the viscosity at 2.7 1/s)', u: 'The flow models with Carreau–Yasuda or Cross' },
  'matr.lamT': { t: 'Time constant λ', d: 'The Carreau–Yasuda and Cross laws\' time: 1 / λ is the shear rate where the slurry starts to thin. Assumed until fitted.', r: 'Range 0.001 to 1000 s', e: 'Longer: thinning starts at lower shear rates.', u: 'The flow models with Carreau–Yasuda or Cross' },
  'matr.aCY': { t: 'Transition sharpness a', d: 'How sharply the Carreau–Yasuda law turns from its plateau to thinning (2: the Carreau law). Assumed until fitted.', r: 'Range 0.2 to 5', u: 'The flow models with Carreau–Yasuda' },
  'matr.structOn': { t: 'Structure (thixotropy)', d: 'The slurry\'s structure λ (0 broken down, 1 built up) breaks down under shear and rebuilds at rest; its viscosity and yield stress follow it. On: the 2D carries it along its flow and feeds it back, the 1D along the blade, and after the blade it rebuilds on the web (the ripple and the edge). Off: the steady flow curve everywhere, as before.', e: 'The 2D takes several flows (a few times longer).', u: '2D, 1D To the oven, Film surface, Web edge, the report' },
  'matr.tb': { t: 'Rebuild time at rest', d: 'How long the structure takes to rebuild at rest: λ rebuilds as 1 − (1 − λ0) e^(−t / t_b). Assumed (tens of seconds, typical of GO dispersions) until fitted to a thixotropy test.', r: 'Range 0.1 to 100000 s', e: 'Longer: the slurry stays broken down (thinner, weaker) for longer after the blade.', u: 'The structure (2D, 1D, the web)' },
  'matr.gdc': { t: 'Shear rate that halves the structure', d: 'At a steady shear rate γ̇ the structure settles to λ = 1 / (1 + γ̇ / γ̇c): half broken at γ̇c. Assumed until fitted.', r: 'Range 0.0001 to 10000 1/s', e: 'Lower: more broken down at a given shear rate.', u: 'The structure (2D, 1D, the web)' },
  'matr.cy': { t: 'Yield stress gain when rested, c_y', d: 'Rested, the yield stress is (1 + c_y) times the fully broken one; at steady shear the flow curve is kept. Assumed until fitted.', r: 'Range 0 to 50', e: '0: the yield stress does not follow the structure.', u: 'The structure (2D, 1D, the web)' },
  'matr.ce': { t: 'Viscosity gain when rested, c_η', d: 'Rested, the viscosity (above the yield stress) is (1 + c_η) times the fully broken one; at steady shear the flow curve is kept. Assumed until fitted.', r: 'Range 0 to 50', e: '0: the viscosity does not follow the structure.', u: 'The structure (2D, 1D, the web)' },
  'matr.reset': { t: 'Defaults', d: 'The rheology card\'s own values (the laws\' extras, the structure) back to their first values (with Undo to go back).', u: 'Materials' },
  'mato.on': { t: 'Flake alignment', d: 'How the GO flakes line up in the flow. On: each 2D run carries an ensemble of flakes along the streamlines of its flow to the film, then leaves them at rest on the web until the oven (Flow › 2D › Flakes). Off: no alignment is computed.', e: 'On: a 2D run takes some seconds longer (about 10 s with the defaults).', u: 'Flow › 2D (Flakes panel, the Flakes switch on the plot), the DOE, the report' },
  'mato.model': { t: 'Alignment model', d: 'Liquid crystal (Doi–Hess): the flakes turn with the flow (Jeffery), diffuse (D_r) and line up with each other (U; above about 4.5 they order at rest). Suspension (Folgar–Tucker): the flakes turn with the flow and are knocked about by their neighbours in proportion to the shear rate (C_i); nothing moves after the blade.', r: 'the liquid crystal by default (your flakes about 5000 × wider than thick at 40 vol%)', u: 'Flow › 2D, the DOE' },
  'mato.reset': { t: 'Defaults', d: 'The alignment card\'s values back to their first values (with Undo to go back).', u: 'Materials' },
  'or.redo': { t: 'Redo alignment', d: 'Computes the flakes\' alignment again on the flow as it was solved, with the alignment card as it is now: after its values change, the flow need not be solved again.', u: 'Flow › 2D (Flakes)' },
  'or.csv': { t: 'Export CSV', d: 'The alignment by streamline (depth, flatness leaving the blade and at the oven, the order and direction, both cuts\' order, mean and spread) and the two cuts\' angle histograms.', u: 'Flow › 2D (Flakes)' },
  'or.addImg': { t: 'Add SEM image', d: 'An SEM image of the dried film\'s cross-section (PNG, JPEG, GIF, BMP, WebP; kept in the project at up to 1600 px). Mark the web\'s line (in the web\'s direction) and the film\'s top on it; then read the flakes\' angles automatically or click flakes by hand. Its cut: along the web (MD) or across it (CD).', u: 'Flow › 2D (Flakes), the report' },
  'or.addTab': { t: 'Import angle table', d: 'A text table of flake angles (CSV, tab or semicolon separated) with a header row: cut (MD / CD), depth (µm from the web, or a fraction 0–1), angle (° to the web); optional thickness (the film\'s, µm).', u: 'Flow › 2D (Flakes)' },
  'or.paste': { t: 'Paste angles', d: 'The same table as Import angle table, pasted (cells copied from a spreadsheet: tab separated).', u: 'Flow › 2D (Flakes)' },
  'or.read': { t: 'Read automatically', d: 'Finds the flakes\' direction at every few pixels inside the film from the image\'s local structure (the structure tensor, as ImageJ\'s OrientationJ): each point\'s angle to the web\'s line, its depth, and how clearly it is one direction (its weight). Checked on made-up images to within 0.1°.', u: 'Flow › 2D (Flakes)' },
  'or.win': { t: 'Window', d: 'The structure tensor\'s window (px): about the flakes\' thickness as the image shows them. Larger smooths more (for blurry or noisy images), smaller follows finer flakes.', r: '1–20 px; 3 by default', u: 'Read automatically' },
  'tb.flakes': { t: 'Flakes', d: 'The flakes\' alignment drawn along the streamlines of the flow (computed with the 2D when the alignment is on): at each point an ellipse long along the flakes\' plane, as thin as they are lined up, in the plot\'s own scale.', u: 'Flow › 2D' },
  'rt.import': { t: 'Import rheometer file', d: 'Reads a rheometer export (Anton Paar RheoCompass, or any table with named columns): tab, semicolon or comma between cells, a decimal point or comma, UTF-8 or UTF-16. A flow curve, a thixotropy test (3ITT), an amplitude or a frequency sweep, from its columns.', u: 'Materials (Rheometer tests)' },
  'rt.test': { t: 'Rheometer test', d: 'Shows this test: its points, the fits and their values with one standard error; loose where the test cannot pin a value down.', u: 'Materials' },
  'rt.remove': { t: 'Remove test', d: 'Takes this test off the card (with Undo to bring it back). The values a fit put on the card stay.', u: 'Materials' },
  'rt.use': { t: 'Use this fit', d: 'Puts the fit\'s values on the rheology card (marked Measured, the file as the source): a flow curve sets the model, the viscosity at 2.7 1/s, n and the yield stress in the inputs (as their sliders take them) and the law\'s extras; a thixotropy test the structure\'s values; an amplitude sweep\'s point the yield stress.', u: 'Every flow model' },
  // CFD: drying air (each oven zone's)
  'oven.len': { t: 'Zone length', d: 'Length of this oven zone along the line. The zones follow one another; the film spends length / web speed in each. Assumed.', r: 'Range 0.1 to 100 m', u: 'Oven length and time (Process)' },
  'oven.airU': { t: 'Air speed up into the fibre', d: 'Speed of this oven zone\'s drying air driven up through the fibre. Assumed.', r: 'Range 0 to 50 m/s', u: 'CFD fibre results (drying air)' },
  'oven.airT': { t: 'Air temperature', d: 'Temperature of this oven zone\'s drying air (sets its viscosity and density). Assumed.', r: 'Range 0 to 400 °C', e: 'Above the fibre\'s continuous use temperature: a warning in the fibre results.', u: 'CFD fibre results (drying air)' },
  'oven.plenum': { t: 'Plenum length', d: 'Length of the air plenum under the fibre in this oven zone, along the line. Assumed.', r: 'Range 1 to 5000 mm', u: 'CFD fibre results (drying air)' },
  'oven.rh': { t: 'Air humidity', d: 'Relative humidity of this oven zone\'s drying air, at its temperature (the air blown up and, when there are, the jets on top). It sets how much vapour the air can take and the water the dry film keeps. Assumed.', r: 'Range 0 to 100 %', u: 'Process › Drying in the oven' },
  'oven.top': { t: 'Above the film', d: 'What is above the film in this zone (the air blown up into the fibre from below is there in every zone): nothing blown (the oven\'s still air: natural convection, the walls\' radiation), hot air blown on the top through slot nozzles, IR heaters, or air and IR. The picture under it shows the choice.', r: 'Nothing blown by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.jetU': { t: 'Jet speed at the nozzles', d: 'The speed of the air leaving the slot nozzles above the film. The heat and vapour it carries off follow Martin\'s correlation for arrays of slot nozzles.', r: 'Range 0.5 to 150 m/s · 10 by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.jetT': { t: 'Jet air temperature', d: 'The temperature of the air blown on the top. Its humidity is the zone\'s air humidity (the same air).', r: 'Range 0 to 400 °C · 100 by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.jetB': { t: 'Slot width', d: 'The width of each slot nozzle (across the line its length is the web\'s width).', r: 'Range 0.5 to 50 mm · 5 by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.jetH': { t: 'Nozzles above the film', d: 'The nozzles\' height above the film. Martin\'s correlation holds from 1 to 40 × twice the slot width.', r: 'Range 1 to 500 mm · 20 by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.jetS': { t: 'Slot pitch along the line', d: 'The distance between neighbouring slots along the line.', r: 'Range 5 to 1000 mm · 100 by default (assumed)', u: 'Process › Drying in the oven' },
  'oven.ir': { t: 'IR power reaching the film', d: 'The IR heaters\' power per area arriving at the film; the film takes the share set on the Drying card (IR absorbed by the film).', r: 'Range 0 to 200 kW/m² · 5 by default (assumed)', u: 'Process › Drying in the oven' },
  'dry.film': { t: 'Which film', d: 'The drying of the wet film at a location (its most detailed solution: 3D, else 2D, else 1D) or of the web\'s mean (the 1D across the web). The table below has them all.', u: 'Process › Drying in the oven' },
  'dry.oven': { t: 'The film through the oven', d: 'The line drawn to scale: the room before the oven and each zone (what is above the film under its label), and the film on its web in two lanes -- the water leaving from the top only, and from the top and the bottom -- its thickness to scale, its skin darker, where the skin forms, where it is dry. Click to look through the film there.', u: 'Process › Drying in the oven' },
  'dry.zones': { t: 'Oven zones', d: 'Opens the oven\'s zones in the inputs bar: each zone\'s length, the air blown up into the fibre (speed, temperature, plenum, humidity) and what is above the film.', u: 'Process' },
  'dry.csv': { t: 'Export CSV', d: 'Every film\'s drying along the line, both ways: the top and bottom temperatures, the evaporation from the top and the bottom, the water, the film\'s and its skins\' thickness.', u: 'Process › Drying in the oven' },
  'dry.temps': { t: 'Measured temperatures', d: 'Temperatures read in the oven, as a text table (CSV, tab or semicolon separated) with a header row: position along the oven (m; or time in the oven, s), temperature (°C), what (film top, web or air), location (L1–L4 or web). Drawn over the computed temperatures, with how far apart they are.', u: 'Process › Drying in the oven, the report' },
  'dry.exit': { t: 'Measured at the exit', d: 'What you measured on the film leaving the oven: the water left (% of the dry GO\'s mass: water / GO, as the table gives it), the dry film\'s thickness (µm), where along the oven it looks dry (m). Any of them; shown in the table beside the computed and over the water in the film.', u: 'Process › Drying in the oven, the report' },
  'matd.reset': { t: 'Defaults', d: 'The drying card\'s values back to their first values (with Undo to go back).', u: 'Materials' },
  // GO-4: the film, peeled off
  'film.film': { t: 'Which film', d: 'The film at a location (its drying as the drying section above shows it) or the web\'s mean. The same choice as the drying section\'s: one moves both.', u: 'Process › The film, peeled off' },
  'film.peelBtn': { t: 'After the oven', d: 'Opens the inputs bar at what follows the oven: the stretch in the room from the oven\'s exit to where the film is peeled, and the winder\'s core.', u: 'Process' },
  'film.csv': { t: 'Export CSV', d: 'Every film, both ways the water can leave: along the line the stress at the film\'s top, in the part stuck to the web and in the web, the thickness of each part and the blister risk; at each station the crack risk; the peel force at every angle and whether the film tears.', u: 'Process › The film, peeled off' },
  'film.stress': { t: 'Stress at the film\'s top', d: 'The stress along the film at its top, from the coater to the peel (positive pulls, negative squeezes). It comes from the film shrinking as its water leaves and as it cools, held by the web. The line marked \'its strength\' is the dry film\'s strength (drawn when it is near the stress).', u: 'Process › The film, peeled off' },
  'film.crackRisk': { t: 'Crack risk', d: 'At each station: the energy a crack through the film would free, over the film\'s fracture energy. Above 1 the film cracks; the spacing of the cracks follows from where it crosses 1. For the skin floating on the wet film under it and for the film stuck to the web.', u: 'Process › The film, peeled off' },
  'film.peelChart': { t: 'Peel force against the angle', d: 'The force per width to peel the film off the web at every angle from 0 to 180° (the winder\'s angle is not known). Dots where the film would tear before it peels. Your measured peel forces are drawn on it.', u: 'Process › The film, peeled off' },
  'film.through': { t: 'Through the film at the peel', d: 'The stress through the film\'s height just before it is peeled, in the part stuck to the web: from the web up to its top.', u: 'Process › The film, peeled off' },
  'film.blister': { t: 'Blister risk', d: 'Along the line: the energy a patch of film squeezed along it would free by lifting off the web, over its hold on the web. Above 1 the film wrinkles or blisters. Where the film boils under a skin, steam pushes it up too: the warning above the charts says so.', u: 'Process › The film, peeled off' },
  'film.sheet': { t: 'The peeled film on a table', d: 'A piece of the peeled film drawn as it curls: right after peeling, and later when its water has settled with the room\'s air. Its height is drawn larger than true, by the factor stated.', u: 'Process › The film, peeled off' },
  'film.curl': { t: 'Measured curl', d: 'How a peeled piece curls: its radius, or how high its edges lift over the piece\'s length; which way (toward its top or away); and when (right after peeling, later when settled, or unwound from the roll). What it implies is shown (the swelling with water; unwound from the roll, the share of the roll\'s bend it keeps), with Use to put it on the Film card.', u: 'Process › The film, peeled off, the report' },
  'film.cracks': { t: 'Measured cracks', d: 'The spacing between cracks (and their width, if you have it) and where you saw them: on the web, after peeling or on the roll. The fracture energy it implies is shown, with Use to put it on the Film card.', u: 'Process › The film, peeled off, the report' },
  'film.peelF': { t: 'Measured peel force', d: 'A peel force per width of the film (N per metre of width: the force over the strip\'s width) and the angle it was peeled at (90° straight up, 180° folded back). The hold on the web it implies is shown, with Use to put it on the Film card.', u: 'Process › The film, peeled off, the report' },
  'film.use': { t: 'Use this value', d: 'Puts the value your measurement implies on the Film card (marked Measured, your measurement as the source) and solves the film again. Undo takes it back.', u: 'The Film card' },
  'film.remove': { t: 'Remove', d: 'Takes this measurement off (with Undo to bring it back). Values it put on the Film card stay.', u: 'Process › The film, peeled off' },
  'oven.peelLen': { t: 'Oven\'s exit to the peel', d: 'The length of the stretch in the room from the oven\'s exit to where the film is peeled off the web (still air above and below at the room\'s temperature and humidity). The film keeps drying and cools there. Assumed until you set it.', r: 'Range 0 to 100 m · 2 by default (assumed)', u: 'Process › The film, peeled off' },
  'oven.core': { t: 'Winder\'s core diameter', d: 'The diameter of the core the peeled film is wound on, its top facing out: the smaller the core, the more the roll bends the film and stretches its top. Assumed until you set it.', r: 'Range 10 to 1000 mm · 76 by default (assumed)', u: 'Process › The film, peeled off' },
  'matf.reset': { t: 'Defaults', d: 'The film card\'s values back to their first values (with Undo to go back).', u: 'Materials' },
  'oven.pieceL': { t: 'Piece\'s length (along the line)', d: 'The pieces cut from the roll later: their length along the line (as the film ran). From you: 30 × 30 cm pieces.', r: 'Range 10 to 2000 mm · 300 by default', u: 'Process › The film, peeled off (a piece cut from the roll, in 3D)' },
  'oven.pieceW': { t: 'Piece\'s width', d: 'The pieces cut from the roll later: their width across the line.', r: 'Range 10 to 2000 mm · 300 by default', u: 'Process › The film, peeled off (a piece cut from the roll, in 3D)' },
  'sheet.way': { t: 'Which way the water left', d: 'The piece of the film shown, its water having left from the top only or from the top and the bottom (both are computed: which one is not known).', u: 'Process › The film, peeled off' },
  'sheet.free': { t: 'Held up (free)', d: 'The piece (as cut, out of the stack or a day later: the switch above) as it curls with nothing pressing on it: its weight does not flatten it. Drawn with its curl up; heights exaggerated by the factor said. A piece this large rolls up one way rather than keeping a bowl (a bowl would have to stretch).', u: 'Process › The film, peeled off' },
  'sheet.table': { t: 'On a table (its weight)', d: 'The piece (as cut, out of the stack or a day later) lying on a table with its curl up: its weight pulls it down toward the table, which pushes back where it touches. Heights above the table; exaggerated by the factor said.', u: 'Process › The film, peeled off' },
  'sheet.size': { t: 'Measured: a piece\'s size pressed flat', d: 'A piece\'s length (along the line) and width (mm), pressed flat, and when: before the drying oven (as cut), after it, or after the furnace (the graphene film: its size is for the furnace\'s next step). After the drying oven against before it (or against the size cut) reads back as the swelling with water (the Film card\'s β) it implies, at the water the stack gives it when it is measured (out of the stack, 1–2 h after the oven), with Use to put it on the card. If it has taken back about the water it was cut with, its size says little about the swelling, and the app says so.', u: 'Process › The film, peeled off, the report' },
  'oven.tOven': { t: 'Time in the drying oven', d: 'How long the stack of pieces stays in the drying oven. Pressed, a piece dries from its edges in: its water leaves along it to the stack\'s edges. From you: 1–2 h (1.5).', r: 'Range 0.05 to 48 h · 1.5 by default', u: 'Process › The film, peeled off (in the pressed stack)' },
  'oven.tRest': { t: 'Under the plate after, until taken out', d: 'Out of the oven the stack stays as it was under the plate, in the room, until the pieces are taken out to be looked at and measured; meanwhile the room\'s water comes back in at the stack\'s edges. From you: 1–2 h (1.5). 0: taken out straight from the oven.', r: 'Range 0 to 72 h · 1.5 by default', u: 'Process › The film, peeled off (in the pressed stack)' },
  'sheet.when': { t: 'The piece: as cut, out of the stack, a day later', d: 'Which piece is drawn. As cut: from the roll, before the drying oven. Out of the stack: when it is taken out, as you look at it and measure it (its water as the stack left it, and the creep the stack set). A day later: laid out in the room, its water the room\'s all through: what is left is what the creep set.', u: 'Process › The film, peeled off' },
  'stack.water': { t: 'Water across a piece', d: 'The water along the middle of a piece, from its edge (0) to its middle, at times in the drying oven (one colour, lighter earlier) and under the plate after it (dashed). Pressed, the water leaves and comes back only along the pieces, at the stack\'s edges.', u: 'Process › The film, peeled off (in the pressed stack)' },
  'stack.pull': { t: 'The pull held flat', d: 'The largest pull in a piece\'s plane while the stack holds it flat, against time: its drying edges shrink while its middle is still wet, and are pulled. The film\'s strength is marked: above it the edges may crack. While wet the film creeps and eases it (the Film card\'s creep time).', u: 'Process › The film, peeled off (in the pressed stack)' },
  'oven.dryT': { t: 'Drying oven for the pieces', d: 'The oven the cut pieces are dried in, stacked 20 at a time under an aluminium plate for 1–2 h. Its air is the room\'s heated, so it holds little water: the pieces dried through keep the isotherm\'s water there. From you: about 100 °C.', r: 'Range 20 to 300 °C · 100 by default', u: 'Process › The film, peeled off (a piece cut from the roll, in 3D)' },
  'matf.see': { t: 'See it on Process', d: 'Opens the Process tab at the film, peeled off.', u: 'Materials' },
  'matf.Ep': { t: 'Dry film\'s stiffness along it', d: 'How stiff the dry film is along its plane (its layers of flakes). With its shrinking it sets the stress, the curl and the peel\'s bending.', e: 'Stiffer: more stress for the same shrinking.', u: 'Process › The film, peeled off' },
  'matf.Et': { t: 'Dry film\'s stiffness through it', d: 'How stiff the film is through its thickness (its layers pressed together).', u: 'Process › The film, peeled off' },
  'matf.Gpt': { t: 'Shear between its layers', d: 'How stiff the film is when its layers slide on each other.', u: 'Process › The film, peeled off' },
  'matf.nup': { t: 'Poisson\'s ratio along it', d: 'How much the film narrows across as it is stretched along.', u: 'Process › The film, peeled off' },
  'matf.nupt': { t: 'Poisson\'s ratio through it', d: 'How much the film\'s thickness changes as it is stretched along.', u: 'Process › The film, peeled off' },
  'matf.Xh': { t: 'Softer with water', d: 'The water (kg per kg of GO) at which the film\'s stiffness is half its dry stiffness: wet film is softer.', u: 'Process › The film, peeled off' },
  'matf.beta': { t: 'Swelling with its water', d: 'How much the film grows along its plane per kg of water per kg of GO: it shrinks by this as its water leaves. The main cause of the stress, the curl and the cracks. A measured curl gives it.', e: 'Larger: more stress, more curl, more cracks.', u: 'Process › The film, peeled off' },
  'matf.alphaF': { t: 'Its own heat expansion', d: 'How much the dry film grows with temperature along its plane (apart from its water leaving).', u: 'Process › The film, peeled off' },
  'matf.sigF': { t: 'Dry film\'s strength', d: 'The stress at which the film breaks when pulled. The film tears at the peel front, or cracks on the roll, above it.', u: 'Process › The film, peeled off' },
  'matf.GcF': { t: 'Its fracture energy', d: 'The energy per area a crack through the film takes. The crack risk is the energy a crack would free over this. A measured crack spacing gives it.', e: 'Tougher: fewer cracks, further apart.', u: 'Process › The film, peeled off' },
  'matf.Gil': { t: 'Between its layers', d: 'The energy per area to split the film between its layers. If its hold on the web is more than this, bits of the film stay on the web as it peels.', u: 'Process › The film, peeled off' },
  'matf.Gi': { t: 'Its hold on the fibre web', d: 'The energy per area to peel the film off the web. It sets the peel force (about this at 90°, half of it folded back at 180°) and the blister risk. A measured peel force gives it.', e: 'Larger: harder to peel, fewer blisters.', u: 'Process › The film, peeled off' },
  'matf.setFrac': { t: 'Curl the roll sets', d: 'The share of the roll\'s bending the film keeps after it is unwound (it creeps while wound). 0: it springs back fully. A curl measured after the roll gives it.', u: 'Process › The film, peeled off' },
  'matf.Ew': { t: 'Fibre web\'s stiffness along it', d: 'How stiff the fibre web is along the line: it holds the film against its shrinking until it is peeled.', u: 'Process › The film, peeled off' },
  'matf.soft': { t: 'Fibre web through its thickness and in shear', d: 'The web\'s stiffness through its thickness and in shear, as a share of its stiffness along the line (a fabric\'s yarns flatten and slide).', u: 'Process › The film, peeled off' },
  'matf.nuw': { t: 'Fibre web\'s Poisson\'s ratio', d: 'How much the web narrows across as it is stretched along.', u: 'Process › The film, peeled off' },
  'matf.alphaW': { t: 'Fibre web\'s heat expansion', d: 'How much the web grows with temperature: in the oven it grows, and shrinks back as it cools.', u: 'Process › The film, peeled off' },
  // (the furnace and the graphene film, GO-5)
  'furn.film': { t: 'Which film', d: 'The film at a location or the web\'s mean: its cut piece goes into the furnace, its water having left the way the piece\'s section above shows (top only, or top and bottom: its switch). The same choice as the drying\'s and the film\'s sections: one moves all three.', u: 'Process › The furnace and the graphene film' },
  'furn.btn': { t: 'The furnace', d: 'Opens the inputs bar at the furnace: the two runs\' programs (or your cycles\' files) and the stack in its holder.', u: 'Process › The furnace and the graphene film' },
  'furn.csv': { t: 'Export CSV', d: 'The two runs through time (temperature, the weight kept, C/O, how far graphitized, the layers\' spacing, the thickness at the middle and near the edge, the gas against its hold) and the graphene film\'s thickness across the piece.', u: 'Process › The furnace and the graphene film' },
  'furn.runs': { t: 'The two runs', d: 'The furnace\'s temperature against the time into each run, as set (or from your file); a dot where the piece starts to puff up.', u: 'Process › The furnace and the graphene film' },
  'furn.weight': { t: 'Its weight', d: 'The piece\'s weight through both runs, of its dry GO: its water first, then its labile oxygen in a sharp step (about 200 °C), the stable oxygen slowly to 1000 °C, the last oxygen and hydrogen in the second run. The carbon that leaves with the oxygen (as CO and CO₂) goes too.', u: 'Process › The furnace and the graphene film' },
  'furn.co': { t: 'Its oxygen: C/O', d: 'Its carbon to oxygen atoms through both runs, on a log scale: the GO\'s (the slurry card) to about 10–15 after the first run, past 100 in the second.', u: 'Process › The furnace and the graphene film' },
  'furn.thick': { t: 'Its thickness', d: 'The piece\'s thickness at its middle and near its edge through both runs, and its layers\' own (dotted): they close up as its oxygen leaves (the spacing from about 0.8 nm to graphite\'s 0.335 nm). Where the gas parts them the piece grows, and stays so: the layers do not close again.', u: 'Process › The furnace and the graphene film' },
  'furn.gas': { t: 'The gas against its hold', d: 'The gas in the piece, where it is highest, against what holds its layers together (their cohesion, the Furnace card, and the load on them): at 100 % it is puffing -- the gas holds its layers apart and the piece grows. It rises with the heating rate (more gas each minute) and with the piece\'s thickness (further for the gas to go).', u: 'Process › The furnace and the graphene film' },
  'furn.across': { t: 'The graphene film across the piece', d: 'The graphene film\'s thickness at the end, from the piece\'s middle to the middle of an edge and to a corner (the top piece of the stack). Even when the gas under the papers is let out easily; with the holder\'s plates on the stack, thinner near the edges, where the gas gets out along the papers.', u: 'Process › The furnace and the graphene film' },
  'furn.meas': { t: 'Measured graphene film', d: 'The graphene film out of the furnace (Q92): its thickness, the weight kept (its weight over the GO piece\'s that went in, %) and its heat conduction along it, for a film (a location or the web). Each is set beside the computed; the thickness fits the puffed film\'s way out, the heat conduction the crystallites\' size that halves it.', u: 'Process › The furnace and the graphene film' },
  'furn.use': { t: 'Use this value', d: 'Puts the value your measurement implies on the Furnace card (marked Measured, your measurement as the source) and solves the furnace again. Undo takes it back.', u: 'Process › The furnace and the graphene film' },
  'furn.fit': { t: 'Fit', d: 'Solves the furnace again and again to find the Furnace card\'s value that gives what you measured (the thickness: the puffed film\'s way out) or saw (the first run not puffing: the least gas-tightness of its open layers), then puts it on the card as Measured. Takes a few tens of seconds; Undo takes it back.', u: 'Process › The furnace and the graphene film' },
  'furn.remove': { t: 'Remove', d: 'Takes this measurement off (with Undo to bring it back). Values it put on the Furnace card stay.', u: 'Process › The furnace and the graphene film' },
  'furn.step': { t: 'A step of the run', d: 'The furnace heats (or cools) at this rate to this temperature and holds it there this long, then goes on to the next step. The runs start from the room. Yours are to come (Q97): until then these are assumed, 12–48 h a run (Q88).', r: 'Rate 0.01 to 100 °C/min · to 0 to 3300 °C · hold 0 to 100000 min', u: 'Process › The furnace and the graphene film' },
  'furn.cool': { t: 'Cooling', d: 'After its last step the furnace cools to the room at this rate.', r: 'Range 0.01 to 100 °C/min', u: 'Process › The furnace and the graphene film' },
  'furn.add': { t: 'Add a step', d: 'Adds a step after the last one: the same rate, 100 °C higher, no hold.', u: 'Process › The furnace and the graphene film' },
  'furn.delstep': { t: 'Remove the step', d: 'Takes this step out of the run (Undo brings it back).', u: 'Process › The furnace and the graphene film' },
  'furn.file': { t: 'Upload a cycle', d: 'A run from your furnace\'s log (Q97): a text or CSV file of two columns, time and temperature (°C; K if its header says so), one row per point. Its time\'s unit (hours, minutes or seconds) from its header when it names one, else you choose it. The run then follows your file instead of its steps.', u: 'Process › The furnace and the graphene film' },
  'furn.clear': { t: 'Use steps instead', d: 'The run follows its steps again instead of your file.', u: 'Process › The furnace and the graphene film' },
  'furn.unit': { t: 'The file\'s time unit', d: 'Your file does not name its time\'s unit: choose hours, minutes or seconds.', u: 'Process › The furnace and the graphene film' },
  'furn.N': { t: 'Pieces in a stack', d: 'How many GO pieces are in one stack in the furnace, each between two graphite papers (Q89). It depends on the product (Q103): 20 assumed, as the drying stack. With the holder\'s plates on the stack, the more pieces the more the stack grows against them.', r: 'Range 1 to 1000', u: 'Process › The furnace and the graphene film' },
  'furn.paperT': { t: 'Graphite paper\'s thickness', d: 'One graphite paper between the pieces. From you: 0.3–1 mm (Q105); 0.5 mm. Its weight on the piece under it, and with the plates on the stack how much the papers give.', r: 'Range 0.01 to 10 mm', u: 'Process › The furnace and the graphene film' },
  'furn.margin': { t: 'Paper bigger than the piece', d: 'How much bigger the graphite paper is than the piece, each side (Q104: bigger; by how much not known, 20 mm assumed). The gas under the paper goes out at the paper\'s edges.', r: 'Range 0 to 500 mm', u: 'Process › The furnace and the graphene film' },
  'furn.room': { t: 'Above the stack', d: 'In the graphite holder, snug (Q106/Q107): a gap left above the stack for it to grow, or the holder\'s plates on it (Q108: it depends on the product). With the plates on it, as the pieces grow the stack pushes on them and the papers give: the load on the pieces rises.', u: 'Process › The furnace and the graphene film' },
  'furn.gap': { t: 'Gap above the stack', d: 'The room left above the stack in the holder: the pieces grow freely until the stack\'s growth fills it, then push on the plates.', r: 'Range 0 to 1000 mm', u: 'Process › The furnace and the graphene film' },
  'matu.reset': { t: 'Defaults', d: 'The Furnace card\'s values back to their first values (with Undo to go back).', u: 'Materials' },
  'matu.see': { t: 'See it on Process', d: 'Opens the Process tab at the furnace and the graphene film.', u: 'Materials' },
  'matu.Tw': { t: 'Its water leaves around', d: 'Where the piece\'s water (the room\'s, Materials › Drying card\'s isotherm) leaves, heated at 10 °C/min (its peak). A first-order stage, its spread a few degrees.', u: 'Process › The furnace and the graphene film' },
  'matu.hc': { t: 'Its hydrogen, H/C', d: 'The GO\'s hydrogen atoms per carbon, in its hydroxyl and carboxyl groups: it leaves as water with the labile oxygen and the rest as H₂ at the end. With the C/O (the slurry card) it sets the GO\'s composition and so the weight kept.', u: 'Process › The furnace and the graphene film' },
  'matu.s1': { t: 'Labile oxygen', d: 'The share of the GO\'s oxygen in its labile groups (epoxide, hydroxyl): it leaves at 150–300 °C in a sharp step, most of the gas the pieces make.', u: 'Process › The furnace and the graphene film' },
  'matu.T1': { t: 'Labile oxygen leaves around', d: 'Where the labile oxygen leaves fastest heated at 10 °C/min: GO\'s sharp step, 200–230 °C. Sets its activation energy (first order, with a rate constant\'s prefactor of 10¹³ /s).', u: 'Process › The furnace and the graphene film' },
  'matu.w1': { t: 'Labile oxygen: its spread', d: 'The spread (standard deviation) of its activation energies: small for a sharp step, larger to spread it over more degrees.', u: 'Process › The furnace and the graphene film' },
  'matu.c1CO2': { t: 'Labile oxygen out as CO₂', d: 'The share of its oxygen atoms that leave in CO₂ (with half a carbon each). The rest leave as CO and water, the water as far as the hydrogen goes.', u: 'Process › The furnace and the graphene film' },
  'matu.c1CO': { t: 'Labile oxygen out as CO', d: 'The share of its oxygen atoms that leave in CO (a carbon each).', u: 'Process › The furnace and the graphene film' },
  'matu.s2': { t: 'Stable oxygen', d: 'The share of the GO\'s oxygen in its stable groups (carbonyl, ether, the carboxyl\'s rest): it leaves slowly over 300–1000 °C. What is left of the oxygen leaves in the second run.', u: 'Process › The furnace and the graphene film' },
  'matu.T2': { t: 'Stable oxygen leaves around', d: 'The middle of its broad loss, heated at 10 °C/min.', u: 'Process › The furnace and the graphene film' },
  'matu.w2': { t: 'Stable oxygen: its spread', d: 'The spread of its activation energies: broad, over 300–1000 °C.', u: 'Process › The furnace and the graphene film' },
  'matu.c2CO': { t: 'Stable oxygen out as CO', d: 'The share of its oxygen atoms that leave in CO; the rest in CO₂.', u: 'Process › The furnace and the graphene film' },
  'matu.T3': { t: 'The last oxygen and the hydrogen', d: 'Where the rest of the oxygen (as CO) and the hydrogen (as H₂) leave fastest, heated at 10 °C/min: in the second run, over 1000–2500 °C. Little gas, but with the layers closed up it is what puffs the pieces up (Q101).', u: 'Process › The furnace and the graphene film' },
  'matu.w3': { t: 'The last oxygen: its spread', d: 'The spread of its activation energies: broad.', u: 'Process › The furnace and the graphene film' },
  'matu.Tg': { t: 'Its layers order into graphite', d: 'Where graphitizing goes fastest heated at 10 °C/min: the layers\' spacing closes from 0.344 to graphite\'s 0.3354 nm and the crystallites grow. 2650 °C gives about 93 % graphitized after 1 h at 2800 °C (spacing 3.36 Å), typical of GO films.', u: 'Process › The furnace and the graphene film' },
  'matu.wg': { t: 'Graphitizing: its spread', d: 'The spread of its activation energies: it goes on over 2000–2800 °C.', u: 'Process › The furnace and the graphene film' },
  'matu.dIn': { t: 'Its layers\' spacing going in', d: 'The spacing of the GO\'s layers in the piece going into the furnace (with a little water): about 0.8 nm. It closes to 0.344 nm as the water and oxygen leave, then to graphite\'s. The piece\'s own thickness follows it, and the galleries between the layers are the gas\'s way out.', u: 'Process › The furnace and the graphene film' },
  'matu.La0': { t: 'Crystallites before graphitizing', d: 'The in-plane size of the carbon crystallites (La) of the reduced GO: about 10 nm. They grow as it graphitizes.', u: 'Process › The furnace and the graphene film' },
  'matu.La1': { t: 'Crystallites graphitized', d: 'La fully graphitized: GO films at 2800–3000 °C reach several hundred nm to a few µm. Between the two, La grows as the graphitized share (geometrically).', u: 'Process › The furnace and the graphene film' },
  'matu.kG': { t: 'Graphite\'s heat conduction', d: 'Perfect graphite\'s heat conduction along its layers: about 2000 W/(m·K). The graphene film\'s is this times its density over graphite\'s (2.26 g/cm³) times La / (La + ℓ): a correlation, not first principles.', u: 'Process › The furnace and the graphene film' },
  'matu.ell': { t: 'Crystallites\' size that halves it, ℓ', d: 'The crystallites\' boundaries scatter the heat: the film\'s heat conduction goes as La / (La + ℓ). Your measured heat conduction gives it (Use).', u: 'Process › The furnace and the graphene film' },
  'matu.Dgal': { t: 'Gas through its layers, open', d: 'How easily the gas gets out through the piece, between its layers, while they are open (the GO\'s spacing): a Knudsen diffusivity at 20 °C, going as the square of the gallery\'s opening as they close, and as the root of the temperature. Not measured: the least that keeps the first run from puffing (Q101) with the programs as they came; Fit to my first run gives it with yours.', u: 'Process › The furnace and the graphene film' },
  'matu.Dmin': { t: 'Gas through its defects, closed', d: 'What is left of the gas\'s way through the piece once its layers have closed up: through its defects. Small; it hardly changes the thickness.', u: 'Process › The furnace and the graphene film' },
  'matu.es': { t: 'Puffed: its gas way out doubles at', d: 'Where the gas has parted the layers, the piece lets gas out more easily the more it has grown: its way out goes as 1 + (growth / (this × its thickness))³. It sets how thick the graphene film comes out. Not measured: it fits a 125 µm graphene film from a 90 µm GO piece (the middles of your ranges, Q95 and Q99); your measured thickness gives it (Fit).', u: 'Process › The furnace and the graphene film' },
  'matu.sigZ': { t: 'Its layers\' hold', d: 'What holds the piece\'s layers together against the gas inside it: their cohesion (van der Waals), besides the load on them. Not known. The gas parts the layers where it beats this.', u: 'Process › The furnace and the graphene film' },
  'matu.rhoP': { t: 'Graphite paper\'s density', d: 'Flexible graphite paper, 0.7–1.3 g/cm³: its weight on the piece under it.', u: 'Process › The furnace and the graphene film' },
  'matu.Dp': { t: 'Gas along the paper', d: 'How easily the gas gets along the graphite paper (and between it and the piece) to its edges: a diffusivity at 20 °C, lower as the temperature rises (the gas\'s viscosity). Where the gas under a paper beats the load on it, the paper lifts and lets it by.', u: 'Process › The furnace and the graphene film' },
  'matu.Ez': { t: 'Paper\'s stiffness through it', d: 'How much the graphite papers give through their thickness: with the holder\'s plates on the stack, the pieces\' growth squeezes them, and this sets how hard the plates push back.', u: 'Process › The furnace and the graphene film' },
  'matf.stackK': { t: 'Water along the pieces in the stack', d: 'How easily water moves along the pressed pieces to the stack\'s edges (per its vapour pressure\'s gradient): through the film\'s own channels and the gaps between the pieces. Not measured: 3 × 10⁻⁷ kg/(m·s·Pa) is the least that fits your answers -- dry all over out of the drying oven, the size back to as cut 1–2 h later, the same a day later.', u: 'Process › The film, peeled off (in the pressed stack)' },
  'matf.creepTau': { t: 'Its creep time, wet', d: 'How fast the film creeps and eases a stress while it is held flat in the stack, at the water it was cut with: wetter it creeps faster, dry not at all (the rate goes as its water). Only in the drying oven. Not known: the waves in your photos will give it.', u: 'Process › The film, peeled off (in the pressed stack)' },
  'matf.Eg': { t: 'Wet film under a skin', d: 'How stiff the still-wet film under a dry skin is: the skin floats on it, free to shrink, until the drying front reaches the web.', u: 'Process › The film, peeled off' },
  'oven.add': { t: 'Add zone', d: 'Adds an oven zone after the last one, starting with the last zone\'s values. Up to 8 zones; Remove takes a zone out.', u: 'The oven' },
  // CFD: solver and mesh
  'sol.mesh': { t: 'Mesh', d: 'Density of the finite-element mesh: Coarse, Medium (default) and Fine scale the element counts by 1/1.5, 1 and 1.5; Custom takes counts you set.', e: 'Finer: more accurate near the edge and the meniscus, but slower (Fine takes about ten times as long).', u: 'CFD, mesh study, the DOE' },
  'sol.nEb': { t: 'Elements along the blade', d: 'Elements from the pool edge to the metering edge (empty = about 0.6 gap each, 12 to 40).', r: 'Range 6 to 120', u: 'CFD' },
  'sol.nEf': { t: 'Elements up the exit face', d: 'Elements up the exit face when the contact line climbs it (fewer for a short climb).', r: 'Range 1 to 30', u: 'CFD' },
  'sol.nEs': { t: 'Elements along the free surface', d: 'Elements along the free surface from the contact line to the end of the 2D domain.', r: 'Range 6 to 120', u: 'CFD' },
  'sol.nEy': { t: 'Elements across the gap', d: 'Rows of elements across the gap, from the web to the blade or free surface.', r: 'Range 2 to 20', u: 'CFD' },
  'sol.gradeB': { t: 'Grading toward the edge', d: 'How much the elements along the blade crowd toward the metering edge (1 = even).', r: 'Range 1 to 3 · default 1.6', u: 'CFD' },
  'sol.gradeS': { t: 'Grading toward the contact line', d: 'How much the elements along the free surface crowd toward the contact line (1 = even).', r: 'Range 1 to 3 · default 1.4', u: 'CFD' },
  'sol.gradeY': { t: 'Grading toward the blade and surface', d: 'How much the rows crowd toward the blade and the free surface (1 = even).', r: 'Range 1 to 3 · default 1.5', u: 'CFD' },
  'sol.maxIter': { t: 'Newton iterations, at most', d: 'Most Newton steps a solve may take before it is judged not converged.', r: 'Range 10 to 300 · default 60', u: 'CFD' },
  'sol.ldGaps': { t: 'Free film solved in 2D', d: 'Length of free film kept in the 2D domain beyond the edge, in gaps (at least 12 mm); the 1D film model takes over after it.', r: 'Range 3 to 30 gaps · default 8', e: 'Longer: the film has settled further inside the 2D domain, at more cost.', u: 'CFD' },
  'sol.tol': { t: 'Newton tolerance', d: 'Residual below which a solve counts as converged (in the solver\'s scaled units).', r: '10⁻⁶ to 10⁻¹⁰ · default 10⁻⁸', e: 'Looser: faster but less accurate; tighter: slower.', u: 'CFD, the DOE' },
  'sol.reset': { t: 'Defaults', d: 'Put all solver and mesh settings back to their defaults (Medium mesh, tolerance 10⁻⁸).' },
  'sol.study': { t: 'Mesh study', d: 'Open the Mesh study tab: solve a location on a coarser, its own and a finer mesh and compare the results.' },
  'sol.zones': { t: 'Refinement zones', d: 'Smaller elements where you ask: at the metering edge, the contact line, the exit face or along the film, layers at the web or the blade and surface, or bands along the flow. Set on the Mesh step, beside the mesh; they apply at every location.' },
  'sol.acc': { t: 'Mesh to an accuracy', d: 'Solve a location on finer and finer meshes -- adaptively where the error is, or everywhere -- until the wet film and contact line change less than a target; then keep that mesh (with its solution) for the location.' },
  'sol.band': { t: 'Add a band', d: 'A band along the flow (x from the inlet) with its own element size. It covers the gap\'s full height; drag its ends on the drawing or type them.' },
  // CFD: locations
  'loc.z': { t: 'Position across the web', d: 'Where across the web this location is (0 to 300 mm): it sets its gap and contact angle from the across-web variation.', u: 'CFD' },
  'loc.own': { t: 'Inputs for this location only', d: 'Open the location\'s own inputs and solver settings: set a value here to override the shared one for this location only.' },
  'loc.run': { t: 'Run this location', d: 'Solve this location with its current inputs.' },
  'loc.pick': { t: 'Show this location', d: 'Show this location\'s field in the viewport.' },
  // CFD toolbar
  'tb.run': { t: 'Run all 4', d: 'Solve the four locations (each in its own worker, at the same time). Ctrl+Enter.' },
  'tb.stop': { t: 'Stop', d: 'Stop the solves running (the results already there are kept) and any mesh study.' },
  'tb.view': { t: 'Location shown', d: 'Show one location, all four one above the other (Compare), or the change between two (Diff, B − A).' },
  'tb.field': { t: 'Field', d: 'The quantity coloured over the flow domain (velocity, shear rate, viscosity, pressure, vorticity, strain rate, dissipation, the structure λ) or none.' },
  'tb.stream': { t: 'Streamlines', d: 'Lines tangent to the velocity: slurry moves along them. Settings in Display.' },
  'tb.vec': { t: 'Vectors', d: 'Arrows of the velocity on an even lattice. Settings in Display.' },
  'tb.contours': { t: 'Contours', d: 'Lines of equal value of a field, with their values printed. Field in Display.' },
  'tb.display': { t: 'Display', d: 'Vertical scale, colours, contours, mesh, streamline and vector settings.' },
  'tb.cut': { t: 'Cut line', d: 'Draw a line on the plot (its start, then its end): the fields along it are charted in the Cut lines tab.' },
  'tb.probe': { t: 'Probes', d: 'Place named points on the plot: their values are listed in the Probes tab for each location.' },
  'tb.export': { t: 'Export CSV', d: 'Save the field, boundaries, metrics, probes or cut lines of the locations shown as CSV.' },
  'tb.image': { t: 'Save as image', d: 'Save a plot, a chart, a module\'s plots or the whole window as PNG or SVG.' },
  'tb.theme': { t: 'Light / dark', d: 'Switch between the light and dark theme (remembered in this browser).' },
  // display pop-over
  'dp.scale': { t: 'Vertical scale', d: 'Exaggerated: the gap is stretched to fill the plot (the scale is given). True: 1:1, the gap looks as thin as it is.' },
  'dp.contourField': { t: 'Contour field', d: 'The field whose contour lines are drawn: the colour field or another one.' },
  'dp.mesh': { t: 'Show the mesh', d: 'Draw the finite elements (edges and corner / mid nodes) over the field.' },
  'dp.meshQ': { t: 'Shade by quality', d: 'Fill each element by its shape quality (smallest over largest Jacobian): 1 = undistorted, near 0 = badly distorted.' },
  'dp.density': { t: 'Streamline density', d: 'How many streamlines: seeds spaced by equal flow rate, so lines crowd where the flow is fast.' },
  'dp.seeds': { t: 'Seeds', d: 'Automatic seeds, or Manual: click the plot to start a streamline there.' },
  'dp.dir': { t: 'Direction', d: 'Trace the streamlines downstream (forward), upstream (backward) or both from their seeds.' },
  'dp.lineColor': { t: 'Streamline colour', d: 'Plain, or coloured by a field or by the time taken along the line (the field colours are then off).' },
  'dp.lineW': { t: 'Streamline width', d: 'Line width of the streamlines.' },
  'dp.arrows': { t: 'Direction arrows', d: 'Small arrows along the streamlines showing the flow direction.' },
  'dp.vecDensity': { t: 'Vector density', d: 'Spacing of the vector arrows.' },
  'dp.vecScale': { t: 'Vector length', d: 'Length scale of the arrows.' },
  'dp.vecNorm': { t: 'Equal length', d: 'All arrows the same length: direction only.' },
  'dp.vecColor': { t: 'Colour by |V|', d: 'Colour the arrows by the speed (the field colours are then off).' },
  // zoom bar
  'zm.in': { t: 'Zoom in', d: 'Zoom in (also the mouse wheel; drag to pan).' },
  'zm.out': { t: 'Zoom out', d: 'Zoom out.' },
  'zm.fit': { t: 'Fit', d: 'Show the whole domain again (also double-click).' },
  'zm.edge': { t: 'Edge', d: 'Zoom to the metering edge.' },
  'zm.meniscus': { t: 'Meniscus', d: 'Zoom to the exit face, contact line and free surface.' },
  'zm.box': { t: 'Box zoom', d: 'Drag a rectangle to zoom to it (also Shift+drag).' },
  'zm.img': { t: 'Save as image', d: 'Save the plot(s) as PNG or SVG.' },
  // DOE
  'doe.run': { t: 'Run DOE', d: 'Solve every combination of the factor levels at the chosen location.' },
  'doe.stop': { t: 'Stop', d: 'Stop the DOE: the runs solved are kept.' },
  'doe.loc': { t: 'Location', d: 'The location whose base case (gap, contact angle, own inputs) the DOE varies.' },
  'doe.workers': { t: 'At a time', d: 'Runs solved at the same time, each on its own processor core.' },
  'doe.csv': { t: 'Export CSV', d: 'Save the runs table: factor values, outputs, status and time.' },
  'meas.import': { t: 'Import measured data', d: 'Read a CSV with a header row. Its columns are matched to quantities from their names and units (position, wet film or coat weight, contact line, surface height, edge or ripple amplitude, settings); check and change them in the preview before importing.' },
  'meas.sel': { t: 'Dataset', d: 'The measured dataset shown: its parity plot, comparison table and CSV.' },
  'meas.cfd': { t: 'Solve in CFD', d: 'Solve each point of the dataset in the 2D CFD (each different point is one run, as in the DOE; as many at a time as the DOE uses). Wet film, contact line and meniscus shape only.' },
  'meas.stop': { t: 'Stop', d: 'Stop the CFD solves of measured points (and a fit\'s check).' },
  'meas.csv': { t: 'Export CSV', d: 'Save the comparison: each point, its measured value, the fast model and the CFD with their % errors.' },
  'meas.fit': { t: 'Fit', d: 'Adjust the chosen inputs (1 to 3, within their ranges) to minimise the RMS % error of the fast model over the chosen datasets; then the best fit is solved in the CFD to check it. Nothing changes until Apply.' },
  'meas.apply': { t: 'Apply fitted values', d: 'Set the inputs to the fitted values. Undo (Ctrl+Z) takes them back.' },
  'meas.grp': { t: 'Inputs to adjust', d: 'Contact angle: the blade contact angle and its variation across the web. Rheology: viscosity, shear-thinning index, yield stress. Bead pressure. Or add any input.' },
  'meas.range': { t: 'Range searched', d: 'The fit keeps the input between these values (at most the input\'s own range). A fitted value at an end of the range means the best fit may lie beyond it.' },
  'doe.factor': { t: 'Factor', d: 'An input to vary: process and slurry inputs, blade geometry, or mesh / solver. The others stay at the base case.' },
  'doe.from': { t: 'From', d: 'Lowest level of the factor.' },
  'doe.to': { t: 'To', d: 'Highest level of the factor.' },
  'doe.levels': { t: 'Levels', d: 'Number of evenly spaced levels between From and To (2 to 5).' },
  'doe.add': { t: 'Add factor', d: 'Add another factor (up to three). Runs = the product of the levels.' },
  'doe.response': { t: 'Response', d: 'An output against one factor: a line per level of the second factor, a panel per level of the third.' },
  'doe.map': { t: 'Response map', d: 'An output over two factors: a cell per pair of levels, coloured on one scale with its value printed.' },
  'doe.effects': { t: 'Main effects', d: 'Each factor\'s mean output at each level, over all the other factors\' levels: the steeper, the stronger the factor.' },
  'doe.out': { t: 'Output', d: 'The result plotted.' },
};
// result names (metrics, mesh study, DOE outputs), by their label
const HELP_RESULTS = {
  'Rheology model': 'The viscosity law of this run.',
  'Inputs of this run': 'The inputs this location sets for itself (the rest are the shared ones).',
  'Wet film thickness, Q/U': 'Flow rate through the gap per unit width over the web speed: the wet film once it has settled.',
  'Through-flow Q': 'Volume of slurry passing the metering edge per second per unit width of web.',
  'Mean velocity at the metering edge, Q/H': 'Flow rate over the gap: the mean speed through the narrowest point.',
  'Max |V|': 'Largest speed anywhere in the domain, and where it is.',
  'Area-mean |V|': 'Speed averaged over the fluid area.',
  'Min |V| inside the fluid': 'Slowest point away from the walls: a stagnant spot where slurry can settle.',
  'Max shear rate': 'Largest shear rate, and where; next to the metering edge corner it is singular (it grows as the mesh is refined).',
  'Meniscus: contact line': 'Where the slurry surface meets the blade: pinned at the metering edge, or climbed some way up the exit face.',
  'Surface leaves the contact line at': 'Angle of the free surface where it leaves the blade, measured from the web in the machine direction.',
  'Film at the end of the 2D domain': 'Film thickness where the 2D domain ends, and how far from the edge that is.',
  'Peak pressure': 'Highest gauge pressure in the slurry, and where.',
  'Lowest pressure': 'Lowest gauge pressure (below ambient only if the slurry is sucked), and where.',
  'Pressure gradient along the web under the edge, −dp/dx': 'How fast the pressure falls along the web under the metering edge: the pressure-driven part of the flow there.',
  'Mass check: outflow vs inflow': 'Difference between the flow leaving and entering the domain: a check of the solution (should be near 0).',
  'Reverse flow, u_x < 0': 'Share of the fluid area flowing against the web direction (recirculation under the blade).',
  'Recirculation, closed streamlines': 'Area of eddies (closed streamlines) where slurry circulates and can age or settle.',
  'Stagnation, |V| < 1% of max': 'Points where the slurry nearly stops.',
  'Unyielded fluid, stress below yield': 'Share of the area where the stress is below the yield stress: slurry moving as a solid plug or at rest.',
  'Residence time, inlet to the metering edge': 'Time slurry takes from the inlet to the metering edge along equal-flux streamlines (fastest, flux-weighted mean, slowest).',
  'Viscous dissipation': 'Power turned into heat by viscous friction, per metre of width (under the blade in brackets).',
  'Reynolds number ρUH/μ(U/H)': 'Inertia over viscous forces, from the viscosity at the shear rate U/H: far below 1 means creeping flow.',
  'Reynolds number from the field, ρQ/μ̄': 'The same from the solved field: the mean viscosity of the yielded slurry under the blade.',
  'Capillary number μ(U/H)U/γ': 'Viscous over surface-tension forces at the meniscus; above about 0.1 the moving contact line matters.',
  'Capillary number at the meniscus, μ_s U/γ': 'The same from the viscosity along the free surface near the contact line.',
  'Streamline check: ψ drift along lines': 'How much the stream function changes along the drawn streamlines: a check of their tracing (should be small).',
  'Mesh': 'Elements along × across and the solver settings of this run.',
  'Solver': 'Whether the solve converged, its Newton steps, final residual and time.',
  // mesh study and DOE outputs
  'Elements': 'Number of finite elements of the mesh.',
  '−dp/dx along the web under the edge': 'How fast the pressure falls along the web under the metering edge.',
  'Contact line up the exit face': 'How far the contact line has climbed the exit face (0 = pinned at the edge).',
  'Newton steps': 'Newton iterations of the solve.',
  'Surface angle at the contact line': 'Angle of the free surface where it leaves the blade.',
  'Max shear rate away from the corner': 'Largest shear rate outside the metering edge corner\'s singular zone.',
  'Reverse flow': 'Share of the fluid area flowing against the web direction.',
  'Recirculation area': 'Area of closed-streamline eddies.',
  'Stagnation points': 'Points where the slurry nearly stops.',
  'Mean residence time to the edge': 'Flux-weighted mean time from the inlet to the metering edge.',
  'Flake flatness leaving the blade': 'The flakes\' flatness (3⟨p_y²⟩ − 1) / 2 of their normals p, over the film leaving the 2D domain: 1 all flat on the web, 0 random.',
  'Flake flatness at the oven': 'The flatness after the film has rested on the web until the oven.',
  'SEM spread, cut along the web': 'The standard deviation of the flakes\' angles to the web in a cut along the web\'s motion, at the oven.',
  'SEM spread, cut across the web': 'The same in a cut across the web.',
  'Structure λ leaving the edge': 'The structure (0 broken down, 1 built up) flux weighted where the film leaves the metering edge, and the flows the 2D took with it fed back.',
  'Crack risk, top only': 'This run\'s film followed to the peel, its water leaving from the top only: the most a crack through it frees, over its fracture energy (the Film card). 1 and above: it cracks.',
  'Crack risk, top and bottom': 'The same, the water leaving from the top and the bottom.',
  'Peel by hand (180°), top only': 'The force per width to peel this run\'s film off the web folded back (180°), its water leaving from the top only.',
  'Peel by hand (180°), top and bottom': 'The same, the water leaving from the top and the bottom.',
  'Curl settled, top only': 'How this run\'s peeled film curls once settled in the room: 1 / its radius, positive curling away from its top, negative toward it (0 flat). Its water leaving from the top only.',
  'Curl settled, top and bottom': 'The same, the water leaving from the top and the bottom.',
  'Stress on the roll, top only': 'The most stress in this run\'s film wound on the winder\'s core, its top out; above its strength (the Film card) it cracks on the roll. Its water leaving from the top only.',
  'Stress on the roll, top and bottom': 'The same, the water leaving from the top and the bottom.',
  'Blister risk, top only': 'The most a patch of this run\'s film squeezed on the web frees by lifting off it, over its hold on the web. 1 and above: it blisters or wrinkles. Its water leaving from the top only.',
  'Blister risk, top and bottom': 'The same, the water leaving from the top and the bottom.',
  'A piece\'s size change in the drying oven, top only': 'A piece cut from the roll and dried through in the drying oven, pressed flat: its size after against as cut (%), from this run\'s film, its water leaving from the top only.',
  'A piece\'s size change in the drying oven, top and bottom': 'The same, the water leaving from the top and the bottom.',
  'Graphene film\'s thickness': 'This run\'s film\'s piece (its water leaving from the top only) through the furnace\'s two runs: the graphene film\'s thickness (µm), its middle and edges averaged (the top piece of the stack).',
  'Graphene film over the GO piece, thickness': 'The graphene film\'s thickness over the GO piece\'s that went in: above 1 it came out thicker (puffed up).',
  'Graphene film\'s density': 'The graphene film\'s weight over its volume (g/cm³): graphite is 2.26; puffed up it is less.',
  'Graphene film\'s heat along it': 'The graphene film\'s heat conduction along it (W/(m·K)): a correlation, graphite\'s times its density over graphite\'s times La / (La + ℓ) (the Furnace card).',
  'Gas against its hold, run 1': 'The most the gas in the piece reaches against its layers\' hold in the first run (%): at 100 it puffs up.',
  'Gas against its hold, run 2': 'The same in the second run.',
  'Graphene film\'s thickness spread across the piece': 'The graphene film\'s thickest less its thinnest across the piece, over its mean (%): 0 is even.',
};

// ---- attaching: by id, by selector, by label ----
const HELP_BY_ID = {
  cfdR: 'cfd.R', cfdPool: 'cfd.pool', cfdExit: 'cfd.exit', cfdModel: 'cfd.model', cfdFibreSel: 'cfd.fibre', cfdGsm: 'cfd.gsm', cfdRhoF: 'cfd.rhoF',
  cfdDFrom: 'cfd.dFrom', cfdDen: 'cfd.den', cfdNf: 'cfd.nf', cfdAirPerm: 'cfd.airPerm', cfdAirDP: 'cfd.airDP', cfdKoz: 'cfd.koz', cfdAirFrac: 'cfd.airFrac',
  furnProgBtn: 'furn.btn', furnCsv: 'furn.csv', fu1: 'furn.runs', fu2: 'furn.weight', fu3: 'furn.co', fu4: 'furn.thick', fu5: 'furn.gas', fu6: 'furn.across', fuMLoc: 'furn.meas', fuMH: 'furn.meas', fuMKept: 'furn.meas', fuMK: 'furn.meas', fuMAdd: 'furn.meas',
  furnN: 'furn.N', furnPaperT: 'furn.paperT', furnMargin: 'furn.margin', furnGap: 'furn.gap', furnUnit: 'furn.unit', furnUnitOk: 'furn.unit', matFurnReset: 'matu.reset', matFurnSee: 'matu.see',
  ovzAdd: 'oven.add', dryZones: 'dry.zones', dryCsv: 'dry.csv', dryOven: 'dry.oven', dryTImport: 'dry.temps', dryTPaste: 'dry.temps', dryTOk: 'dry.temps', dryEAdd: 'dry.exit', dryELoc: 'dry.exit', dryEWater: 'dry.exit', dryEH: 'dry.exit', dryEAt: 'dry.exit', matDryReset: 'matd.reset', filmPeelBtn: 'film.peelBtn', filmCsv: 'film.csv', fm1: 'film.stress', fm2: 'film.crackRisk', fm3: 'film.peelChart', fm4: 'film.through', fm5: 'film.blister', fm6: 'film.sheet', fmCLoc: 'film.curl', fmCR: 'film.curl', fmCLift: 'film.curl', fmCSheet: 'film.curl', fmCTo: 'film.curl', fmCWhen: 'film.curl', fmCAdd: 'film.curl', fmKLoc: 'film.cracks', fmKS: 'film.cracks', fmKW: 'film.cracks', fmKWhere: 'film.cracks', fmKAdd: 'film.cracks', fmPLoc: 'film.peelF', fmPF: 'film.peelF', fmPA: 'film.peelF', fmPAdd: 'film.peelF', ovzPeelLen: 'oven.peelLen', ovzPeelCore: 'oven.core', matFilmReset: 'matf.reset', matFilmSee: 'matf.see', ovzPieceL: 'oven.pieceL', ovzPieceW: 'oven.pieceW', ovzDryT: 'oven.dryT', ovzTOven: 'oven.tOven', ovzTRest: 'oven.tRest', st1: 'stack.water', st2: 'stack.pull', shMWhen: 'sheet.size', sh1: 'sheet.free', sh2: 'sheet.table', shMLoc: 'sheet.size', shML: 'sheet.size', shMW: 'sheet.size', shMAdd: 'sheet.size', matReset: 'mat.reset', matModel: 'cfd.model', matStructOn: 'matr.structOn', matRheoReset: 'matr.reset', rtImport: 'rt.import', matOrOn: 'mato.on', matOrModel: 'mato.model', matOrReset: 'mato.reset', orRedo: 'or.redo', orCsv: 'or.csv', orAddImg: 'or.addImg', orAddTab: 'or.addTab', orPaste: 'or.paste', orImRead: 'or.read', orImWin: 'or.win', cfdMesh: 'sol.mesh', cfdTol: 'sol.tol', cfdSolverReset: 'sol.reset', cfdStudyOpen: 'sol.study', cfdZonesOpen: 'sol.zones', zoneAddBand: 'sol.band', stepMeshAcc: 'sol.acc', accRun: 'sol.acc', acc3Run: 'sol.acc',
  cfdShape: 'cfd.shape', cfd_bevelDeg: 'cfd.bevelDeg', cfd_bevelLen: 'cfd.bevelLen', cfd_edgeR: 'cfd.edgeR', cfd_inletGap: 'cfd.inletGap', cfd_land1: 'cfd.land1', cfd_stepH: 'cfd.stepH', cfd_riserDeg: 'cfd.riserDeg', cfdClModel: 'cfd.clModel', cfdEditCustom: 'cfd.custom', cfdRunAll: 'tb.run', cfdCancel: 'tb.stop', cfdViewSeg: 'tb.view', fvBase: 'tb.field', fvStream: 'tb.stream', fvVec: 'tb.vec',
  fvContours: 'tb.contours', fvFlakes: 'tb.flakes', cfdCutPlace: 'tb.cut', cfdProbePlace: 'tb.probe', imgBtn: 'tb.image', themeBtn: 'tb.theme',
  fvScale: 'dp.scale', fvContourField: 'dp.contourField', fvMesh: 'dp.mesh', fvMeshQ: 'dp.meshQ', fvDensity: 'dp.density', fvSeedMode: 'dp.seeds',
  fvDir: 'dp.dir', fvLineColor: 'dp.lineColor', fvLineW: 'dp.lineW', fvArrows: 'dp.arrows', fvVecDensity: 'dp.vecDensity', fvVecScale: 'dp.vecScale',
  fvVecNorm: 'dp.vecNorm', fvVecColor: 'dp.vecColor',
  doeRun: 'doe.run', doeStop: 'doe.stop', doeLoc: 'doe.loc', doeWorkers: 'doe.workers', doeCsv: 'doe.csv', doeOut: 'doe.out',
  measImport: 'meas.import', measSel: 'meas.sel', measCfd: 'meas.cfd', measStop: 'meas.stop', measCsv: 'meas.csv', measFitGo: 'meas.fit', measApply: 'meas.apply',
};
const HELP_BY_SELECTOR = [
  ['[data-acr-on="bow"]', 'acr.bow'], ['[data-acr-seg="bow.mode"]', 'acr.bow'], ['[data-acr-seg="bow.supports"]', 'acr.bow'], ['[data-acr^="bow."]', 'acr.bow'], ['[data-acr="crest"]', 'acr.crest'],
  ['[data-acr^="sines."]', 'acr.sines'], ['[data-acr-act="sine-add"]', 'acr.sines'], ['[data-acr-on="ends"]', 'acr.ends'], ['[data-acr^="ends."]', 'acr.ends'],
  ['[data-acr-on="meas"]', 'acr.meas'], ['[data-acr-act="meas-import"]', 'acr.meas'], ['[data-acr-on="crown"]', 'acr.crown'], ['[data-acr="crown.um"]', 'acr.crown'], ['[data-acr-seg="crown.kind"]', 'acr.crown'],
  ['[data-acr^="bladeEnds."]', 'acr.bladeEnds'], ['.acr-svg', 'acr.front'],
  ['[data-acrp="tilt"]', 'in.tilt'], ['[data-acrp="dH"]', 'in.dH'], ['[data-acrp="lw"]', 'in.lw'], ['[data-acrp="skew"]', 'in.skew'], ['[data-acrp="dt"]', 'in.dt'], ['[data-acrp="dth"]', 'in.dth'],
  ['#fvMore > summary', 'tb.display'], ['#cfdExport > summary', 'tb.export'],
  ['.rt-pick', 'rt.test'], ['.rt-x', 'rt.remove'], ['.rt-use', 'rt.use'],
  ['.zoom-ctl [data-z="in"]', 'zm.in'], ['.zoom-ctl [data-z="out"]', 'zm.out'], ['.zoom-ctl [data-z="fit"]', 'zm.fit'], ['.zoom-ctl [data-z="edge"]', 'zm.edge'],
  ['.zoom-ctl [data-z="meniscus"]', 'zm.meniscus'], ['.zoom-ctl [data-z="box"]', 'zm.box'], ['.zoom-ctl [data-z="img"]', 'zm.img'],
  ['#cfdLocs input[data-i]', 'loc.z'], ['#cfdLocs [data-edit]', 'loc.own'], ['#cfdLocs [data-run]', 'loc.run'], ['#cfdLocs [data-pick]', 'loc.pick'],
  ['#doe-design [data-fk]', 'doe.factor'], ['#doe-design [data-fmin]', 'doe.from'], ['#doe-design [data-fmax]', 'doe.to'], ['#doe-design [data-fn]', 'doe.levels'],
  ['#measFit [data-grp]', 'meas.grp'], ['#measFit [data-lo]', 'meas.range'], ['#measFit [data-hi]', 'meas.range'],
  ['select[data-ovtop]', 'oven.top'], ['#drySel [data-dry]', 'dry.film'], ['#filmSel [data-film]', 'film.film'], ['[data-filmuse]', 'film.use'], ['[data-filmdel]', 'film.remove'], ['#sheetWay [data-sheetway]', 'sheet.way'], ['#sheetWhen [data-sheetwhen]', 'sheet.when'], ['[data-sheetuse]', 'film.use'], ['[data-sheetdel]', 'film.remove'],
  ['#furnSel [data-furn]', 'furn.film'], ['[data-furnuse]', 'furn.use'], ['[data-furnfit]', 'furn.fit'], ['[data-furndel]', 'furn.remove'], ['input[data-furnstep]', 'furn.step'], ['input[data-furncool]', 'furn.cool'],
  ['[data-furnadd]', 'furn.add'], ['[data-furndelstep]', 'furn.delstep'], ['[data-furnfile]', 'furn.file'], ['[data-furnclear]', 'furn.clear'], ['#furnRoom [data-furnroom]', 'furn.room'],
  ['#doeAdd', 'doe.add'], ['#doePlotSeg [data-p="response"]', 'doe.response'], ['#doePlotSeg [data-p="map"]', 'doe.map'], ['#doePlotSeg [data-p="effects"]', 'doe.effects'],
];
/** The help of a key: title, the parts, the range line (the sidebar's inputs: from CFG). */
function helpOf(key) {
  const h = HELP[key];
  if (key.startsWith('res:')) { const d = HELP_RESULTS[key.slice(4)]; return d ? { t: key.slice(4), d } : null; }
  if (!h) return null;
  const c = key.startsWith('in.') ? CFG.find(q => q.k === key.slice(3)) : null;
  const src = c && c.h ? (/assumed/.test(c.h) ? 'assumed' : c.h) : '';
  return { ...h, t: h.t || (c ? c.l : key), r: h.r || (c ? `Range ${c.min} to ${c.max}${c.u ? ' ' + c.u : ''} · default ${c.v}${c.u ? ' ' + c.u : ''}${src ? ` · ${src}` : ''}` : '') };
}
/** Put the help keys on what the page shows now (after each render). */
function applyHelp() {
  const set = (el, key) => {
    if (!el || !helpOf(key)) return;
    el.dataset.help = key;
    if (el.title && !el.dataset.badTitle) { el.dataset.nativeTitle = el.title; el.removeAttribute('title'); }   // (the card replaces it)
  };
  // sidebar inputs (and a location's own inputs): the row's label and the number box, and an (i)
  for (const c of CFG) {
    const num = document.getElementById('n_' + c.k);
    if (!num) continue;
    const row = num.closest('.prop');
    set(num, 'in.' + c.k); set(row && row.querySelector('.prop-l'), 'in.' + c.k); addInfo(row, 'in.' + c.k);
  }
  const LOC_KEY = { gap: 'in.Hm', th: 'in.th', U: 'in.U', Pup: 'in.Pup', mu: 'in.mu', n: 'in.n', ty: 'in.ty', g: 'in.g' };
  document.querySelectorAll('input[data-li]').forEach(el => set(el, LOC_KEY[el.dataset.k]));
  document.querySelectorAll('input[data-ls], select[data-ls]').forEach(el => set(el, 'sol.' + el.dataset.k));
  for (const [id, key] of Object.entries(HELP_BY_ID)) {
    const el = document.getElementById(id);
    if (!el) continue;
    set(el, key);
    const row = el.closest('.prop');
    if (row) { set(row.querySelector('.prop-l'), key); addInfo(row, key); }
  }
  // (the slurry's card: each value by its key, its flag and its source)
  document.querySelectorAll('input[type=number][data-mk]').forEach(el => { const key = 'mat.' + el.dataset.mk; set(el, key); set(el.closest('.mat-row') && el.closest('.mat-row').querySelector('.mat-l'), key); });
  document.querySelectorAll('select[data-mk]').forEach(el => set(el, 'mat.flag'));
  document.querySelectorAll('input.mat-src[data-mk]').forEach(el => set(el, 'mat.src'));
  // (the rheology card's own values, GO-1)
  document.querySelectorAll('input[type=number][data-mr]').forEach(el => { const key = 'matr.' + el.dataset.mr; set(el, key); set(el.closest('.mat-row') && el.closest('.mat-row').querySelector('.mat-l'), key); });
  document.querySelectorAll('select[data-mr]').forEach(el => set(el, 'mat.flag'));
  document.querySelectorAll('input.mat-src[data-mr]').forEach(el => set(el, 'mat.src'));
  // (the film card's values, GO-4)
  document.querySelectorAll('input[type=number][data-mfl]').forEach(el => { const key = 'matf.' + el.dataset.mfl; set(el, key); set(el.closest('.mat-row') && el.closest('.mat-row').querySelector('.mat-l'), key); });
  document.querySelectorAll('select[data-mfl]').forEach(el => set(el, 'mat.flag'));
  document.querySelectorAll('input.mat-src[data-mfl]').forEach(el => set(el, 'mat.src'));
  // (the furnace card's values, GO-5)
  document.querySelectorAll('input[type=number][data-mfu]').forEach(el => { const key = 'matu.' + el.dataset.mfu; set(el, key); set(el.closest('.mat-row') && el.closest('.mat-row').querySelector('.mat-l'), key); });
  document.querySelectorAll('select[data-mfu]').forEach(el => set(el, 'mat.flag'));
  document.querySelectorAll('input.mat-src[data-mfu]').forEach(el => set(el, 'mat.src'));
  // (the oven's zones: each input by its field; zone 1's drying air keeps its old ids)
  document.querySelectorAll('input[data-ovk]').forEach(el => {
    const key = 'oven.' + el.dataset.ovk, row = el.closest('.prop');
    set(el, key); if (row) { set(row.querySelector('.prop-l'), key); addInfo(row, key); }
  });
  for (const q of typeof SOLVER_INPUTS !== 'undefined' ? SOLVER_INPUTS : []) {
    const el = document.getElementById('cfdS_' + q.k), row = el && el.closest('.prop');
    if (el) { set(el, 'sol.' + q.k); if (row) { set(row.querySelector('.prop-l'), 'sol.' + q.k); addInfo(row, 'sol.' + q.k); } }
  }
  for (const [sel, key] of HELP_BY_SELECTOR) document.querySelectorAll(sel).forEach(el => set(el, key));
  // result names in the tables: by their label
  document.querySelectorAll('#cfdMetrics th[scope=row], #cfdMeshStudy th[scope=row]').forEach(th => set(th, 'res:' + firstText(th)));
  document.querySelectorAll('#doe-runs thead th').forEach(th => {
    const t = firstText(th), f = typeof DOE_FACTORS !== 'undefined' && DOE_FACTORS.find(x => x.l === t);
    if (!f) { set(th, 'res:' + t); return; }
    set(th, f.kind === 'loc' ? LOC_KEY[f.k] : f.kind === 'geo' ? `cfd.${f.k === 'exitAngle' ? 'exit' : f.k}` : f.kind === 'land' ? 'in.L' : `sol.${f.k}`);
  });
}
/** The (i) button of a model-tree row (for touch; hover and focus show the card too). */
function addInfo(row, key) {
  const lab = row && row.querySelector('.prop-l');
  if (!lab || lab.querySelector('.help-i') || !helpOf(key)) return;
  const b = document.createElement('span');
  b.className = 'help-i'; b.setAttribute('role', 'button'); b.tabIndex = -1; b.dataset.help = key; b.dataset.pin = '1';
  b.setAttribute('aria-label', `About ${helpOf(key).t}`); b.textContent = 'i';
  (lab.querySelector('.pl-t') || lab).appendChild(b);
}

// ---- the card ----
const helpCard = document.createElement('div');
helpCard.className = 'help-card'; helpCard.id = 'helpCard'; helpCard.setAttribute('role', 'tooltip'); helpCard.hidden = true;
document.body.appendChild(helpCard);
let helpFor = null, helpPinned = false, helpShowT = 0, helpHideT = 0;
function showHelp(el, pinned = false) {
  const h = helpOf(el.dataset.help);
  if (!h) return;
  clearTimeout(helpHideT);
  const bad = el.getAttribute('aria-invalid') === 'true' && el.dataset.badTitle ? el.title : '';
  helpCard.innerHTML = `<b class="hc-t">${h.t}</b>${h.d ? `<p>${h.d}</p>` : ''}${h.r ? `<p class="hc-r">${h.r}</p>` : ''}${h.e ? `<p><b>Effect:</b> ${h.e}</p>` : ''}${h.u ? `<p class="hc-u">Used by: ${h.u}</p>` : ''}${bad ? `<p class="hc-bad">${bad}</p>` : ''}`;
  helpCard.hidden = false; helpFor = el; helpPinned = pinned;
  el.setAttribute('aria-describedby', 'helpCard');
  // below the control, or above if there is no room; kept inside the window
  const r = el.getBoundingClientRect(), cw = helpCard.offsetWidth, ch = helpCard.offsetHeight, m = 8;
  let top = r.bottom + 6; if (top + ch > innerHeight - m) top = Math.max(m, r.top - ch - 6);
  const left = Math.max(m, Math.min(innerWidth - cw - m, r.left));
  helpCard.style.left = left + 'px'; helpCard.style.top = top + 'px';
}
function hideHelp() {
  clearTimeout(helpShowT);
  if (helpFor) helpFor.removeAttribute('aria-describedby');
  helpCard.hidden = true; helpFor = null; helpPinned = false;
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest && e.target.closest('[data-help]');
  if (!el) return;
  if (el === helpFor) { clearTimeout(helpHideT); return; }
  if (helpPinned) return;
  clearTimeout(helpShowT);
  helpShowT = setTimeout(() => showHelp(el), 450);
});
document.addEventListener('pointerout', e => {
  const el = e.target.closest && e.target.closest('[data-help]');
  if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  clearTimeout(helpShowT);
  if (!helpPinned) helpHideT = setTimeout(hideHelp, 150);
});
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-help]'); if (el && !el.dataset.pin) showHelp(el); });
document.addEventListener('focusout', () => { if (!helpPinned) hideHelp(); });
document.addEventListener('click', e => {
  const info = e.target.closest && e.target.closest('.help-i');
  if (info) { e.preventDefault(); e.stopPropagation(); if (helpFor === info && helpPinned) hideHelp(); else showHelp(info, true); return; }
  if (helpPinned && !helpCard.contains(e.target)) hideHelp();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !helpCard.hidden) hideHelp(); });
addEventListener('scroll', () => { if (!helpCard.hidden) hideHelp(); }, true);
