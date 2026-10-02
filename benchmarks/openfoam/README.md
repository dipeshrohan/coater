# Coating › 3D against OpenFOAM

An independent check of the app's 3D coating-flow solver (`cfd-fem3d.js`: steady Navier–Stokes, Taylor–Hood Q2–Q1
finite elements, free surface, contact line) with **OpenFOAM v1912** (`simpleFoam`, finite volumes, SIMPLEC), on the
same domain, the same slurry and the same boundary conditions.

## What is compared

1. `exp3d.js` runs the app's own Coating › 3D strip solve in the browser (as a user would) and saves its mesh, its
   fields (u, v, w, p at every node) and its inputs.
2. `ofstrip.py` writes that domain as an OpenFOAM case: the app's nodes are the hex mesh's vertices (refined further
   with `refineMesh`). Patches and conditions are the app's:

   | Patch | App (`cfd-fem3d.js`) | OpenFOAM |
   |---|---|---|
   | web | moving at U (and along the blade when skewed) with Beavers–Joseph/Navier slip, b = 1/webSlip (3 µm) | `partialSlip`, refValue the web's velocity, valueFraction 1/(1 + b·δ) per face (exact: `couette.py`) |
   | blade, exit face | no slip | `noSlip` |
   | free surface | solved (kinematic + stress conditions) | the app's solved shape, `slip` (no flow through, no shear) |
   | inlet (pool edge) | traction p = Pup − ρgy, no flow up (v = 0); w = 0 unless skewed | p + ρgy = Pup (gravity in the modified pressure); `directionMixed`: v (and w) fixed 0 |
   | outlet | the film moving with the web (plug) | `fixedValue` (U, 0, W) |
   | strip sides | symmetry planes (held at the infinite-blade solution when skewed) | `symmetry` (`cyclic` when skewed) |
   | viscosity | Herschel–Bulkley at √(γ̇² + γ̇min²) | `strainRateFunction` with a table of the app's own law |

3. `compare.py` reads OpenFOAM's result files and compares u, v, w and p at every interior node of the app's mesh
   (OpenFOAM's value there: the inverse-distance mean of the cells round the node). (This Debian build's function
   objects — `sample`, `probes` — fail with an internal SHA1 error, so the files are read directly.)

What it does not check: the free surface's *shape* (it is fixed at the app's in OpenFOAM). It checks the flow and the
pressure the app solves in that domain.

## Results (October 2026, app at main 4508269)

| Case | u: RMS diff / U | p: RMS diff / range | max \|w\| app / OpenFOAM (mm/s) | \|w\|/\|u\| app / OpenFOAM | w pattern correlation |
|---|---|---|---|---|---|
| Default blade, OpenFOAM 7,040 cells | 3.39 % | 4.11 % | 0.012 / 0.023 | 0.22 % / 0.41 % | 0.79 |
| Default blade, OpenFOAM 56,320 cells | 2.18 % | 2.88 % | 0.012 / 0.019 | 0.22 % / 0.35 % | 0.82 |
| Wavy blade (gap 1.41–2.00 mm across the strip), 56,320 cells | 2.12 % | 2.68 % | 0.233 / 0.233 | 4.11 % / 4.15 % | 0.995 |
| Blade skewed 5°, 56,320 cells | 2.24 % | 2.81 % | 0.407 / 0.407 | 7.68 % / 7.64 % | 0.9994 |

By region (56,320 cells; RMS differences):

| Region | Default u / p | Wavy u / p | Skewed u / p |
|---|---|---|---|
| The pool upstream | 0.32 % / 0.26 % | 0.32 % / 0.24 % | 0.31 % / 0.19 % |
| Under the blade | 0.35 % / 0.30 % | 0.35 % / 0.30 % | 0.34 % / 0.23 % |
| The metering corner, exit face and contact line | 5.5 % / 6.0 % | 5.4 % / 5.6 % | 5.7 % / 6.0 % |
| The film after the contact line | 1.6 % / 3.4 % | 1.6 % / 3.1 % | 1.7 % / 3.2 % |

Reading them:

- Where the flow is smooth, the two codes agree to about 0.3 %. The differences sit at the sharp metering corner and
  the contact line, where the flow is singular; they fall as OpenFOAM's mesh is refined (7,040 → 56,320 cells: u
  3.4 → 2.2 %, p 4.1 → 2.9 %), the trend of two methods meeting at the same answer.
- Cross-web flow: in the default case both codes find almost none (w ≈ 0.2–0.4 % of u): the strip's gap varies only
  1.718–1.727 mm across it and its sides are symmetry planes, so the flow is nearly two-dimensional, and the 3D
  streamlines run straight. Where the geometry drives cross-web flow — a gap varying across the web, a skewed blade —
  both codes find it, of the same size (0.233 and 0.407 mm/s) and the same pattern (correlations 0.995 and 0.9994).
  `results/w_maps.png` shows w at half the gap, seen from above; `results/app_streamlines_top.png` the app's own
  streamlines for the three cases.

## Running it

Needs OpenFOAM v1912 (`apt install openfoam` on Ubuntu 24.04), Python 3 with numpy (matplotlib for the maps),
Node with Playwright, and the app served at a port (`python3 -m http.server 8795` in the repository).

```
node exp3d.js default.json 8795
node exp3d.js wavy.json 8795 '{"P":{"dH":300,"lw":40},"acr":{"crest":27.5}}'
node exp3d.js skew5.json 8795 '{"P":{"dH":0,"dt":0,"dth":0,"tilt":0},"skew":5}'
python3 couette.py                       # the slip condition against its exact solution
python3 ofstrip.py default.json def_r1 1 # the case, refined once (0, 1, 2: 7,040 / 56,320 / 450,560 cells)
./runof.sh def_r1 4                      # simpleFoam on 4 cores
python3 compare.py default.json def_r1   # the table's row
python3 plotw.py                         # the maps (def_r1, wavy_r1, skew_r1)
```
