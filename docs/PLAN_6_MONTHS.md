# Plan for the next 6 months (October 2026 to April 2027)

This puts the tasks in TASKS.md in order, month by month. The order follows your rules (TASKS.md, top): every
simulation runs step by step in time; only physics and chemistry that make sense; every calculation checked against an
exact formula or OpenFOAM. Each task has a GitHub issue with the same number in its title.

The months are estimates. A task that turns out bigger moves the later ones down; you are told when that happens. Every
task reaches the app through its own pull request, after the automatic review, and you are asked before anything that
already works is changed.

---

## Month 1: 10 October to 10 November 2026: finish what is open, and check the physics

**Goal**: everything already built is in the app; the mixer is checked against OpenFOAM; you have a list of what in the
app does not make physical sense, and of what does not yet run in time.

1. **Tasks 6, 7, 8, 10, 11, 12 into the app.** Built and checked; each goes in after the automatic review.
2. **Task 9: the mixer in 3D checked against OpenFOAM.** Disc alone, blades alone, both together; both programs refined
   until their numbers settle; the comparison shown on the Mixing › 3D page.
3. **Task 27: physics check of every page.** One stage at a time; each doubtful item asked as one question with a
   screenshot; removed only with your yes.
4. **Task 28: the list of calculations that do not yet run in time.** Shown on the Line page.
5. **Tasks 2b and 2c** as soon as your weighings arrive.

**You will see**: the merged pages; the mixer comparison table; one question at a time from the physics check.

---

## Month 2: 10 November to 10 December 2026: the coating in time, in 1D and behind the blade

**Goal**: the coating's 1D and the paste behind the blade run step by step in time.

1. **Task 29: the coating gap in 1D, in time.** The film leaving the blade against time as the level and speed change.
2. **Task 17: the paste behind the blade through each pulse, in time**, first in 2D: the level rising and falling, the
   film it leaves over time; checked against the 1D pulse calculation and an exact volume balance.
3. **Task 25: block meshing for the mixer**, on task 9's round division of the bowl.

**You will see**: Coating › 1D and 2D › Pool and feed with a time bar and the film against time.

---

## Month 3: 10 December 2026 to 10 January 2027: the coating in 3D in time

**Goal**: the full-width coating runs step by step in time.

1. **Task 17 in 3D**: the paste behind the blade through each pulse, across the web.
2. **Task 15: the coating in 3D, in time.** Checked: a straight blade gives the 2D answer at every slice.
3. **Task 16: paths of paste in 3D, in time.**

**You will see**: Coating › 3D with the same time controls as the 2D; where paste from each outlet ends up in the film.

---

## Month 4: 10 January to 10 February 2027: the mixer in time, and heat at the blade

**Goal**: the mixer in 3D and the coating's heat run in time.

1. **Task 18: the mixer in 3D, in time**, checked against paste starting to turn in a round bowl.
2. **Task 20: heat in the paste and the blade, and the blade's bending, in time**, in 1D, 2D and 3D (after your answer
   on what is heated or cooled).

**You will see**: Mixing › 3D with a time bar; the coating's temperature and the blade's bend against time.

---

## Month 5: 10 February to 10 March 2027: after the oven, in time

**Goal**: peeling, winding, cutting and curling run in time.

1. **Task 30: peeling and winding, in time**: peel force and tension as the film comes off, the roll building up, its
   water and heat over hours.
2. **Task 21: cutting, the knife going through the film, in time** (after your answer on what you see at the cut).
3. **Task 31: the film and the cut pieces curling, in time.**

**You will see**: Peel and wind, Cutting and the cut piece with time bars.

---

## Month 6: 10 March to 10 April 2027: graphene film, flake directions, the heap, the viewer

**Goal**: the last stages in time; the remaining physics; every picture easy to read.

1. **Task 32: graphene film heat spreading, in time.**
2. **Task 22: graphene film flatness after release, and folding** (after your answer on how you fold or test it).
3. **Task 19: direction of the flakes inside the later calculations.**
4. **Task 23: the heap of paste under each falling stream** (OpenFOAM's free-surface solver, fed back into the app).
5. **Task 24: zoom and move on every picture.**
6. **Closing check**: the task 28 table shows every calculation running in time; the task 27 list is closed.

**You will see**: every stage of the line marching in time, from mixing to graphene film.
