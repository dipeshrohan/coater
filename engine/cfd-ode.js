/*
 * cfd-ode.js — one trial step of an embedded Runge–Kutta pair, for the streamline tracers' adaptive option (NUM-2:
 * cfd-flowviz.js in 2D, cfd-3d-stream.js in 3D). Dormand–Prince 5(4) (Dormand & Prince, J. Comput. Appl. Math. 6, 1980):
 * the fifth-order answer is taken, its difference from the embedded fourth-order one estimates the step's error, and the
 * next step is sized from it. Pure computation, no DOM.
 */
const ODE_DP = {
  a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
  b5: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  b4: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
};

/**
 * A trial step h from y (n numbers) of dy/ds = f(y): f(y, out) fills out (n numbers) and returns false where the field
 * gives no direction (a stagnation point), which fails the step. Returns { y: the fifth-order answer, err: the largest
 * component of its difference from the fourth-order one } or null.
 */
function odeDP45(f, y, h, n) {
  const k = [], t = new Array(n);
  for (let s = 0; s < 7; s++) {
    const a = ODE_DP.a[s];
    for (let i = 0; i < n; i++) { let v = y[i]; for (let j = 0; j < s; j++) v += h * a[j] * k[j][i]; t[i] = v; }
    const o = new Array(n);
    if (f(t, o) === false) return null;
    k.push(o);
  }
  const y5 = new Array(n);
  let err = 0;
  for (let i = 0; i < n; i++) {
    let s5 = 0, e = 0;
    for (let s = 0; s < 7; s++) { s5 += ODE_DP.b5[s] * k[s][i]; e += (ODE_DP.b5[s] - ODE_DP.b4[s]) * k[s][i]; }
    y5[i] = y[i] + h * s5; err = Math.max(err, Math.abs(h * e));
  }
  return { y: y5, err };
}
/** The next step from this one's error (its fourth-order estimate: the fifth root), between 0.2 and 5 times this one. */
const odeNextH = (h, err, tol) => h * Math.min(5, Math.max(0.2, 0.9 * Math.pow(tol / Math.max(err, 1e-300), 0.2)));
/** The adaptive integrator's defaults (in the tracer's own units: cells in 2D, elements in 3D). */
const ODE_ADAPT = { tol: 1e-6, hMax: 0.5, hMin: 1e-6 };

if (typeof module !== 'undefined' && module.exports) module.exports = { odeDP45, odeNextH, ODE_ADAPT, ODE_DP };
