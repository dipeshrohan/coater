# Cross-Web 2D CFD Analysis — implementation plan

Durable record of the plan for this feature (see repo README / app itself for
the shipped product; this file is agent/maintainer-facing planning memory,
not end-user content). Amend this file as decisions change — don't let it
drift out of sync with what's actually built.

## Status (latest first). Remaining feature list, in order:
## 11. cross-location plots, 12. convergence history plot.

### Item 10 (done): saved / named probes

Named probe points (x, y), shared by all four locations like the manual
seeds (so comparisons are like for like), kept in local storage and in
saved cases. Placed by clicking a plot ("Place by clicking the plot"
toggle; takes precedence over seed clicks) or by typing x, y; renamed in
place; deleted per probe. Drawn on every plot as a named diamond (hollow
where the point is outside that location's fluid -- geometries differ by
location). Table: |V|, u, v, p, shear rate, viscosity (unyielded marked)
per probe for the location(s) in view, read from the stored fields;
"outside the fluid" where it is in the blade or air. CSV export of the
same (probe x location rows).

### Item 9 (done): export (CSV)

Three downloads from the Flow field section, for the location in view (or
all four in the comparison view, with a location column): the field at
every node (position, velocity, pressure, shear rate, viscosity, yielded
flag, vorticity, principal strain rates and direction, dissipation, stream
function, which boundary the node is on); the boundaries per column (web:
x, p, u; top: blade / exit face / free surface x, y, p -- the free
surface's shape); and the Flow metrics table as shown (notes after " | ").
UTF-8 with BOM (units like um and degrees open correctly in spreadsheets),
9 significant digits. Checked: row counts and sampled values equal the
stored field.

### Item 8 (done): save / load cases (local storage)

A case = every input that defines a run: the sidebar's values, the CFD
tab's blade / fibre / rheology-model inputs, the four locations (position
and own inputs), plus a summary of the wet films at the time of saving
(only for runs that were up to date). Stored in the browser's local
storage (key bladeCoatDefectLab.cfdCases.v1; saving under an existing name
replaces it). Loading restores the inputs (sidebar sliders set as the reset
button does) and runs the four locations again -- results themselves are
not stored (they would be ~1 MB per case; a run takes seconds). Storage
blocked or full is reported, not silently ignored.

### Item 7 (done): rheology model dropdown

CFD tab dropdown (resolved decision: Newtonian / Power Law /
Herschel-Bulkley). It selects which of the rheology inputs the runs use,
all with the viscosity input as the value at 2.7 1/s: Newtonian mu =
mu_2.7 (n and yield stress ignored); power law mu = mu_2.7 (gd/2.7)^(n-1)
(yield stress ignored); Herschel-Bulkley as physics.js muEff. Shared by
all locations (one slurry); the unused inputs are disabled in the
per-location editor; each run records its model (first metrics row).
Validation: power-law channel vs the exact 1D solution within 0.012%
(cfd-fem.validate.js section 2).

### Item 6 (done): independent inputs per location

As the data model below planned: each location has `over` (its own
values), read first, falling back to the shared ones (the sidebar's; for
the gap and contact angle, the across-web variation at its z). Settable
per location: gap at the edge, contact angle, web speed, bead pressure,
viscosity, n, yield stress, surface tension (sidebar units). Blade and
fibre stay shared (one blade, one web). Edited from a card's "Inputs"
button in a full-width panel under the cards (empty field = shared value,
shown as the placeholder); a change marks only that location out of date;
the run keeps a snapshot of its own inputs, listed as the first row of
Flow metrics. Progress messages now refresh only the status lines, so
typing in a card is not interrupted by a running solve. Also fixed: at
phone width the page grid could not shrink below a wide compare-mode table
(`minmax(0, 1fr)`).

### Item 5 (done): remaining output fields

- Principal strain rates: eigenvalues of D = tau / (2 mu) at the nodes
  (stretching lambda1, compression lambda2, stretching direction); field
  "Principal strain rate".
- Viscous dissipation tau:D = mu gd^2: field, and totals (whole domain and
  under the blade, W per m of width, nodal-area quadrature).
- Residence time: travel time along streamlines (int ds / |V|); streamline
  colouring "Time along the line" (range capped at the 90th percentile of
  the lines' times, marked); metric: inlet to metering edge over 32
  equal-flux lines (fastest, flux-weighted mean, slowest; lines turning
  back counted).
- Re and Ca from the field, next to the representative ones:
  Re = rho Q / mu_bar (mu_bar = area mean of the yielded fluid under the
  blade); Ca at the meniscus = mu_s U / gamma (mu_s = mean over the
  yielded free-surface nodes within 5 gaps of the contact line; unyielded
  nodes are left out -- their viscosity is the regularization's).
- Validation (`cfd-fem.validate.js` section 9, Couette-Poiseuille): strain
  rates exact (1e-14), dissipation total within 0.001%, travel times exact.

### Item 4 (done): the porous fibre

User's physics: "there is no binding between fibre and slurry. The fiber
allows hot air to dry the film." So no slurry enters the fibre (the
planned Darcy penetration of slurry does not apply). Decisions (user):
Beavers-Joseph slip at the fibre surface under the blade; permeability
from the fibre structure (Kozeny-Carman); the drying air's Darcy flow,
driven by an air speed input, with an air temperature input. The air's
path through the fibre in the oven is not known (user: "I do not know"),
so its 2D pressure field is not solved -- only path-independent Darcy
numbers are reported.

- `cfd-fem.js`: `webSlip` = alpha / sqrt(k): the web's tangential velocity
  is free, with the wall stress mu (alpha / sqrt k)(u - U) as a boundary
  term (mu the local apparent viscosity, so du/dy = (alpha/sqrt k)(u - U)
  holds for any rheology); no slurry crosses the web.
- k = d^2 eps^3 / (16 K (1 - eps)^2) (Kozeny-Carman for fibres, K = 5 by
  default); inputs fibre diameter, porosity, K, alpha (defaults assumed:
  10 um, 0.85, 5, 1), air speed and temperature (1 m/s, 100 C, assumed).
- Air: Sutherland viscosity, ideal-gas density; gradient mu u / k along
  the path, the drop across the fibre thickness if it crosses it, pore
  Reynolds number rho (u/eps) d / mu (Darcy valid below ~1).
- Validation (`cfd-fem.validate.js` section 8): slip channel exact to
  1e-14; a yield-stress fluid meets the slip condition pointwise to
  0.78% -> 0.18% -> 0.044% as the rows double; coating flow with slip
  converges, conserves mass. Flat-land reference profile uses the
  solution's own wall velocity (exact for fully developed flow).

### Item 3 (done): 2D free surface / meniscus beyond the edge

The CFD tab now solves the flow under the blade, over the exit face and
into the free film, with the meniscus and its contact line, in one
finite-element system (`cfd-fem.js`; the worker runs it, the stream-
function solver `cfd-gap-solver.js` stays as an independent check in the
validation files).

Method: Galerkin FE, Taylor-Hood Q2-Q1, isoparametric; unknowns u, v, p,
the height of every free-surface spine and the contact line's distance up
the face, one Newton system (analytic flow Jacobian incl. the viscosity's
shear-rate dependence; geometry columns by finite differences of the
elements touching the moved spine). Free surface: kinematic condition +
stress balance with surface tension (weak form); gravity a body force;
inlet traction = bead pressure + hydrostatic; outlet plug flow at U.
Contact line: on the face the surface leaves it at the contact angle;
pinned at the edge while Gibbs' inequality holds.

Mesh (the delicate part, all learned the hard way):
- Every spine = cubic Hermite from its foot (vertical at the web) to its
  top with a prescribed top slope; the edge corner's spine bisects the
  re-entrant corner, the contact line's bisects the liquid wedge; face
  spines take foot, top and (slope x height) linearly between those two
  (so they can never cross them). Foot offset >= slope x height / 3, so no
  spine bends back.
- Free-surface nodes move along the static curve's normal, except within
  H of the contact line where they move parallel to the face (normal
  motion there left Newton near-singular in the thin wedge).
- Middle nodes of every element sit at the arc midpoint of its ends: an
  off-centre middle node made the end tangent (which carries the contact
  angle) first-order wrong -- the static climb error went from 1.7% to
  0.02% with that one change.
- Rows graded toward the blade/face/surface; blade spacing graded toward
  the edge; the fan layout is chosen by a small search maximizing the
  worst element's min J / max J.

Solution strategy (flow): pinned at the edge first (robust); if the
surface there is flatter than Gibbs allows, the contact line climbs:
release it on the face from a little up, starting from the pinned shape;
if Newton does not get there, hold it at trial heights (continuation from
the nearest solved height, halving failed steps) until the surface leaves
it within 20 deg of the contact angle, then release. Every new mesh is
warm-started from the previous solution interpolated onto it. Newton
falls back to a Newton homotopy R(x) = (1 - lambda) R(x0) when it stalls.
Once settled, the mesh is laid out again for the contact line's actual
height and solved again.

Validation (`cfd-fem.validate.js`, ALL PASS): Couette-Poiseuille exact
(flow rate and nodal stress to 1e-14); yield-stress / shear-thinning
channel within 0.08% of the exact 1D solution; Ghia cavity (u 0.0075,
v 0.0079, psi_min -0.10337); static meniscus climb on faces 60-120 deg
and contact 15-60 deg within 0.03% of the exact Young-Laplace value,
converging (0.024% -> 0.004% with the mesh doubled); pinned angle within
0.002 deg; coating flow: mass to 3e-5, contact angle exact, film grid-
converged to 0.015%, contact line to 0.022 mm; round entry within 0.46%
of the stream-function solver (the inlet treatments differ by ~0.4%);
yield-stress coating flow converges and conserves mass.

Known limits (stated in the app): pressure at the sharp edge corner is
singular (reported as such); static contact angle only; a surface leaving
the face within 4 deg of vertical or overhanging (face + contact <= 94
deg) is refused; forward-leaning faces with large climbs are slow.

UI: `cfd-flowviz.js` gained a curvilinear grid mode (Q2 interpolation,
point location, index-space tracing), `cfd-plot.js` draws the face to the
contact line, the free surface and the air; metrics add the meniscus,
the film at the domain end, a mass check (replaces the two-route pressure
check, which only made sense for recovered pressure); the 1D film model
continues from the end of the 2D domain to the oven. The contact angle
per location is the sidebar's, with its wetting variation, as the
Contact line tab uses it.

### Items 1-2: pressure field + round-entry domain, on a rebuilt solver

User's blade: "Round entry, metering edge and the exit is flat land at a
certain angle, interesting ones being 90 degree to metering edge". Built
as: round entry of radius R (default 100 mm) whose lowest point is the
metering edge (gap H there, the location's gap), converging from the pool
edge (default 40 mm upstream, where the bead pressure Pup acts); exit face
at the edge at an adjustable angle from the web (default 90, drawn; it
bounds the downstream meniscus, item 3). The flat land stays as an option.

**Finding that forced the rebuild.** Adding pressure exposed that the
Phase-1 non-Newtonian solver (`solveChannelNSNonNewtonian`) was not
iterating: explicit pseudo-time steps limited by the largest viscosity
(the regularized plug, thousands of times the flowing fluid's) changed
the field by almost nothing per step, so the per-step-change convergence
test passed on the starting field. That starting field was the exact 1D
profile -- the right answer for a flat gap -- so the shown results were
right, but the solve did no work and could not handle any other shape.
It is removed. `solveChannelNS` (Newtonian, validated) stays for its own
checks.

**New solver: `cfd-gap-solver.js`, `solveGapFlow`.**
- Exact generalized-Newtonian equations for the stream function in
  conservative stress form (stresses formed at nodes, then
  differentiated; the viscosity is never differentiated -- robust where it
  jumps at a yield surface).
- Boundary-fitted (sigma) grid y = eta h(x), exact chain-rule metrics.
- Implicit: banded LU with partial pivoting, exact Newton for the
  rheology (the stress Jacobian mu I + (mu_t - mu) e e^T/|e|^2 is local, so
  no extra bandwidth), backtracking line search, continuation from a
  Newtonian fluid to the real rheology and then from a smooth to the final
  regularization (gdMin = 1e-3 U/H, results insensitive to it).
- Flow rate Q is an unknown found so the web pressure drop from inlet to
  edge equals Pup (bordered system).
- Pressure recovered from the momentum equation using the solver's own
  stresses; web route (dp/dx = -d(mu omega)/dy) + vertical integration,
  and an independent route along the blade as a reported consistency
  check (Newtonian round entry 0.4% of range, default yield-stress case
  2%).
- Grid 121 x 41; about 1-2 s per location (4 in parallel Workers).

**Validation (`node cfd-gap-solver.validate.js`, all pass):** flat gap
exact Couette-Poiseuille (second order, pressure exactly linear, drop =
Pup); exact 1D yield-stress / shear-thinning solutions (Q within
0.06-0.36%, regularization 10x smaller moves Q < 0.001%); exact Stokes
wedge flow (velocity second order; pressure within ~0.1% of range but
converging slower than velocity -- stated in the check); Ghia (1982)
cavity (centreline error < 0.007 of lid speed); round entry vs Reynolds
lubrication within 0.26% (expected O(H/2R) = 0.85%), second-order grid
convergence. `cfd-flowviz.validate.js` adds a round-entry section
(streamlines never enter the curved blade, returning flow leaves toward
the pool).

**Physics results worth knowing.**
- Where the bead pressure acts matters: moving the pool edge from 20 to
  80 mm upstream raises the film by 4.8%, and lubrication theory shows the
  same dependence, so it is physics (the web builds pressure all the way
  from the pool), not numerics. The inlet condition itself (zero gradient
  vs local lubrication profile) moves Q by 0.4%.
- With the round entry and the same Pup, the film comes out about 1.72-
  1.76 mm, versus about 1.5 mm for the flat land. The Pup slider was set
  "to give 1.45 mm at default" for the flat-land lubrication model, so it
  is not calibrated for the round entry.
- With the default 5 Pa yield stress, the wide part of the entry is a
  dead zone (stress below yield, fluid at rest; ~16% of the area): no
  returning-flow vortex there, unlike a Newtonian fluid.

### Phase 2: downstream free-surface film development

Per the spec's explicit instruction to reuse an existing free-surface
method rather than invent one: `solveDownstreamFilm()` (`cfd-solver.js`)
factors out the exact thin-film flux law already implemented in
`simulation.js`'s `simStep()` (the live "Slurry animation" tab) --
`dh/dt + d/dx[U*h - (h^3/3mu)(gamma*h''' - rho*g*h')] = 0`, the standard
free-surface-film-on-a-moving-wall equation (different from the two-wall
gap flow's Couette-Poiseuille advection term, correctly so -- downstream
of the blade there's no second wall) -- into a standalone, SI-unit,
headless function, driven by this run's own real outlet flow rate Q
(from the 2D non-Newtonian solve) instead of `simulation.js`'s
closed-form `qgap()` estimate. Time-marched at the same dt=0.02s already
validated for this exact discretization, to steady state or a generous
step cap.

**Validation**: at steady state, far downstream where dh/dx->0, the flux
law reduces to U*h_inf = Q exactly -- an analytic check from mass
conservation alone, independent of this implementation. The solver hits
it to within numerical noise (0.0000-0.0001% error) at every grid
resolution tested (50/100/200/400 points) and across an 11-case
parameter battery (full speed/viscosity/surface-tension/gap range). At
the app's defaults it lands on 1.4533mm -- matching the HTML's own
documented "design wet film 1.45 mm" almost exactly, an unplanned but
reassuring cross-check that this is the right physics tied correctly to
the existing app, not a coincidence (physics.js's `filmThickness()`
computes the same h=q/U relation from its own closed-form q).

One real robustness gap found and fixed: at the true worst case within
the slider ranges (minimum web speed + maximum oven distance), the film
hadn't fully relaxed within the initial step cap -- not a bug, since
convergence time scales with the real physical residence time to the
oven (Lx/U), which is genuinely long at that combination (~1200s
simulated). Raised the step cap to comfortably cover the measured worst
case (75,567 steps, 1.1s wall-clock, off the main thread via the
Worker), re-verified it still lands on the exact analytic value there
too (4.2242mm vs. 4.2240mm exact).

The live tab shows the h(x) development curve with the h_inf reference
line, plus film-at-oven, gap-to-film ratio, and a comparison against
physics.js's own `filmThickness()` (both should agree loosely in the
regime both models are valid in, and are independent derivations, so
agreement is evidence, not circular -- observed 1-4% apart across the
cases tested, the expected size of gap between a full transient
free-surface relaxation and a closed-form single-point estimate).

### Non-Newtonian extension (Phase 1, completed after 1a/1b)

`solveChannelNSNonNewtonian()` in `cfd-solver.js` Picard-iterates the
open-channel solver: solve with the viscosity field frozen, recompute it
from the resulting local shear-rate field via the same Herschel-Bulkley
formula as `physics.js`'s `muEff()` (mirrored, not imported -- this file
stays standalone/Node-testable), repeat to convergence. Diffusion uses a
conservative (divergence-form) variable-coefficient discretization that
reduces algebraically to the original constant-nu formula when the field
is uniform -- verified as an exact regression (max diff 3.2e-4 of U
against the Phase 1b solver on the same case).

The inlet condition and the initial viscosity-field guess both come from
`solveFullyDeveloped1D()`: an exact 1D generalized-Newtonian channel
profile via a shear-stress shooting method (the total shear stress is
linear in y for any rheology, from the y-momentum balance alone; gd
inverts pointwise from the stress via the same Herschel-Bulkley formula,
with gd=0 below yield -- a real unyielded plug, not an approximation).
Reduces to the closed-form Couette-Poiseuille profile at n=1,ty=0,
verified analytically (matching coefficients) and numerically (error
~1e-9 of U).

Validation:
- 1D solver: exact Newtonian-limit reduction (PASS), correct qualitative
  direction (shear-thinning gives a flatter core, PASS), real unyielded
  plug appears when expected (PASS).
- 2D solver: Newtonian-limit regression against the Phase 1b solver
  (PASS, diff 3.2e-4 of U); grid convergence of the Picard-converged
  field against the 1D reference at increasing resolution (1.75e-2 ->
  8.5e-3 -> 5.8e-3 as fraction of U, 41x21 -> 81x41 -> 121x61); the live
  2D solve's own outlet flow rate matches its own 1D reference to 0.12%
  for a representative shear-thinning+yield case -- confirms the 2D
  solver is self-consistent, independent of whether the naive single-
  viscosity lubrication formula agrees (it doesn't have to, and often
  won't for strongly non-Newtonian fluids -- that gap is real physics,
  not error).
- Parameter battery across the full rheology slider range (n, ty) x two
  flow conditions: found one real robustness issue (a mild-shear-
  thinning case took 54s at the live grid before optimization) --
  fixed via Picard warm-starting (reuse the previous outer iteration's
  field instead of re-seeding from scratch) and inner-tolerance staging
  (loose while the viscosity field is still moving, tight once it's
  nearly settled): same case now solves in 163ms, no accuracy cost
  (final iteration always re-solved at full tolerance before returning).

### Web Workers (brought forward from Phase 4)

`cfd-worker.js` runs the solve via `importScripts('cfd-solver.js')`,
triggered because the non-Newtonian solve measured up to ~3s for some
rheology combinations -- long enough to visibly freeze the single-
threaded page, which the spec's "do not freeze the GUI" rules out. The
main thread's own `cfd-solver.js` `<script>` tag was removed since
nothing on the main thread calls it directly anymore. Cancel
(`worker.terminate()` + a fresh worker for the next run) is implemented
as a real hard stop, verified in a headless browser: Cancel button
appears immediately on Run, Run is disabled while solving, Cancel
resets state correctly and a subsequent Run still works.

### UI note: apparent-viscosity display and the unyielded plug

The apparent-viscosity chart initially broke (axis scaled to millions of
Pa·s) because `mu = ty/gd` formally diverges as gd -> 0 in a real
unyielded plug core -- confirmed not a bug by inspecting the field
directly (a genuine, physically-correct near-constant-velocity plug
region, not numerical noise). A percentile-based axis cap failed too,
since the plug can be a large enough fraction of the gap (~23% in the
case that surfaced this) to contaminate even a 90th-percentile estimate.
Fixed by using the exact 1D reference's gd (which is exactly 0 in its
unyielded region, not just small) to identify plug rows definitively,
scaling the axis off the flowing rows only, and pinning plug points to
the capped edge with a labeled line.

### Phase 1b result: open-channel (real gap) geometry validated

`solveChannelNS()` in `cfd-solver.js` extends the same streamfunction-
vorticity method to the actual metering-gap geometry: an open channel
between the moving web (bottom wall) and stationary blade land (top
wall), with a prescribed Couette-Poiseuille inflow (the exact analytic
solution for fully-developed parallel flow between the two, derived from
first principles to match physics.js's own filmThickness() sign
convention exactly) and a zero-gradient outflow. `cfd-solver.channel.
validate.js` checks it two ways, at the app's default inputs:

1. **Against the exact analytic solution.** The inlet condition IS the
   analytic profile, but the 2D solve has no knowledge that it should
   *stay* that way -- if the open boundary conditions were wrong, the
   field would drift with x. It doesn't:

   | Grid | max \|u - analytic\|, mid-channel, as % of U |
   |---|---|
   | 41x21   | 0.40% |
   | 81x41   | 0.10% |
   | 121x61  | 0.04% |
   | 161x81  | 0.02% |

   Error shrinks monotonically with grid refinement -- the same
   convergence signature as Phase 1a, at a different geometry.

2. **Against physics.js's own filmThickness() formula.** Integrated flow
   rate through the 2D solve's outlet vs. the app's existing lubrication
   formula, at increasing grid resolution: 0.41% -> 0.10% -> 0.05% ->
   0.03% -- converging toward exact agreement, as expected in the
   low-Reynolds-number regime both models assume (Re ~ 7.7e-4 at
   defaults). This is not circular: the two are independent derivations
   (a full 2D field solve vs. a depth-averaged 1D formula) that happen to
   agree where both are valid, and are expected to diverge as Re grows --
   which would be correct behavior, not a bug.

A parameter-extremes battery (11 cases spanning the full slider ranges of
speed, viscosity, pressure, land length and gap height) converged in all
cases, in 0-115ms each at 81x41. One case (max speed + max gap + min
viscosity + max pressure + min land length simultaneously, H/L=0.75)
showed 3.5% deviation from the analytic profile at 81x41 -- re-verified as
a grid-resolution artifact, not a bug, by refining the grid (3.5% -> 0.76%
-> 0.31% -> 0.17% at 81x41/161x81/241x121/321x161). This combination also
already trips the existing app's own `aspect > 0.2` lubrication-validity
warning, so a short, wide-gap channel deviating from a fully-developed
profile is physically expected there, not just numerical noise. The live
UI uses a 121x61 grid (measured 46-150ms across the same battery).

### Phase 1a result: core solver validated against an independent published benchmark

`cfd-solver.js` implements the streamfunction-vorticity Navier-Stokes method
described below. `cfd-solver.validate.js` checks it against Ghia, Ghia &
Shin (1982) — lid-driven cavity, Re=100 — not against this app's own
formulas, an independent check. Run with `node cfd-solver.validate.js [N]`.

| Grid | max error, u (vert. centerline) | max error, v (horiz. centerline) |
|---|---|---|
| 41x41  | 0.0163 | 0.0099 |
| 65x65  | 0.0120 | 0.0039 |
| 97x97  | 0.0098 | 0.0050 |
| 129x129 | 0.0091 | 0.0048 |

Error shrinks as the grid refines — the actual signature of a correctly
implemented, convergent method, not a coincidence. Under 1% deviation from
the published reference at the finest grid tested.

One real bug was caught and fixed during this validation: wall velocities
were initially being computed via a one-sided finite difference of psi
(the standard interior-point approach) instead of using the *known* exact
prescribed boundary value directly, which showed up as artificially large
error exactly at wall rows/columns (0.079 before the fix, down to 0.000 at
those exact points after). Interior-point error was unaffected by this bug.

## Resolved decisions (cited, not to be re-litigated without explicit new input)

| Decision | Answer | Evidence |
|---|---|---|
| Governing equations | **Full 2D incompressible Navier–Stokes** (inertial term included) | Explicit user override, superseding an earlier Stokes-flow proposal that was grounded in `physics.js:206`'s `Re > 1` validity check. The existing app's own model still requires low Re for *its* formulas to be valid, but the new CFD tab is not bound by that — it's expected to compute Re as a real result and may legitimately show different behavior where Re is not negligible. |
| Rheology model UI | Explicit dropdown: Newtonian / Power Law / Herschel-Bulkley | User: "Add a dropdown with 3 named choices." |
| Porous fiber | Real physics: Darcy-law numbers **and** a solved 2D pressure field inside the fiber | User: "Add both." |
| Persistence | `localStorage`, no server | User: "Can we use local storage instead of a server." |
| Solver language/location | Hand-written JavaScript, new tab in this same app, no backend, no WASM | User: "as another tab and use the same JavaScript." |
| Non-blocking execution | Web Workers (one per location; 4 Workers = real parallel "Run All 4") | Direct consequence of the spec's "Do not freeze the GUI" requirement; no existing pattern to reuse, this is a new (but standard, minimal) browser API addition. |
| Blade radius (50mm) | Stays a fixed shared constant, not per-location | Already hardcoded in existing `simulation.js` (`RB=50`), matches the app's own stated "blade diameter is 100mm." Flagged to user as reversible if they disagree. |

## Numerical method (Phase 1)

Steady 2D incompressible Navier–Stokes, streamfunction–vorticity formulation
(classical method, same family used for the standard lid-driven-cavity CFD
benchmark — not invented for this project):

- Kinematics: `∇²ψ = -ω`, `u = ∂ψ/∂y`, `v = -∂ψ/∂x` (exact, regardless of Re)
- Vorticity transport (steady): `u ∂ω/∂x + v ∂ω/∂y = ν ∇²ω` — this is the
  full nonlinear equation; the inertial (convective) term is the piece a
  Stokes-flow simplification would have dropped. It is kept per the user's
  explicit instruction.
- Wall vorticity via Thom's formula, including the *moving* wall (the web),
  which is exactly the boundary condition in the classic lid-driven-cavity
  problem — a well-documented, independently-validatable case.
- Solved via pseudo-transient relaxation: advance vorticity transport in
  pseudo-time, re-solve the streamfunction Poisson equation each step,
  update wall vorticity, iterate to a converged steady state (residual-based
  convergence, reported to the user per the spec's convergence requirements).
- First implementation pass uses constant (Newtonian) viscosity, to allow
  validation against an independent published benchmark before adding the
  variable-viscosity (Power Law / Herschel-Bulkley) extension, which requires
  an additional outer Picard loop (freeze viscosity, solve, recompute
  viscosity from the new shear-rate field via the rheology model, repeat).
  This sequencing is an implementation-risk decision, not a scope cut —
  non-Newtonian rheology is still Phase 1, just built second within it.

### Validation plan (must pass before Phase 1 is considered done)

1. **Lid-driven cavity benchmark**: run the solver on the classic square
   cavity (one moving wall) configuration at Re=100 and compare centerline
   u/v velocity profiles against the published reference values (Ghia,
   Ghia & Shin, 1982) — an independent, external correctness check, not
   just comparing the new solver against this app's own formulas.
2. **Process-relevant check**: run the solver on the actual metering-gap
   geometry/parameters at the low end of the app's speed/viscosity range
   (where Re is small) and compare integrated flow rate against the
   existing `qgap()`/`filmThickness()` lubrication formulas in `physics.js`
   — expected to agree closely in that limit; expected to diverge as Re
   grows, which is correct behavior, not a bug.

## Phased output-field mapping against the 46 requested outputs

(See prior plan discussion in conversation history for the full per-item
table; summary:)

- **Phase 1** (this gap solver): velocity/vectors/streamlines, flow rate,
  pressure + gradient + max + near-edge, all shear/strain-rate fields
  including principal strain rates, apparent viscosity + yielded/unyielded
  regions + viscous dissipation, vorticity/recirculation/stagnation/
  residence time/pathlines, Reynolds/Capillary number from the real field.
- **Phase 2**: free-surface/meniscus tracking (does not exist anywhere in
  the app today — confirmed by inspection), wet-film thickness and its
  downstream development, gap-to-film ratio.
- **Phase 3**: porous fiber coupling (penetration velocity, Darcy flux,
  penetration depth, internal pressure field, volume entering the fiber).
- **Phase 4**: the 4-location product layer (data model, run/status UI,
  comparison view, plots, probes, convergence display, export) — built once
  Phases 1-3 are validated on one location.

## Data model (Phase 4, documented now for consistency)

Reuses the existing `CFG`/`P` flat key-value pattern from `physics.js`,
extended with per-location overrides:

```js
const CFD_GLOBAL = { /* shared defaults */ };
const CFD_LOCATIONS = [
  { id: 1, label: 'Location 1', z_mm: <user-set>, overrides: {} },
  { id: 2, label: 'Location 2', z_mm: <user-set>, overrides: {} },
  { id: 3, label: 'Location 3', z_mm: <user-set>, overrides: {} },
  { id: 4, label: 'Location 4', z_mm: <user-set>, overrides: {} },
];
```
A location reads its own `overrides` first, falling back to `CFD_GLOBAL`.

## Files

**New**: `cfd-solver.js` (solver, no DOM — same convention as `physics.js`;
now exports both `solveCavityNS` (closed cavity, Phase 1a benchmark) and
`solveChannelNS` (open gap channel, Phase 1b, used live)), `cfd-ui.js`
(the new tab's UI, reusing `draw.js` utilities and existing CSS classes;
reads `P`/`gapHeight()`/`muEff()`/`RHO` directly, no separate data model
yet -- that's `cfd-model.js`, still to come with Phase 4's 4 locations).
**Touched, minimally**: entry HTML (2 new `<script>` tags), `ui.js` (one
new tab entry in `TABS` + `render()`'s dispatch array — two one-line
edits, nothing else changed).
**Untouched**: `physics.js`, `simulation.js`, `draw.js` — called, not modified.

## Flow Tracking / Streamline Visualization (user spec, added after Phase 2)

User requirement (verbatim intent): add flow-tracking **post-processing**
to the existing 2D CFD results -- streamlines (most important), velocity
vectors, pathlines only if real transient data exists, seed control
(automatic + manual), density/colour/arrow/direction controls, layer
overlays on the base field, the same for each of the 4 lateral locations
plus a synchronized 4-location comparison with shared scales, flow
metrics where well-defined, export via the existing export system if one
exists. Never re-run the solver for any visualization change. Never fake
unsupported features or invent flow regions. Also: the user found the
previous CFD tab layout did not look like CFD (a stretched raster with no
axes, colorbar or geometry) -- the result view is rebuilt as a proper
CFD post-processing view.

### What exists (inspected, not assumed)

| Question | Finding |
|---|---|
| Result structure | `solveChannelNSNonNewtonian` returns `{nx, ny, dx, dy, u, v, psi, omega, nuField, prof1D, ...}` |
| Velocity storage | row-major `Float64Array`, node (i,j) at x=i*dx, y=j*dy, j=0 web, j=ny-1 blade land |
| Mesh | uniform structured Cartesian grid over the metering-gap rectangle (land length x gap) |
| Steady vs transient | steady (pseudo-time to steady state; no time history kept) |
| Plotting library | none -- hand-written Canvas 2D (`draw.js`) |
| Existing streamlines/particles | only in `simulation.js`, from its own analytic lubrication streamfunction (closure-private, not CFD) |
| Contour plotting | one stretched raster, no axes/colorbar/geometry |
| Interactive plots | none |
| Pressure field | not computed (streamfunction-vorticity eliminates pressure) |
| Export system | none |

### Supported vs. not (and why)

- **Streamlines**: RK4 integration on bilinear interpolation of the
  structured grid (integrated in grid-index space so the step is a fixed
  fraction of a cell regardless of the ~6:1 cell aspect ratio), stopping
  at the domain boundary (which *is* the blade land / web / inflow /
  outflow in this geometry -- no interior solids exist to mask), low speed
  (< 0.1% of max), closed loop, or max length. Automatic seeds at equal
  streamfunction spacing (so line density shows flux, the standard CFD
  practice) plus seeds inside any detected recirculation region; manual
  seeds by click or x-y entry.
- **Velocity vectors**: sampled from the same interpolated field, drawn in
  the same (possibly vertically exaggerated) screen mapping as the
  streamlines so arrows stay tangent to them.
- **Pathlines: not available.** The solver is steady-state; a pathline
  needs transient data. Shown disabled with that reason, not faked.
- **Colour by pressure: not available** (not computed). Shown disabled.
- **Export: not built** -- no existing export system to extend, and the
  spec says not to create a new one. Stays open under the original spec's
  export requirement.
- **Physically important regions**: the current CFD domain is the gap
  channel only. Upstream bead, recirculation, converging entry under the
  blade and the downstream meniscus are *not in the 2D domain*, so they
  cannot be identified from the CFD result and are not labelled. Metrics
  report recirculation/stagnation honestly (typically "none" in a
  parallel channel with a favourable pressure gradient -- that is the
  correct answer for this domain, not a bug).

### Next step this makes visible (not done yet)

Extending the 2D CFD domain upstream to include the converging region
under the blade (and the bead) is what would make upstream recirculation
and flow convergence into the gap real, visible CFD results. That's a
solver-domain change (non-rectangular domain), needs its own validation,
and is recorded here as the next piece of work rather than slipped into
a visualization change.

### Status: built and validated

Files: `cfd-flowviz.js` (pure post-processing), `cfd-plot.js` (field
renderer), `cfd-ui.js` (tab), `cfd-flowviz.validate.js` (Node checks).
The 4 lateral locations are live: each uses the existing across-web gap
formula at its z (numeric mm), solved in parallel Workers, with stale-result
flagging when inputs change (never a silent re-solve).

Results:
- `node cfd-flowviz.validate.js`: 20/20 pass. On the channel, psi drifts
  by at most 0.006% of Q along traced lines, segments stay within 0.024
  degrees of the interpolated velocity, and every line stays in the
  domain and ends on the outflow. On the lid-driven cavity, the detected
  vortex centre lands 0.56 grid cells from Ghia et al.'s (0.6172, 0.7344),
  psi_min is within 0.15% of -0.10342, and eddy streamlines close on
  themselves.
- Browser checklist: 19/19 pass. Opening the tab launches exactly 4
  solves; ~35 display changes (field, density, direction, colour, width,
  scale, vectors, locations, compare) and all seed operations launch
  zero; manual seeds work by click and by x-y entry; pathlines are
  disabled; the profile charts still render; zero console errors across
  all tabs; no horizontal scroll at 390 px; dark mode flips the ramp.

### Validation plan for flow tracking

On the channel: psi constant along every traced streamline (to
interpolation error), segments tangent to the interpolated velocity,
nothing leaves the domain, forward lines end at the outflow. On the
lid-driven cavity (an independent field with real recirculation): traced
lines close on themselves, and the detected vortex centre matches the
published Ghia et al. (1982) location. Browser: control changes never
re-run the solver (worker posts counted), manual seeds work, comparison
view shares scales, existing tabs unaffected.

## Still open

- Pool edge position (default 40 mm) and round-entry radius (100 mm) are
  inputs in the CFD tab; the user's real values would replace them.
- Lateral-position format: resolved as numeric mm, matching the
  "Position across web" slider and the 0-300 mm across-web axis.
