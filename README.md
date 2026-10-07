# Blade Coat Defect Lab

Open **Blade Coat Defect Lab.html** in a browser (double-click it, or serve the folder). Nothing to install.

## Where the files are

| Folder | What is in it | Examples |
|---|---|---|
| `app/` | The application's frame: menus, project files, help, report, the results viewer, the styles | `ui.js`, `menus.js`, `project.js`, `help.js`, `report.js`, `results-viewer.js`, `styles.css` |
| `pages/` | One script per page or tab of the app (what you see and click) | `furnace-ui.js`, `sheet-ui.js`, `cfd-ui.js`, `ui-3d.js` |
| `engine/` | The physics and the solvers (no screen code) | `cfd-fem.js`, `mp-core.js`, `furnace.js`, `drying.js`, `um-tetmesh.js` |
| `workers/` | The solvers run in the background, so the page stays responsive | `cfd-worker.js`, `cfd-mp-worker.js` |
| `checks/` | The checks of every solver against independent solutions, and their test meshes | `furnace.validate.js`, `fixtures/` |
| `tools/` | Small commands for whoever changes the code | `run-checks.js`, `check-paths.js`, `build-workers.js` |
| `docs/` | Design notes | `CFD_PLAN.md` |
| `benchmarks/` | The app against OpenFOAM | `openfoam/README.md` |
| `lib/`, `fonts/` | Third-party libraries and the Inter font, unmodified | `three.min.js`, `inter-latin.woff2` |
| `proj/` | An example project file | `proj01.bcdl` |

The task list is in **TASKS.md**; the working rules in **CLAUDE.md**.

## After changing code

```
node tools/run-checks.js             every check (paths, generated files, solvers); --jobs 4 runs four at a time
node tools/run-checks.js furnace     only the checks whose names hold "furnace"
node tools/build-workers.js          after changing a worker or an engine script a worker uses
```
