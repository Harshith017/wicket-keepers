// Every ball bowled reaches the batter, even when the tracker loses it on the way (the batter's
// whites, a few pixels of ball at 20 m, a busy phone dropping frames). Taking the last point seen
// as the arrival makes the flight too short and the speed far too high. Instead, a delivery is
// fitted to the part of the flight that was seen (speed out of the hand, where it pitches, the
// line it starts on, when it left the hand) and the time it reaches the batter is read off it.

import { project } from './geometry.js';
import { CONTACT_AHEAD } from './bowling.js';
import { generateDelivery } from './sim.js';

let bank = null, bankL = null;
const RATE = 240;

/** Simulated deliveries to match against, made once per pitch length. */
function deliveries(L) {
  if (bank && bankL === L) return bank;
  bank = []; bankL = L;
  for (let kmh = 50; kmh <= 150; kmh += 2.5) for (const len of [2, 3, 4, 5, 6, 7, 8, 9, 10]) for (const x0 of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const d = generateDelivery(L, () => 0.5, { speed: kmh / 3.6, length: len, x0, line: 0, ax: 0, turn: 0, play: false });
    let ta = null;
    for (let t = 0; t < 2; t += 1 / 600) if (d.posAt(t)[1] <= CONTACT_AHEAD) { ta = t; break; }
    if (!ta) continue;
    // kept small for a phone: 240 positions a second, to a little past the batter
    const n = Math.ceil((ta + 0.1) * RATE) + 1, xyz = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) xyz.set(d.posAt(i / RATE), 3 * i);
    bank.push({ kmh, len, ta, at: (t) => { const i = Math.min(n - 1, Math.max(0, Math.round(t * RATE))); return [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]]; } });
  }
  return bank;
}

function solve3(A, y) {
  const M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j < 4; j++) M[r][j] -= k * M[c][j]; }
  }
  return [0, 1, 2].map((i) => M[i][3] / M[i][i]);
}

/** Builds the table of simulated deliveries ahead of time (a fraction of a second on a phone). */
export const prepareFlights = (L) => { deliveries(L); };

/** Lost short of the batter: the fitted flight gets there this long (s) after it was last seen. */
export const LOST_SHORT = 0.08;

/**
 * The delivery that best fits the tracked points: { tRelease, tArrive, kmh, err } (err: a typical
 * distance in pixels between the points and the fitted flight), or null for too few points.
 */
export function fitFlight(obs, cam, L) {
  if (obs.length < 5) return null;
  let best = null;
  const n = obs.length, e = new Array(n), du = new Array(n), dv = new Array(n);
  const t0 = obs[0].t, tt = obs.map((o) => o.t - t0);
  // Swing, turn and the line it is bowled on move the ball sideways in the picture: across, only
  // the shape of its path after a smooth drift (a + b t + c t^2) is removed is compared. Up the
  // picture (its height and distance from the lens) is compared as it is.
  const detrend = (r) => {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
    for (let i = 0; i < n; i++) { const x = [1, tt[i], tt[i] * tt[i]]; for (let a = 0; a < 3; a++) { y[a] += x[a] * r[i]; for (let b = 0; b < 3; b++) A[a][b] += x[a] * x[b]; } }
    const c = solve3(A, y);
    if (c) for (let i = 0; i < n; i++) r[i] -= c[0] + c[1] * tt[i] + c[2] * tt[i] * tt[i];
  };
  for (const m of deliveries(L)) for (let lag = 0; lag <= 0.15; lag += 1 / 120) {
    const tr = obs[0].t - lag;
    for (let i = 0; i < n; i++) { const q = project(cam, m.at(obs[i].t - tr)); du[i] = obs[i].u - q[0]; dv[i] = obs[i].v - q[1]; }
    if (n >= 6) detrend(du);
    for (let i = 0; i < n; i++) e[i] = Math.hypot(du[i], dv[i]);
    const s = e.slice().sort((a, b) => a - b);
    const c = s[s.length >> 1] + 0.5 * s[Math.floor(s.length * 0.8)];
    if (!best || c < best.c) best = { c, m, tr };
  }
  return { tRelease: best.tr, tArrive: best.tr + best.m.ta, kmh: best.m.kmh, err: best.c / 1.5 };
}
