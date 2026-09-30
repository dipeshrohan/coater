# Working rules for this repository (from the owner)

## Asking
- Do not assume. Any assumption is wrong by default: ask good questions (not obvious ones) before changing anything that already works.
- Take snapshots while asking such questions, otherwise it is not a question: every question about the app shows real screenshots of what is there now (and of the change, when it exists).
- Show real app output, never an imagined one.

## Changing the app
- Physics and simulation are the core. Every process has 1D, 2D and 3D multiphysics solvers (thermal, stress, strain, fluid flow, ...), checked against independent solutions.
- Test everything; never break or delete a feature. Check every implementation: the application must not break.
- Pages look like professional software and are easy to understand: no pages of plain text, no garbage layouts, no random boxes.
- Holder photos never go into the app; defect photos stay out of the repository.

## Shipping
- Everything reaches main through a pull request, squash merged.
- After every merge, tell the owner to re-download main (https://github.com/dipeshrohan/coater/archive/refs/heads/main.zip) or run `git pull`.
- Give short, frequent status updates.
