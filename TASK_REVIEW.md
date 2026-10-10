# Review of the task list (10 Oct)

This is every open task on your list (the file TASKS.md), written out in plain words. For each one:
what happens on your machine, what the app does today, what the task would add, how the result would be checked,
and my opinion: keep or remove, and why.

Your rule from today is written in at the top: **every simulation must march in time** (calculate step by step
from the start, not only the final settled state).

Nothing has been changed in TASKS.md yet. Tell me which tasks to remove and I will update the list.

---

## Tasks that wait for your weighings

### 2b. Furnace: the weight the piece keeps
- **On your machine**: a piece goes into the furnace at about 2.4 g and comes out at 1.03 g.
- **In the app today**: the piece comes out at 0.64 g. The app works this out from the chemistry: graphene oxide
  is 51 % carbon (your number); in the furnace the oxygen leaves as gas and takes some carbon with it.
- **The problem**: with 51 % carbon, chemistry allows at most 0.82 g to remain. Your 1.03 g would need about 61 %
  carbon. So either the carbon content, or the weights, or something else in the furnace (paper sticking to the
  piece) is different from what the app assumes.
- **What I need**: one piece weighed just before and just after the furnace, and whether paper sticks to it.
- **My opinion**: **keep**. It is real chemistry and your measurement will settle it.

### 2c. Pre heat: the piece loses 0.4 g, the app says only water leaves
- **On your machine**: the piece goes from 2.4 g to 2.0 g in the pre heat, and stays at 2.0 g for hours afterwards
  in the room.
- **In the app today**: it includes the water held between the graphene oxide layers. After the pre heat the
  app's piece weighs 2.07 g, but it then takes water back from the room air within 1.5 hours. Yours does not.
- **What I need**: a pre-heated piece weighed again one day later, left in the room.
- **My opinion**: **keep**. Also real chemistry; your weighing decides it.

---

## Tasks I am working on

### 9. Mixer in 3D checked against OpenFOAM
- **On your machine**: the mixer has two twisted blades that go round the bowl and a fast toothed disc (two discs
  on one shaft) that breaks up the paste.
- **In the app today**: the mixer is calculated in 3D, and the app gives the power each blade and the disc takes.
- **What the task does**: run the same mixer in OpenFOAM, a free, widely trusted flow program, and compare the
  power. If the app is wrong, find out why and fix it.
- **Where it stands**: for the disc alone, OpenFOAM gives a turning force of 0.019 and the app 0.020 to 0.028,
  depending on how finely the app divides the bowl. I am making both calculations finer until the numbers stop
  changing, so the comparison is fair.
- **My opinion**: **keep**. Checking against an independent program is your own rule.

### 25. Block meshing (dividing the shapes into small boxes for the calculation)
- **What it is**: every simulation splits the space (the gap under the blade, the bowl of the mixer, the oven
  stack) into many small boxes and calculates in each. This task gave you a tool to place and adjust those boxes
  yourself, like the professional program ANSA, and export them to other programs (Fluent, OpenFOAM).
- **Where it stands**: done for the coating, the pool behind the blade, drying, pre heat, furnace, roll and graphene
  film. Only the mixer is left, and it waits for task 9.
- **My opinion**: **keep**, only the mixer part is left.

---

## Tasks that calculate things in time (your rule: every simulation marches in time)

### 14. The first seconds of coating, in 2D, step by step in time
- **On your machine**: when you start the machine, the web begins to move and the first paste drops in behind
  the blade. The gap under the blade is empty at first. The paste is pushed into the gap by the paste behind it
  and dragged by the moving web. After a few seconds it comes out on the other side of the blade and coating
  begins.
- **In the app today**: a simple calculation that treats the paste as one block sliding through the gap. It says
  the paste comes out at the blade 10.6 seconds after the first paste drops in.
- **What the task adds**: the view of the gap from the side, calculated in small time steps, showing the paste's
  leading edge moving through the gap and how fast the paste moves at every point.
- **Checked by**: (1) between two flat parallel plates the filling time is known exactly from a formula; the app
  must match it. (2) On your blade, the time must be close to the simple calculation's 10.6 seconds.
- **The difficulty**: how easily the paste's leading edge slides over a dry web and a dry blade is not known. The
  answer changes a lot with it. A stopwatch time from your machine (from the first paste dropping in to paste
  coming out at the blade) would settle it.
- **My opinion**: **keep** (it is a calculation in time). You removed it earlier because my description was
  unclear; tell me if you want it back.

### 15. Coating in 3D, step by step in time
- **On your machine**: the same as task 14 and the normal coating after it, but across the full width of the web
  (620 mm), not one slice.
- **In the app today**: the 3D coating gives only the final settled flow. The 2D coating can already march in time.
- **What the task adds**: the 3D coating marching in time, for example when the web speed or the paste level
  changes, so you see how the film across the web reacts over time.
- **Checked by**: where the blade is the same all along its length, every slice of the 3D must give the same answer
  as the 2D in time.
- **Cost**: about one hour of calculation per run on a normal computer.
- **My opinion**: **keep**, by your rule. It matters most where the blade is not straight (bent blade, the web's
  edges).

### 16. Paths of paste in 3D in time
- **What it is**: following small parcels of paste through the gap in 3D as time goes on, to see where each part of
  the paste ends up in the film. The 2D already does this.
- **Needs**: task 15 first.
- **My opinion**: **keep**, after task 15.

### 17. The paste behind the blade, through each pulse, in time
- **On your machine**: the paste is fed behind the blade in pulses from the outlets. Between pulses the level behind
  the blade drops, then rises with the next pulse.
- **In the app today**: the flow behind the blade is calculated at a few fixed levels, one at a time.
- **What the task adds**: the flow behind the blade calculated continuously through a pulse, with the paste's top
  surface rising and falling, in 2D and 3D.
- **Checked by**: the simple 1D calculation of the pulse cycle already in the app (level against time).
- **My opinion**: **keep**, by your rule.

### 18. Mixer in 3D in time
- **What it is**: the mixer calculated step by step in time in 3D, including the paste's weight carrying it on
  (its momentum), as the 2D mixer already does.
- **Checked by**: the paste starting to turn in a round bowl, which has an exact formula.
- **My opinion**: **keep**, by your rule, after task 9.

---

## Tasks that add new physics

### 19. Direction of the graphene oxide flakes inside the drying, pre heat and furnace calculations
- **What it is**: the film is made of flat flakes. Heat and stiffness are very different along the flakes and across
  them. The app already calculates how the flakes are tilted after coating. This task would feed that tilt into the
  drying, pre heat, furnace and graphene film calculations, so they use the right heat flow and stiffness in each
  direction.
- **My opinion**: **keep**. This is real physics and important for graphene film. I first need your agreement
  (with screenshots of the flake page) on how it should show.

### 20. Heat in the coating, and the stress in the blade
- **What it is**: the coating is calculated at one temperature. This task would add heat in the paste and the
  blade, the paste getting thinner when warmer, and the blade's bending and stress.
- **Physics**: if nothing on the coating station is heated or cooled, the paste stays at room temperature; the
  heat from the paste being sheared is far too small to matter. The blade's bending is already in the app (a beam).
- **My opinion**: **remove**, unless something at the coating station is heated or cooled. Is anything?

### 21. Cutting: the knife itself
- **What it is**: the app already calculates the stress at a cut edge and whether the layers come apart there. This
  task would add the knife pressing into the film and tearing it.
- **Physics**: this needs the film's tearing strength, which nobody has measured, so the result could not be
  trusted or checked.
- **My opinion**: **remove**, unless torn or cracked cut edges are a real problem for you.

### 22. Graphene film: flatness after release, and folding
- **What it is**: (a) whether the finished graphene film comes out wavy or wrinkled when it is released; (b) how far
  it can be bent or folded before it cracks.
- **My opinion**: **keep (a)**, it is a real product quality. **Remove (b)** unless you fold or bend-test the film.

### 23. The heap of paste under each falling stream
- **What it is**: where each paste stream falls behind the blade, it forms a small heap. The app takes the heap's
  shape as given. This task would calculate the heap's shape with OpenFOAM.
- **Physics**: the heap is a small local bump; it hardly changes the film the blade leaves.
- **My opinion**: **remove**.

---

## Making the app easier to use

### 24. Zoom and move on every picture
- **What it is**: every drawing and result picture in the app would zoom with the mouse wheel, move by dragging,
  rotate if 3D, and show the value under the mouse.
- **My opinion**: **keep**. Not physics, but it makes every page easier to read.

---

## Finished, waiting to go into the app

Tasks 6, 7, 8, 10, 11 and 12 are built and checked. They go into the app one by one after the automatic code review
(it is limited to a few reviews per day).

---

## Summary of my opinion

| Keep | Remove |
|---|---|
| 2b, 2c, 9, 14, 15, 16, 17, 18, 19, 22a, 24, 25 | 20 (unless something is heated), 21, 22b, 23 |
