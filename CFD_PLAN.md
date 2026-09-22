# Cross-Web 2D CFD Analysis — implementation plan

Durable record of the plan for this feature (see repo README / app itself for
the shipped product; this file is agent/maintainer-facing planning memory,
not end-user content). Amend this file as decisions change — don't let it
drift out of sync with what's actually built.

## Status: Phase 1 in progress (2D Navier–Stokes solver for the metering gap)

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

**New**: `cfd-solver.js` (solver, no DOM — same convention as `physics.js`),
`cfd-model.js` (the location data model), `cfd-ui.js` (the new tab's UI,
reusing `draw.js` utilities and existing CSS classes).
**Touched, minimally**: entry HTML (new `<script>` tags), `ui.js` (one new
tab entry), `styles.css` (only if a genuinely new visual pattern is needed).
**Untouched**: `physics.js`, `simulation.js`, `draw.js` — called, not modified.

## Still open

1. Numeric millimeters vs. text label vs. both, for each location's lateral
   position — not yet answered.
