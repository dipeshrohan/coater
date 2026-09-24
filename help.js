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
  'in.Pup': { d: 'Gauge pressure of the slurry bead upstream of the blade, pushing it into the gap. Set to give a 1.45 mm film at the defaults.', e: 'Higher: more flow through the gap, a thicker film, the contact line climbs higher.', u: 'Slurry animation, Contact line, CFD, the DOE' },
  'in.L': { d: 'Length of the flat land under the blade (the flat-land blade shape).', e: 'Longer: more resistance to the pressure-driven flow, a thinner film at a given bead pressure.', u: 'Slurry animation, Contact line, CFD (flat land), the DOE' },
  'in.th': { d: 'Contact angle of the slurry on the blade\'s exit face (wetting). Assumed.', e: 'Smaller (better wetting): the meniscus climbs further up the exit face, toward the notch corner.', u: 'Slurry animation, Contact line, CFD, the DOE' },
  'in.face': { d: 'Length of the blade\'s exit face from the metering edge up to the notch corner. Measure it on the blade.', e: 'Shorter: the contact line reaches the corner, and the slurry the dry edge, sooner.', u: 'Slurry animation, Contact line' },
  // across the web
  'in.dH': { d: 'Amplitude of the sinusoidal variation of the gap along the blade (blade straightness, deflection).', e: 'Larger: the local gap, film and contact line vary more across the web.', u: 'Slurry animation, Contact line, CFD (the locations\' gaps)' },
  'in.lw': { d: 'Wavelength of that gap variation along the blade.', e: 'Sets where across the web the gap is widest and narrowest.', u: 'Slurry animation, Contact line, CFD (the locations\' gaps)' },
  'in.dt': { d: 'Random variation of the fibre thickness across the web.', e: 'Larger: the local gap varies more, adding irregular streaks.', u: 'Slurry animation, Contact line, CFD (the locations\' gaps)' },
  'in.dth': { d: 'Variation of the contact angle along the blade, e.g. from contamination or dried residue.', e: 'Larger: the contact line climbs unevenly, and reaches the corner first where wetting is best.', u: 'Slurry animation, Contact line, CFD (the locations\' contact angles)' },
  // web edge and film
  'in.a0e': { d: 'Size of the irregularity of the film edge as it leaves the blade.', e: 'Larger: the edge disturbance (Rayleigh–Plateau type growth) reaches a visible size sooner.', u: 'Web edge' },
  'in.lam': { d: 'Wavelength of the ripple left on the film surface.', e: 'Longer: much slower levelling (the rate falls with the fourth power of the wavenumber).', u: 'Film surface' },
  'in.vib': { d: 'Amplitude of the ripple from blade or web vibration.', e: 'Larger: a larger starting ripple to level before the oven.', u: 'Film surface' },
  // CFD: blade geometry
  'cfd.shape': { t: 'Blade entry', d: 'Shape of the blade underside ahead of the metering edge: a round entry (a radius) or a flat land.', e: 'Changes how the pressure builds up in the converging gap.', u: 'CFD, the DOE' },
  'cfd.R': { t: 'Radius', d: 'Radius of the curved blade underside (round entry).', r: 'Range 10 to 500 mm · default 100 mm', e: 'Larger: a longer, flatter converging gap.', u: 'CFD, the DOE' },
  'cfd.pool': { t: 'Pool edge upstream', d: 'How far upstream of the metering edge the slurry pool begins: where the 2D domain starts. At most 0.8 × the radius is used.', r: 'Range 5 to 150 mm · default 40 mm', e: 'Further: a longer domain under the blade.', u: 'CFD, the DOE' },
  'cfd.exit': { t: 'Exit face to the web', d: 'Angle between the blade\'s exit face and the web, measured in the slurry (90° = vertical face).', r: 'Range 30 to 150° · default 90°. With the contact angle it must total 94 to 175°.', e: 'Changes where the meniscus sits and how far the contact line climbs.', u: 'CFD, the DOE' },
  'cfd.model': { t: 'Rheology model', d: 'The viscosity law: Newtonian (constant), Power law (shear-thinning, n) or Herschel–Bulkley (yield stress + power law).', e: 'Which of n and the yield stress the CFD uses.', u: 'CFD, the DOE' },
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
  // CFD: drying air
  'cfd.airU': { t: 'Air speed up into the fibre', d: 'Speed of the oven\'s drying air driven up through the fibre. Assumed.', r: 'Range 0 to 50 m/s', u: 'CFD fibre results (drying air)' },
  'cfd.airT': { t: 'Air temperature', d: 'Temperature of the drying air (sets its viscosity and density). Assumed.', r: 'Range 0 to 400 °C', u: 'CFD fibre results (drying air)' },
  'cfd.plenum': { t: 'Plenum length', d: 'Length of the air plenum under the fibre in the oven. Assumed.', r: 'Range 1 to 5000 mm', u: 'CFD fibre results (drying air)' },
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
  // CFD: locations
  'loc.z': { t: 'Position across the web', d: 'Where across the web this location is (0 to 300 mm): it sets its gap and contact angle from the across-web variation.', u: 'CFD' },
  'loc.own': { t: 'Inputs for this location only', d: 'Open the location\'s own inputs and solver settings: set a value here to override the shared one for this location only.' },
  'loc.run': { t: 'Run this location', d: 'Solve this location with its current inputs.' },
  'loc.pick': { t: 'Show this location', d: 'Show this location\'s field in the viewport.' },
  // CFD toolbar
  'tb.run': { t: 'Run all 4', d: 'Solve the four locations (each in its own worker, at the same time). Ctrl+Enter.' },
  'tb.stop': { t: 'Stop', d: 'Stop the solves running (the results already there are kept) and any mesh study.' },
  'tb.view': { t: 'Location shown', d: 'Show one location, all four one above the other (Compare), or the change between two (Diff, B − A).' },
  'tb.field': { t: 'Field', d: 'The quantity coloured over the flow domain (velocity, shear rate, viscosity, pressure, vorticity, strain rate, dissipation) or none.' },
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
};

// ---- attaching: by id, by selector, by label ----
const HELP_BY_ID = {
  cfdR: 'cfd.R', cfdPool: 'cfd.pool', cfdExit: 'cfd.exit', cfdModel: 'cfd.model', cfdFibreSel: 'cfd.fibre', cfdGsm: 'cfd.gsm', cfdRhoF: 'cfd.rhoF',
  cfdDFrom: 'cfd.dFrom', cfdDen: 'cfd.den', cfdNf: 'cfd.nf', cfdAirPerm: 'cfd.airPerm', cfdAirDP: 'cfd.airDP', cfdKoz: 'cfd.koz', cfdAirFrac: 'cfd.airFrac',
  cfdAirU: 'cfd.airU', cfdAirT: 'cfd.airT', cfdPlenum: 'cfd.plenum', cfdMesh: 'sol.mesh', cfdTol: 'sol.tol', cfdSolverReset: 'sol.reset', cfdStudyOpen: 'sol.study',
  cfdShape: 'cfd.shape', cfdRunAll: 'tb.run', cfdCancel: 'tb.stop', cfdViewSeg: 'tb.view', fvBase: 'tb.field', fvStream: 'tb.stream', fvVec: 'tb.vec',
  fvContours: 'tb.contours', cfdCutPlace: 'tb.cut', cfdProbePlace: 'tb.probe', imgBtn: 'tb.image', themeBtn: 'tb.theme',
  fvScale: 'dp.scale', fvContourField: 'dp.contourField', fvMesh: 'dp.mesh', fvMeshQ: 'dp.meshQ', fvDensity: 'dp.density', fvSeedMode: 'dp.seeds',
  fvDir: 'dp.dir', fvLineColor: 'dp.lineColor', fvLineW: 'dp.lineW', fvArrows: 'dp.arrows', fvVecDensity: 'dp.vecDensity', fvVecScale: 'dp.vecScale',
  fvVecNorm: 'dp.vecNorm', fvVecColor: 'dp.vecColor',
  doeRun: 'doe.run', doeStop: 'doe.stop', doeLoc: 'doe.loc', doeWorkers: 'doe.workers', doeCsv: 'doe.csv', doeOut: 'doe.out',
};
const HELP_BY_SELECTOR = [
  ['#fvMore > summary', 'tb.display'], ['#cfdExport > summary', 'tb.export'],
  ['.zoom-ctl [data-z="in"]', 'zm.in'], ['.zoom-ctl [data-z="out"]', 'zm.out'], ['.zoom-ctl [data-z="fit"]', 'zm.fit'], ['.zoom-ctl [data-z="edge"]', 'zm.edge'],
  ['.zoom-ctl [data-z="meniscus"]', 'zm.meniscus'], ['.zoom-ctl [data-z="box"]', 'zm.box'], ['.zoom-ctl [data-z="img"]', 'zm.img'],
  ['#cfdLocs input[data-i]', 'loc.z'], ['#cfdLocs [data-edit]', 'loc.own'], ['#cfdLocs [data-run]', 'loc.run'], ['#cfdLocs [data-pick]', 'loc.pick'],
  ['#doe-design [data-fk]', 'doe.factor'], ['#doe-design [data-fmin]', 'doe.from'], ['#doe-design [data-fmax]', 'doe.to'], ['#doe-design [data-fn]', 'doe.levels'],
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
  if (!lab || lab.querySelector('.help-i')) return;
  const b = document.createElement('span');
  b.className = 'help-i'; b.setAttribute('role', 'button'); b.tabIndex = -1; b.dataset.help = key; b.dataset.pin = '1';
  b.setAttribute('aria-label', `About ${helpOf(key).t}`); b.textContent = 'i';
  lab.appendChild(b);
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
