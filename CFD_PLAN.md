# Cross-Web 2D CFD Analysis — implementation plan

Durable record of the plan for this feature (see repo README / app itself for
the shipped product; this file is agent/maintainer-facing planning memory,
not end-user content). Amend this file as decisions change — don't let it
drift out of sync with what's actually built.

## Status: Phase 1 and Phase 2 complete and validated. Live in the app's
## "CFD Analysis" tab now, one location (the web centreline): the 2D gap
## solve (Newtonian + non-Newtonian, Web Workers) plus the downstream
## free-surface film development to the oven. Still open: the other 3
## lateral locations and their comparison view, porous fibre coupling,
## localStorage persistence, export.

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

## Still open

1. Numeric millimeters vs. text label vs. both, for each location's lateral
   position — not yet answered.
