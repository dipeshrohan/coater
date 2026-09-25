# Third-party libraries (unmodified)

| File | Library | Version | Licence |
|---|---|---|---|
| three.min.js, OrbitControls.js | three.js (https://threejs.org) | r147 | MIT (LICENSE.three.txt) |
| occt-import-js.js, occt-import-js.wasm | occt-import-js (https://github.com/kovacsv/occt-import-js), built on Open CASCADE Technology | 0.0.23 | LGPL-2.1 (LICENSE.occt-import-js.txt, LICENSE.occt.txt) |
| occt-import-js.wasm.js | the same occt-import-js.wasm as base64 text (written by build-occt.js), for the app opened as a file, where the browser won't fetch the .wasm | 0.0.23 | as above |

Flow › 3D loads three.js when the 3D page first opens, and occt-import-js only when a STEP file is imported.
