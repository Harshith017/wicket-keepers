// Bowling measurements that hold up from behind the bowler's arm.
//
// From there the ball flies almost straight away from the lens, and a full 3D
// fit from one camera is very sensitive to small calibration errors. These use
// only what the picture pins down well:
//   speed   time of flight: the frames between the ball leaving the hand and
//           reaching the bat, over the known length of the pitch
//   length  where the ball meets the ground, mapped through the calibrated
//           ground plane
//   line    the same bounce point, across the pitch

import { groundPoint, project } from './geometry.js';

// Where the ball is measured from and to, in front of each set of stumps (metres).
export const RELEASE_AHEAD = 1.0;     // ball leaves the hand about here, in front of the bowler's stumps
export const CONTACT_AHEAD = 1.5;     // and meets the bat about here, in front of the batter's stumps
// The ball slows through the air and off the pitch: the speed out of the hand is
// a little above the average over the flight.
const RELEASE_OVER_AVERAGE = 1.05;

function quad(pts, key) {
  const S = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const p of pts) {
    const r = [1, p.t, p.t * p.t];
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; S[i][3] += r[i] * p[key]; }
  }
  for (let c = 0; c < 3; c++) for (let r = c + 1; r < 3; r++) {
    const f = S[r][c] / S[c][c];
    for (let k = c; k < 4; k++) S[r][k] -= f * S[c][k];
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let s = S[r][3]; for (let k = r + 1; k < 3; k++) s -= S[r][k] * x[k]; x[r] = s / S[r][r]; }
  return (t) => x[0] + x[1] * t + x[2] * t * t;
}

/**
 * The bounce in the picture: the ball comes down the frame, meets the pitch,
 * and goes back up it. Often it is lost for a few frames right there, so the
 * paths either side are extended to where they meet. Returns { t, u, v } or null.
 */
export function imageBounce(obs) {
  if (obs.length < 6) return null;
  let iMax = 0;
  for (let i = 1; i < obs.length; i++) if (obs[i].v > obs[iMax].v) iMax = i;
  // a real bounce has the ball rising again afterwards
  const after = obs.slice(iMax + 1);
  if (after.length < 2 || obs[obs.length - 1].v > obs[iMax].v - 4) return null;
  // the side with the bigger gap is where the bounce was missed
  const gapAfter = after[0].t - obs[iMax].t, gapBefore = iMax ? obs[iMax].t - obs[iMax - 1].t : 0;
  const dt = (obs[obs.length - 1].t - obs[0].t) / (obs.length - 1);
  let preEnd = iMax, postStart = iMax + 1;
  if (gapBefore > gapAfter) { preEnd = iMax - 1; postStart = iMax; }
  if (Math.max(gapAfter, gapBefore) < 2.5 * dt) return { t: obs[iMax].t, u: obs[iMax].u, v: obs[iMax].v };
  const pre = obs.slice(Math.max(0, preEnd - 5), preEnd + 1), post = obs.slice(postStart, postStart + 6);
  if (pre.length < 3 || post.length < 3) return { t: obs[iMax].t, u: obs[iMax].u, v: obs[iMax].v };
  const pv = quad(pre, 'v'), pu = quad(pre, 'u'), qv = quad(post, 'v'), qu = quad(post, 'u');
  const t0 = obs[preEnd].t, t1 = obs[postStart].t;
  for (let t = t0; t <= t1; t += 0.001) if (pv(t) >= qv(t)) return { t, u: (pu(t) + qu(t)) / 2, v: pv(t) };
  return { t: obs[iMax].t, u: obs[iMax].u, v: obs[iMax].v };
}

/** Distance the ball travels from release to bat, unless a known ball has set it. */
export const flightDistance = (L, known) => (known > 3 ? known : L - RELEASE_AHEAD - CONTACT_AHEAD);
/** Release speed (m/s) from the flight time; `known` is a distance set from a ball of known speed. */
export function tofSpeed(tRelease, tArrive, L, known) {
  const dt = tArrive - tRelease;
  if (!(dt > 0.15)) return null;
  return flightDistance(L, known) / dt * RELEASE_OVER_AVERAGE;
}
/** The release-to-bat distance that makes this ball the given speed (m/s). */
export const distanceFromKnown = (tRelease, tArrive, speed) => speed / RELEASE_OVER_AVERAGE * (tArrive - tRelease);

/**
 * Bowling numbers for a tracked delivery: { tRelease, tArrive, speed, bounce: { t, u, v, x, y } }.
 * x is across the pitch from the middle stump (+ = off side for a right-hander), y is the
 * distance from the batter's stumps.
 */
export function measureDelivery(obs, cam, L, hand) {
  const tRelease = obs[0].t - 1 / 120;           // the ball left the hand about half a frame before it was first seen clear
  const tArrive = obs[obs.length - 1].t;         // last seen: usually as it reaches the batter
  const out = { tRelease, tArrive, speed: tofSpeed(tRelease, tArrive, L), bounce: null };   // speed is rescaled by the app if a known ball set the distance
  const b = imageBounce(obs);
  if (b && cam) {
    const g = groundPoint(cam, b.u, b.v, 0.036);
    if (g && g[1] > -1 && g[1] < L) out.bounce = { ...b, x: g[0] * (hand === 'L' ? -1 : 1), y: g[1] };
  }
  return out;
}

/** Looks like a delivery: heads from the bowler's end toward the batter's stumps in the picture. */
export function looksLikeDelivery(obs, cam, L) {
  if (obs.length < 8 || !cam) return false;
  const far = project(cam, [0, 0, 0.4]);
  const d0 = Math.hypot(obs[0].u - far[0], obs[0].v - far[1]);
  const d1 = Math.min(...obs.slice(-4).map((o) => Math.hypot(o.u - far[0], o.v - far[1])));
  return d1 < 0.8 * d0;
}
