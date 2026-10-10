# Task list

The work still to do, in the order it is done. Every session works from this list, top down, and keeps it up to date in
each pull request. Tasks are added, removed or reordered only after asking you. Each task is written in plain words:
what happens on your machine, what the app does today, what the task adds, and how the result is checked.

## Your rules for every task (10 Oct)
- **Every simulation runs step by step in time.** Nothing on the real line is ever truly still: the web starts, the
  paste is fed in pulses, the oven heats, the film dries, the furnace follows its program. So every calculation in the
  app marches forward in time from a starting state. A "settled" result is only what the march reaches after a long
  time, never a shortcut that skips the time.
- **Only physics and chemistry that make sense.** Anything in the app that does not follow from real physics or
  chemistry, or that rests on a number nobody can know, is listed and removed after you agree.
- **Checked against an independent answer.** Every calculation is checked against an exact formula or against another
  trusted program (OpenFOAM), and the check is shown in the app.

The 6-month plan that puts these tasks in order is in docs/PLAN_6_MONTHS.md. Each task also has a GitHub issue.

**Size**:
- Small: about one pull request.
- Medium: one or two pull requests.
- Large: several pull requests.

| # | Task | Size | Status | Needs from you |
|---|---|---|---|---|
| 7 | Mixing: your measured data, studies, report and help | Medium | Built; waiting to go into the app | Nothing |
| 8 | Mixing: air bubbles and their removal under vacuum | Medium | Built; waiting to go into the app | Nothing |
| 10 | Results for the whole line | Medium | Built; waiting to go into the app | Nothing |
| 11 | Each input edited in one place only | Medium | Built; waiting to go into the app | Nothing |
| 12 | Measured data in one place | Medium | Built; waiting to go into the app | Nothing |
| 9 | The mixer in 3D checked against OpenFOAM | Medium | Doing | Nothing |
| 27 | Physics check of every page: remove what does not make sense | Medium | To do | A yes or no on each item found |
| 28 | Every calculation runs in time: the list of what does not yet | Small | To do | Nothing |
| 29 | The coating gap in 1D, step by step in time | Medium | To do | Nothing |
| 17 | The paste behind the blade through each pulse, in time (2D and 3D) | Large | To do | Nothing |
| 15 | The coating in 3D, step by step in time | Large | To do | Nothing |
| 16 | Paths of paste in 3D, in time | Medium | To do | Nothing |
| 18 | The mixer in 3D, step by step in time | Large | To do | Nothing |
| 25 | Block meshing: the mixer (the last part) | Medium | To do | Nothing |
| 20 | Coating: heat in the paste and the blade, and the blade's bending, in time | Large | To do | What is heated or cooled at the blade, if anything |
| 30 | Peeling and winding, in time | Large | To do | Nothing |
| 21 | Cutting: the knife going through the film, in time | Large | To do | What you see at the cut |
| 31 | The film and the cut pieces curling, in time | Medium | To do | Nothing |
| 32 | Graphene film: heat spreading in time | Medium | To do | Nothing |
| 22 | Graphene film: flatness after release, and folding | Large | To do | How you fold or test it |
| 19 | Direction of the flakes inside the later calculations | Medium to large | To do | Nothing |
| 23 | The heap of paste under each falling stream | Large | To do | Nothing |
| 24 | Zoom and move on every picture | Large | To do | Nothing |
| 2b | Furnace: the weight the piece keeps (1.03 g) | Small to medium | Waiting for your weighing | One piece weighed just before and just after the furnace, and whether paper sticks to it |
| 2c | Pre heat: the piece loses 0.4 g, the app only water | Medium | Waiting for your weighing | A pre-heated piece weighed again one day later |

Removed (10 Oct, your choice): task 14, the first seconds of coating in 2D.

---

## Built, waiting to go into the app

Tasks 7, 8, 10, 11 and 12 are built and checked. Each goes into the app through its own pull request, after the
automatic code review has passed. The review service allows only a few reviews per day, so they go in one after the
other.

- **7. Mixing: your measured data, studies, report and help.** You can load your mixer's power or torque log, its
  temperature log and the viscosity measured after mixing; they are drawn over the app's 1D, 2D and 3D mixer results.
  The mixer's results (flake size, lumps, temperature, power) can be studied in the design-of-experiments page, and are
  in the report and the help.
- **8. Mixing: air bubbles and their removal under vacuum.** The disc pulls air into the paste during the first mixing
  steps. The app calculates how much air goes in and how big the bubbles are, how they grow when the vacuum is pulled in
  step 4, whether they can rise through the paste (a thick paste can hold them in place), and how much air is left after
  step 4.
- **10. Results for the whole line.** One results page for the whole line, from mixing to graphene film: water left at
  the oven exit, cracks, curl and peel force, the stack's waviness, the graphene film's thickness and cracks. Each row
  has a red, amber or green light, says which calculation it came from, and links to it. The report uses the same table.
- **11. Each input edited in one place only.** Every input (for example the web speed) can be changed on one page only.
  Everywhere else it is shown greyed out with a link to where it is changed, so two pages can never disagree.
- **12. Measured data in one place.** All your measurements (rheometer, film thickness, microscope images, temperatures,
  curl, cracks, peel force, furnace weights) are loaded on one page, each next to the app's matching result.

---

## 9. The mixer in 3D checked against OpenFOAM
- **On your machine**: the mixer has two twisted blades that travel round the bowl while each turns on its own axis, and
  a fast shaft with two toothed discs that break up the paste.
- **In the app today**: the mixer is calculated in 3D and gives the power taken by each blade and by the disc. Its
  checks so far are exact formulas (paste turning between two cylinders).
- **What the task does**: the same mixer is calculated in OpenFOAM, a free and widely trusted flow program, and the
  powers are compared:
  1. the disc alone, the blades standing still;
  2. the blades alone, the disc standing still;
  3. both together.
- **How it is judged**: both the app and OpenFOAM are run on finer and finer divisions of the bowl until their numbers
  stop changing; only those settled numbers are compared. If they differ, the cause is found and fixed in the app.
- **Where it stands (10 Oct)**: disc alone: OpenFOAM 0.019 N·m at 1 turn per 6.3 s in a paste of 1 Pa·s; the app 0.020
  to 0.028 N·m depending on the division. Both are being refined.
- **Shown in the app**: the comparison table on the Mixing › 3D page's checks.

## 27. Physics check of every page: remove what does not make sense
- **Why**: your rule that the app shows only real physics and chemistry.
- **What the task does**: every page and every calculation is read through, one stage at a time (mixing, coating,
  drying, peeling and winding, cutting, pre heat, furnace, graphene film). For each, the list records:
  - what physical law it uses and whether that law holds for your paste, film and machine;
  - every number it needs, and whether that number is measured, from a published source, or a guess;
  - anything that does not make physical sense, or rests only on a guess that changes the answer a lot.
- **Then**: you get one question at a time, with a screenshot of the page: remove it, keep it, or replace it with
  something sound. Nothing is removed without your yes.

## 28. Every calculation runs in time: the list of what does not yet
- **Why**: your rule that every simulation runs step by step in time.
- **What the task does**: a table of every calculation in the app (each stage, 1D, 2D and 3D) saying whether it already
  marches in time. Today, for example, these already do: the coating in 2D, the mixer in 1D and 2D, the pulse feeding in
  1D, drying, the pre heat stack and the furnace. These give only a settled result: the coating gap in 1D, the coating
  in 3D, the paste behind the blade in 2D and 3D, the mixer in 3D, peeling and winding, cutting, the cut piece's curl,
  and the graphene film's heat spreading.
- **Then**: each calculation that does not march in time has its own task below (tasks 15, 17, 18, 20, 21, 29 to 32).
  The table is kept on the Line page so you can always see the state.

## 29. The coating gap in 1D, step by step in time
- **On your machine**: the paste level behind the blade rises and falls with each pulse, and the web speed can change.
  The flow under the blade follows these changes over time.
- **In the app today**: the 1D gap calculation (Coating › 1D › Gap flow) gives the flow and film for one fixed level
  and speed.
- **What the task adds**: the 1D gap calculated step by step in time, with the paste level and web speed changing as
  they do on the machine, so the film thickness leaving the blade is shown against time.
- **Checked by**: when nothing changes, the march must settle at today's answer; for a sudden change in level between
  flat plates, the response over time has an exact formula.

## 17. The paste behind the blade through each pulse, in time (2D and 3D)
- **On your machine**: the paste is fed behind the blade in pulses from the outlets. Between pulses the level drops as
  the web carries paste away under the blade; each pulse raises it again.
- **In the app today**: the flow behind the blade (Coating › 2D and 3D › Pool and feed) is calculated at a few fixed
  levels, one at a time.
- **What the task adds**: the flow behind the blade calculated continuously through whole pulses, with the paste's top
  surface rising and falling, in 2D and in 3D, and the film it leaves under the blade over time.
- **Checked by**: the 1D pulse calculation already in the app (level against time); the paste's volume must balance
  exactly (paste in from the outlets = paste out under the blade + the change in level).

## 15. The coating in 3D, step by step in time
- **On your machine**: across the 620 mm of web the blade is not perfectly straight and the web's edges are free, so the
  film is not the same everywhere across the web, and it changes when the level or speed changes.
- **In the app today**: the 3D coating gives only the settled flow. The 2D slice already runs step by step in time.
- **What the task adds**: the 3D coating running step by step in time, with the same time controls as the 2D page,
  showing how the film across the whole web reacts to changes.
- **Checked by**: with a straight blade and no edges, every slice of the 3D must give the same answer as the 2D in time.
- **Cost**: about an hour of calculation per run on a normal computer.

## 16. Paths of paste in 3D, in time
- **What it is**: small portions of paste followed from behind the blade, through the gap, into the film, in 3D and over
  time, so you can see where each part of the paste ends up (for example whether paste from one outlet stays in one band
  of the film). The 2D slice already does this.
- **Needs**: task 15 first.
- **Checked by**: a portion of paste in a steady flow must follow the flow's lines exactly.

## 18. The mixer in 3D, step by step in time
- **What it is**: the 3D mixer calculated step by step in time, the blades and disc moving, including the paste's own
  momentum (the paste keeps moving for a moment after it is pushed), as the 2D mixer already does.
- **Checked by**: paste starting to turn in a round bowl has an exact formula over time; the app must follow it.
- **Needs**: task 9 first.

## 25. Block meshing: the mixer (the last part)
- **What it is**: every calculation divides its space into many small boxes. Task 25 gave you a tool to place and adjust
  those boxes yourself and to export them to Fluent and OpenFOAM. It is done for the coating, the paste behind the
  blade, drying, pre heat, furnace, the roll and graphene film.
- **Left**: the mixer, on the new round division of the bowl from task 9.

## 20. Coating: heat in the paste and the blade, and the blade's bending, in time
- **On your machine**: the paste and the blade may be warmer or cooler than the room (from mixing, the pump, or the
  building), and the blade bends under the paste's push.
- **In the app today**: the coating is calculated at one fixed temperature; the blade's bend across the web is a simple
  beam.
- **What the task adds**, in 1D, 2D and 3D, step by step in time:
  - the temperature in the paste and in the blade, and how it changes;
  - the paste getting thinner when warm and thicker when cold;
  - the blade's bending and the stress in it.
- **Needs from you**: whether anything at the blade is heated or cooled, and the paste's temperature when it arrives.
- **Checked by**: exact formulas for heat through a plate and for a bending beam.

## 30. Peeling and winding, in time
- **On your machine**: the dried film is peeled off the fibre web and wound onto a roll; the roll then sits in the room
  for hours, taking up or losing water and heat.
- **In the app today**: peeling and winding give a settled result.
- **What the task adds**: the peeling and the roll calculated step by step in time: the film's tension and peel force as
  it comes off, the roll's tightness as it builds up, and its water and temperature over the hours after.
- **Checked by**: exact formulas for heat and water entering a cylinder over time.

## 21. Cutting: the knife going through the film, in time
- **On your machine**: the dried film is cut into pieces with a knife along a ruler.
- **In the app today**: the cut edge is calculated after the cut: the stress there, whether the layers come apart, and
  the curl of the cut piece.
- **What the task adds**: the knife pressing into the film and moving along the ruler, step by step in time, and the
  tearing or cracking it can cause at the edge.
- **Needs from you**: what you see at the cut edges (clean, torn, cracked, layers parting), with a photo if possible
  (photos stay out of the app's files).
- **Checked by**: exact formulas for a blade pressing into a plate.

## 31. The film and the cut pieces curling, in time
- **On your machine**: the film and the cut pieces curl as they dry and as the room's humidity changes.
- **In the app today**: the curl is calculated as a settled shape.
- **What the task adds**: the curl developing step by step in time as water leaves or enters the film.
- **Checked by**: an exact formula for a two-layer strip bending as one layer shrinks.

## 32. Graphene film: heat spreading in time
- **On your machine (in use)**: the graphene film spreads heat away from a hot spot.
- **In the app today**: the settled temperature on a heater.
- **What the task adds**: the film warming up and cooling down step by step in time.
- **Checked by**: an exact formula for a plate heated at one spot over time.

## 22. Graphene film: flatness after release, and folding
- **On your machine**: the finished graphene film is released from its holder; it may come out wavy or wrinkled. It may
  also be bent or folded in use or in tests.
- **In the app today**: heat spreading and its stress.
- **What the task adds**, step by step in time:
  - whether the film comes out wavy or wrinkled when it is released;
  - how far it can be bent or folded before it cracks.
- **Needs from you**: how you fold or test the film.
- **Checked by**: exact formulas for a thin plate buckling and for a bent strip.

## 19. Direction of the flakes inside the later calculations
- **What it is**: the film is made of flat graphene oxide flakes. Heat flows and the film stiffens very differently
  along the flakes than across them. The app already calculates how tilted the flakes are after coating.
- **What the task adds**: that tilt is passed into the drying, pre heat, furnace and graphene film calculations, so each
  uses the right heat flow and stiffness in each direction instead of one value everywhere.
- **Checked by**: an exact formula for heat through a layered material at an angle.

## 23. The heap of paste under each falling stream
- **On your machine**: where each paste stream falls behind the blade it forms a heap on the paste already there.
- **In the app today**: the heap's shape is taken as given.
- **What the task adds**: the heap's real shape calculated step by step in time with OpenFOAM's free-surface solver
  (the stream falling, the web moving, the blade), and fed back into the paste-behind-the-blade calculations.
- **Checked by**: the paste's volume must balance; a falling stream's spread on a flat pool has published measurements.

## 24. Zoom and move on every picture
- **What it is**: every drawing and result picture in the app zooms with the mouse wheel around the mouse, moves by
  dragging, rotates if it is 3D, and shows the value under the mouse. Today some pictures can, others cannot.
- **First**: a list of every picture and what it can do now, shown to you before any working picture is changed.

## 2b. Furnace: the weight the piece keeps (1.03 g)
- **On your machine**: a piece goes into the furnace and comes out at 1.03 g.
- **In the app today**: 0.64 g. Graphene oxide is 51 % carbon (your number). In the furnace the oxygen leaves as gas
  (water, carbon monoxide, carbon dioxide) and takes some carbon with it.
- **The problem**: with 51 % carbon, chemistry allows at most 0.82 g to remain (and only if all the oxygen left as carbon
  dioxide; above 700 °C it leaves mostly as carbon monoxide, which leaves about 0.69 g). Your 1.03 g would need about
  61 % carbon. So the carbon content, the weights, or something else (paper sticking to the piece) differs from what the
  app assumes.
- **Needs from you**: one piece weighed just before and just after the furnace, and whether paper sticks to it.
- **Then**: the app's chemistry is changed only where your weights show it is wrong.

## 2c. Pre heat: the piece loses 0.4 g, the app only water
- **On your machine**: the piece goes from 2.4 g to 2.0 g in the pre heat and stays at 2.0 g for hours in the room.
- **In the app today**: the water held between the graphene oxide layers is included. After the pre heat the app's
  piece weighs 2.07 g, but it then takes water back from the room air within 1.5 hours. Yours does not.
- **Needs from you**: a pre-heated piece weighed again one day later, left in the room.
- **Then**: the app is matched to that weight.

## Done
- Materials page, what was left of the planned redesign (was task 5), your choices: the rows of a flow law or
  alignment model not chosen are hidden; the streamlines through the film and the flakes on each moved to Coating › 2D
  › Solve; Materials › Readiness ranks the assumed values that matter most (each at −20 % and +20 %, its own stage
  solved again, by the stage's main answers; about an hour at the defaults, everything put back after). The first full
  run: the dry film's packing (0.85, +20 % held at its limit 1), the graphitization peak, the GO's density and the
  stack's vapour permeability move the answers most.
- Dynamic contact angle in the 2D coating flow in time (was task 6), your choice of the viscosity at the process's
  shear: Coating › 2D › Solve › Time, the contact angle Static or Cox–Voinov (θ³ = θs³ + 9 Ca ln(L/λ), Ca = μ v / σ,
  the length ratio L/λ an input, the slip length's by default); the angle's history on the Transient page, in the
  report. Checked against a meniscus relaxing between plates (its exact equation solved apart), at the ratios the input
  takes: at L/λ 10⁶ and 10¹² the march's climb within 21 % and 14 % of it, closer as the line slows (the rest is the
  bead's own filling time, about 2 s, which that equation leaves out).
- Meshing only when you ask (was task 4b), your choices: every Mesh step has a Mesh button (Coating 2D and 3D, Pool
  and feed 3D, the stages' 1D, 2D and 3D, and the Mesh menu); nothing is meshed until it is pressed (before, the stage
  pages show the parts' outline); a mesh made for other inputs is marked out of date. Run, Solve 3D and each stage's
  Solve are greyed "Mesh first" until meshed; a Solve that solves the stage before first stops at the model without a
  mesh ("not meshed" on its bar). Solve the line solves the line's own models, which have no Mesh step, so it needs no
  mesh. Studies you start (mesh study, mesh to an accuracy, DOE, measured-data runs) still mesh each run they solve.
- Faster tetrahedral mesher (was task 4), your choice of the same meshes: 22.7 → 17.7 s on the coater's pool (85,000
  tetrahedra), every mesh identical to main's; small meshes (a few seconds) as before. A moved point is searched for
  from where it was; the surface's triangles are kept in a lookup updated as they change, instead of rebuilt. Updating
  only where points moved was built and measured (14.5 s), but where points lie on one sphere it joins them otherwise
  than a rebuild, and three checks' limits set at main's own numbers then failed; left out.
- Stage pages to one professional layout (was task 13), each with your yes: layout A, a viewer, on every stage's results
  and their 1D, 2D and 3D -- the views listed on the left, one shown large, the key values on the right; the sentences
  that explain a view behind an (i) on it; the inputs bar's drawings and notes behind an (i) in its head. Pre heat (#156),
  Drying (#157), Peel and wind (#159), Cutting (#160), Furnace (#161), Graphene film (the piece first, then across the
  piece, the stack and measured; the tiles' values and the batch in the key values). The grey box "Its own solvers"
  on Cutting and Graphene film stays as it is (your choice).
- The repository's files in folders, by kind (was task 26): app/ (the frame: menus, projects, help, report, styles),
  pages/ (one script per page), engine/ (physics and solvers), workers/, checks/, tools/, docs/; the page stays at the
  top, README.md has the map. Every check and the whole app ran the same before and after (http and opened as a file).
  `node tools/run-checks.js` runs every check; `node tools/check-paths.js` finds any file named where it is not.
- The Line page scrolls on a desktop screen (it was cut off at the Checks table).
- Paths of paste parcels in the 2D coating flow in time (was task 3): Coating › 2D › Results, the time bar's Pathlines
  and Streaklines switches, with a run in time (Solve › Time: Transient). The parcels start at the streamlines' seeds at
  t = 0. Checked against exact paths, and on a coating flow in time (rings of parcels keep their area).
- Coating start-up in 1D (was task 1): Coating › 1D › Pool and feed, "From the first pulse".
- Dry film as a gauge reads it (was task 2a): Coating › Results › Wet and dry film and the Line page show it next to the
  packed layer (63 µm against 16 µm at the defaults), from the dry film's density as a gauge reads it (Materials › Dried GO
  film, 0.44 g/cm³ from your 2.4 g piece at 60 µm). The Pulse cycle charts on Pool and feed keep their own height.
