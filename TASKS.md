# Task list

The work still to do, in the order it is done: quick deliveries first. Every session works from this list, top down, and
keeps it up to date in each pull request. The order and the tasks change only after asking the owner.

**Size**:
- Small: about one pull request.
- Medium: one or two pull requests.
- Large: several pull requests.

**Needs from you**: what the work waits for. Questions come with screenshots of the app as it is.

| # | Task | Size | Status | Needs from you |
|---|---|---|---|---|
| 1 | Coating start-up in 1D: finish and ship | Small | In progress | Nothing |
| 2 | Dry film: the app's 16 µm against your measured 60 µm | Small | In progress | How the 60 µm was measured; which step "after unstacking" is |
| 3 | Paths of paste parcels in the 2D coating flow in time | Small to medium | To do | Nothing |
| 4 | Faster tetrahedral mesher | Small to medium | To do | Nothing |
| 5 | Materials page: check what is left of the planned redesign | Small | To do | Your answers |
| 6 | Dynamic contact angle in the 2D coating flow in time | Medium | To do | Nothing |
| 7 | Mixing: your measured data, studies, report and help | Medium | To do | Nothing to start; a real log file helps |
| 8 | Mixing: air bubbles and their removal under vacuum | Medium | To do | Nothing to start |
| 9 | Mixing 3D checked against OpenFOAM | Medium | To do | Nothing |
| 10 | Results for the whole line | Medium | To do | Your answer on the layout |
| 11 | Each input edited in one place only | Medium | To do | A yes on the list |
| 12 | Measured data in one place | Medium | To do | Your answer |
| 13 | Stage pages to one professional layout | Medium per page | To do | A yes per page |
| 14 | Coating start-up in 2D with a moving front | Large | To do | Nothing |
| 15 | Coating 3D in time | Large | To do | Nothing |
| 16 | Paths of paste parcels in 3D in time | Medium | To do | Nothing |
| 17 | Pool behind the blade in time through the pulse cycle | Large | To do | Nothing |
| 18 | Mixing 3D with the paste's inertia in time | Large | To do | Nothing |
| 19 | Film directions from the flakes' tilt in the stage solvers | Medium to large | To do | Your decision |
| 20 | Coating: heat and the blade's stress in 1D, 2D and 3D | Large | To do | What heats or cools the paste and the blade |
| 21 | Cutting: the knife itself | Large | To do | What you see at the cut |
| 22 | Graphene film: flatness after release and folding | Large | To do | Only where a detail is missing |
| 23 | The heap under each stream (free-surface solve) | Large | To do | Whether you want it |
| 24 | A full viewer on every geometry, mesh and result display | Large | To do | Answers on the list of displays |
| 25 | Structured block meshing (ANSA level) | Very large | To do | Nothing to start |

## 1. Coating start-up in 1D: finish and ship
Your choice: time starts when the web runs and the paste is fed.
- **Built and checked against exact answers**:
  - the pool filling from the first pulse;
  - the paste drawn under the blade to the edge;
  - the film starting on the web.
- **Left**:
  - the pump's pause between pulses as an input (default 0, no pause);
  - a Solve button;
  - the start-up charts on Coating › 1D › Pool and feed: the pool level, the film at the edge against time, the film
    along the web;
  - the times: paste at the edge, level up, film steady; and how much web is coated before then;
  - help, report, tests, screenshots (light, dark, phone); pull request, merge.

## 2. Dry film: the app's 16 µm against your measured 60 µm
- **Your weights** (300 × 300 mm film, 0.09 m²):

  | Step | Weight | Per m² |
  |---|---|---|
  | After cutting | 2.4 g | 26.7 g/m² |
  | After pre heat treatment | 2.0 g | 22.2 g/m² |
  | After unstacking | 1.03 g | 11.4 g/m² |

- **Found**: the app's dry coat weight is 26 g/m², so the amount of GO is right. At 60 µm, the cut film is about
  0.44 g/cm³. That is far less dense than the app takes it, which is why the app shows 16 µm.
- **Left**:
  - compare the app's masses after the pre heat treatment and after the furnace with your 2.0 g and 1.03 g;
  - ask you, with screenshots: how the 60 µm was measured, and which step "after unstacking" is;
  - change what the answers show is wrong;
  - re-check the peel and the furnace with the thicker film; tests, pull request, merge.

## 3. Paths of paste parcels in the 2D coating flow in time
- **Built**: the 2D coating flow in time (Transient) keeps the flow at every step.
- **Left**:
  - trace parcels of paste through the changing flow (pathlines);
  - trace the line of paste let out from one point (streaklines);
  - draw both on Results with the time bar, checked against exact paths.
- **Also**: the Pathlines switch now says "steady solver: not available", even after a Transient run. It changes with
  this task.

## 4. Faster tetrahedral mesher
- **Now**: the mesher's smoothing rounds rebuild the whole mesh after each round. That is about 40 % of its time (35 s
  on the full pool).
- **Left**:
  - update only where points moved, with the same quality limits;
  - compare the meshes, and the timing, before and after;
  - the mesher's tests.

## 5. Materials page: check what is left of the planned redesign
- **Then**: the workflow plan (30 Sep) had a Materials page redesign.
- **Since**: you specified the material card, now built (tabs, Method column, no source labels).
- **Maybe still open**: some planned points, for example which assumed values matter most, and engineering names with
  symbols.
- **Left**:
  - compare the plan with the page as it is;
  - show you screenshots of what differs and ask;
  - build only what you choose.

## 6. Dynamic contact angle in the 2D coating flow in time
- **Now**: not built anywhere. In a steady flow the contact line on the blade's face is at rest, so its angle cannot
  change there. In time the line moves.
- **Left**:
  - the angle changing with the contact line's speed during the 2D march (Cox–Voinov law, its length ratio an editable
    input);
  - checked against a meniscus relaxing between plates, using its exact equation;
  - the Transient page, help, report, tests.

## 7. Mixing: your measured data, studies, report and help
- **Built**: the mixer in 1D, 2D and 3D.
- **Left**:
  - import your torque or power logs, temperature logs, and the viscosity after mixing;
  - draw them over the 1D, 2D and 3D results;
  - fit the mixer's power and heat constants from the logs (optional);
  - the mixer's outputs in the DOE: flake size, lumps, pH, temperature, power;
  - report, help, project files.

## 8. Mixing: air bubbles and their removal under vacuum
You said bubbles are still seen sometimes.
- **Left**:
  - the air the disperser takes in during steps 1–3, and the bubbles' sizes;
  - their growth under the vacuum of step 4;
  - whether they rise against the paste's yield stress;
  - the air left after step 4;
  - checked against exact solutions; a result on the Mixing page and a check on the Line page.

## 9. Mixing 3D checked against OpenFOAM
- **Built**: the mixer in 3D, checked against exact solutions. The 2D is also checked against OpenFOAM.
- **Left**: check the 3D against OpenFOAM, and show the numbers on the Mixing 3D page's checks:
  - the disperser alone, in a rotating frame;
  - the planetary blades, with an overset mesh.

## 10. Results for the whole line
- **Now**:
  - Results › Summary shows the coating only: contact line, web edge, film surface;
  - the Line page has a checks table.
- **Planned (30 Sep)**: one Results page for the whole line, with the report built from the same table.
  - What it lists:
    - water left at the oven exit;
    - cracks, curl and peel force;
    - the stack's waviness;
    - the graphene film's thickness, puffing and cracks.
  - Each row shows a traffic light, the model it came from, and a link.
- **Left**: show you screenshots of both pages as they are, ask how you want it, then build.

## 11. Each input edited in one place only
- **Planned (30 Sep)**: every input has one home. Elsewhere it is shown read-only, with a link to it.
- **Left**:
  - count, with the control census, the inputs still editable in more than one place;
  - show you the list with screenshots;
  - fix the ones you agree, with undo and project files kept working.

## 12. Measured data in one place
- **Planned (30 Sep)**: all measured data imported in one place, each with its comparison:
  - rheometer, film, SEM, temperatures;
  - curl, cracks, peel;
  - furnace.
- The old places keep a link.
- **Left**: list where each kind is imported now, show you with screenshots, ask, then build.

## 13. Stage pages to one professional layout
- **Pages**: Drying, Peel and wind, Cutting, Pre heat treatment, Furnace, Graphene film.
- **Planned**:
  - no blocks of text in the main area; explanations go behind the (i) help;
  - results as aligned tables and figure tiles;
  - warnings and checks as tables.
- **Left**, per page:
  - show you a screenshot of the page now and of the change, and ask;
  - then build; one pull request per page.

## 14. Coating start-up in 2D with a moving front
After task 1.
- **What it shows**: the paste's front moving under the blade in the 2D flow in time, from the web running and the
  first pulse to the steady film.
- **Kept**: the existing "gap filled at rest" start stays as an option.
- **Checked against**: the 1D start-up and the steady 2D.

## 15. Coating 3D in time
- **What**: the 2D flow-in-time method on a 3D strip across part of the web.
- **Page**: the same Steady | Transient switch, time bar and Time tab as the 2D.
- **Cost**: of the order of an hour a run (the plan's estimate).
- **Checked**: a uniform strip in time against the 2D.

## 16. Paths of paste parcels in 3D in time
After task 15: task 3's pathlines and streaklines in the 3D flow in time.

## 17. Pool behind the blade in time through the pulse cycle
- **Now**: the 2D and 3D pools are solved at the cycle's levels.
- **Left**:
  - the pool in time through a pulse cycle, in 2D and 3D;
  - its top moving as the level rises and falls;
  - checked against the 1D cycle.

## 18. Mixing 3D with the paste's inertia in time
- **Now**: the 2D mixer marches in time with the paste's inertia. The 3D does not.
- **Left**: the same in 3D, checked as in the 2D (the spin-up against its exact series).

## 19. Film directions from the flakes' tilt in the stage solvers
- **Built**:
  - the solvers take a material's heat conduction and stiffness in its own directions;
  - the Flakes page computes how the flakes tilt.
- **Open**: whether the flakes' tilt should turn the film's directions in the Drying, Pre heat, Furnace and Graphene film
  solvers.
- **First**: ask you, with screenshots of the Flakes page and the material card.

## 20. Coating: heat and the blade's stress in 1D, 2D and 3D
Your rule: every process has thermal, stress and flow solvers.
- **Now**: the coating is solved at one temperature, with no heat. The blade's bow across the web is a beam.
- **First**: ask you, with screenshots, what heats or cools the paste and the blade on your line (the paste's temperature
  against the room; any heated or cooled part).
- **Then**, in 1D, 2D and 3D, checked against exact solutions:
  - heat in the paste and in the blade;
  - the paste's viscosity with its temperature;
  - the blade's stress and bending.

## 21. Cutting: the knife itself
- **Built (1D, 2D, 3D)**: the cut edge:
  - the stress the film's layers shed there;
  - whether the layers part at the edge;
  - the cut piece's curl.
- **Not built**: the knife pressing and drawing through the film, the tearing from it, the ruler's hold.
- **First**: ask you, with screenshots of the Cutting pages, what you see at the cut (torn edges, cracks, layers
  parting), so it is built for that.

## 22. Graphene film: flatness after release and folding
- **Your choice (earlier)**: heat spreading, flatness, bending and folding.
- **Built (1D, 2D, 3D)**: heat spreading on a heater, and its stress.
- **Left**, checked against exact solutions:
  - waviness and wrinkles after release (3D buckling);
  - how far it bends or folds before it cracks.
- **Questions**: with screenshots, only where a detail is missing (for example, how you fold or test it).

## 23. The heap under each stream (free-surface solve)
- **Now**: Pool and feed in 2D and 3D takes the heap's shape as given. The app's own solver cannot follow a narrow,
  steep heap.
- **Possible**:
  - OpenFOAM's free-surface solver on one outlet's strip: the stream falling onto the pool, the web moving, the blade;
  - from it, the heap's height and width, fed back into the 2D and 3D pages.
- **First**: ask you, with screenshots of the Pool and feed pages, whether you need it.

## 24. A full viewer on every geometry, mesh and result display
- **Your request**:
  - zoom with the wheel about the cursor, drag to pan, fit and reset, zoom box;
  - 3D rotation where the view is 3D;
  - toolbar buttons, keyboard and touch;
  - image export, and the value under the cursor.
- **First**:
  - list every display and what it supports now;
  - ask you, with screenshots, before changing any viewer that already works.
- **Then**: one shared viewer, wired everywhere.

## 25. Structured block meshing (ANSA level)
- **Your decisions (30 Sep)**: block meshing at that level (the solvers stay structured); export to Fluent, OpenFOAM and
  CGNS.
- **Left**:
  - blocks, and seeding and bias per edge;
  - size boxes, and layers per wall;
  - smoothing and quality limits, with fixes;
  - saved parameter sets, inspection, export.
