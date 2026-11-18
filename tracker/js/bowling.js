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

/**
 * How much one frame of timing moves the speed reading, in km/h, for a ball at `kmh`
 * over the usual release-to-bat distance on a pitch of length L, at `fps` real-time frames
 * a second. Speed is distance over time, so a time error dt changes it by about v^2 dt / D.
 */
export function kmhPerFrame(fps, L = 20.12, kmh = 130) {
  const v = kmh / 3.6, D = L - RELEASE_AHEAD - CONTACT_AHEAD;
  return (v * v / D) / fps * 3.6;
}

/** A plain-words note on what the frame rate means for speed readings. */
export function frameRateNote(fps, L = 20.12) {
  if (!(fps > 0)) return '';
  const step = kmhPerFrame(fps, L);
  const r = `At ${Math.round(fps)} fps one frame is about ${step < 2 ? step.toFixed(1) : Math.round(step)} km/h on a 130 km/h ball.`;
  return fps < 100 ? `${r} For the most accurate speeds, record the session in slow motion (240 fps) and open the clip with Video clip.` : r;
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

/** The time between frames of a tracked path (s): the median step, so a few missed frames do not count. */
export function frameInterval(obs) {
  const d = [];
  for (let i = 1; i < obs.length; i++) { const s = obs[i].t - obs[i - 1].t; if (s > 0) d.push(s); }
  if (!d.length) return 1 / 60;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * When the ball met the bat or pad, between frames. `before` are the last points on the
 * way in, `after` the first one or two on the way out ({ t, u, v }). The ball comes in on
 * a straight line in the picture and leaves on another; the contact is where they meet.
 * With only one point after, or no clear change of direction, it is halfway between frames,
 * the best guess when nothing more is known.
 */
export function contactTime(before, after) {
  const p = before[before.length - 1], q = after[0], gap = q.t - p.t;
  const mid = p.t + gap / 2;
  if (before.length < 2 || after.length < 2 || !(gap > 0)) return mid;
  const p0 = before[before.length - 2], q1 = after[1];
  const a = [(p.u - p0.u) / (p.t - p0.t), (p.v - p0.v) / (p.t - p0.t)];
  const w = [(q1.u - q.u) / (q1.t - q.t), (q1.v - q.v) / (q1.t - q.t)];
  const d = [a[0] - w[0], a[1] - w[1]], dd = d[0] * d[0] + d[1] * d[1];
  // the paths in and out barely differ: the picture cannot say where in the gap it happened
  if (!(dd > 1e-6) || Math.sqrt(dd) < 0.15 * Math.hypot(a[0], a[1])) return mid;
  const r = [q.u - p.u - w[0] * gap, q.v - p.v - w[1] * gap];
  const tau = (d[0] * r[0] + d[1] * r[1]) / dd;
  return p.t + Math.min(gap, Math.max(0, tau));
}

/**
 * Bowling numbers for a tracked delivery: { tRelease, tArrive, speed, bounce: { t, u, v, x, y } }.
 * x is across the pitch from the middle stump (+ = off side for a right-hander), y is the
 * distance from the batter's stumps.
 */
export function measureDelivery(obs, cam, L, hand) {
  // The ball left the hand somewhere between the frame before it was first seen clear and that
  // frame, and reached the batter between the last frame it was seen and the next: halfway is the
  // unbiased guess at any frame rate (half a frame is 8 ms at 60 fps, 2 ms in 240 fps slow motion).
  const half = frameInterval(obs) / 2;
  const tRelease = obs[0].t - half;
  const tArrive = obs[obs.length - 1].t + half;
  const out = { tRelease, tArrive, speed: tofSpeed(tRelease, tArrive, L), bounce: null };   // speed is rescaled by the app if a known ball set the distance
  const b = imageBounce(obs);
  if (b && cam) {
    const g = groundPoint(cam, b.u, b.v, 0.036);
    if (g && g[1] > -1 && g[1] < L) out.bounce = { ...b, x: g[0] * (hand === 'L' ? -1 : 1), y: g[1] };
  }
  return out;
}

/**
 * Where a delivery starts in a tracked path (minSize: how many moving pixels a ball
 * just out of the hand covers at least, if known): the first point near where a bowler lets
 * go of the ball (just in front of the stumps at the camera end, about head height or
 * above), with enough of the path after it. -1 if there is none. Paths can have other
 * moving things joined on in front, so this need not be the first point.
 */
export function deliveryStart(obs, cam, L, minSize = 0) {
  if (!cam) return -1;
  const W = 2 * cam.cx;
  // Where the ball can first be seen clear: the release point, and the first few metres of its
  // flight (the bowler's body often hides it for a moment, and the release height varies), at
  // the heights a bowled ball has there.
  const hand = [];
  for (const ahead of [0, 1, 2, 3]) for (const [x, z] of [[0, 2.0], [0, 2.5], [0.8, 2.2], [-0.8, 2.2], [0, 1.6]]) {
    const p = project(cam, [x, L - RELEASE_AHEAD - ahead, z - 0.12 * ahead]);
    if (p[2] > 0.05) hand.push(p);
  }
  // How fast a slow delivery (50 km/h) just out of the hand crosses the picture from where this
  // camera stands. From behind the bowler the ball flies almost straight away from the lens, so
  // this can be small (a low camera a few metres back sees it move only a few pixels a frame);
  // a fixed share of the picture width would throw such balls out.
  const v0 = 50 / 3.6, a = project(cam, [0, L - RELEASE_AHEAD, 2.1]), b = project(cam, [0, L - RELEASE_AHEAD - v0 * 0.1, 2.0]);
  // Only a fraction of it is required: if the pitch length or camera height is a little off, the
  // expected rate is too (a 1 m camera 3 m back on a short net sees about a fifth of it).
  const minRate = 0.15 * Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1;     // pixels a second
  for (let i = 0; i + 6 <= obs.length; i++) {
    const d = Math.min(...hand.map((q) => Math.hypot(obs[i].u - q[0], obs[i].v - q[1])));
    // just out of the hand the ball is a few metres from the lens, so it looks big
    // (the bowler's arm swinging over gives a flicker of big blobs too, but not four in a row)
    const big = !minSize || obs[i].n == null || obs.slice(i, i + 4).every((o) => o.n == null || o.n >= minSize);
    // and it is moving steadily across the picture, one way, not standing still or jittering
    // like an arm or a shirt
    const dx = (k) => obs[k + 1].u - obs[k].u, dy = (k) => obs[k + 1].v - obs[k].v;
    const step = (k) => Math.hypot(dx(k), dy(k));
    const sameWay = (k) => (dx(k) * dx(k + 1) + dy(k) * dy(k + 1)) > 0.5 * step(k) * step(k + 1);
    const span = obs[i + 3].t - obs[i].t;
    const moving = !minSize || (span > 0
      && Math.hypot(obs[i + 3].u - obs[i].u, obs[i + 3].v - obs[i].v) / span >= Math.min(minRate, 0.04 * W / 0.05)
      && [0, 1, 2].every((k) => step(i + k) >= 1.5) && sameWay(i) && sameWay(i + 1));
    if (d < (minSize ? 0.3 : 0.22) * W && big && moving) return i;
  }
  return -1;
}
const median = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
export const looksLikeDelivery = (obs, cam, L) => deliveryStart(obs, cam, L) === 0;

// ---------------------------------------------------------------- is it our ball?
// The pitch in the picture: everything within a few feet of the middle stump line,
// between the two sets of stumps, up to a little over head height. A ball hit in the
// next net, a fielder throwing one back, or people walking past fall outside it.
const HALF_WIDTH = 1.7, TOP = 2.8;

function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** The image outline of the box |x| <= halfWidth, y0 <= y <= y1, 0 <= z <= top, as a test (u, v) => inside. */
export function pitchRegion(cam, y0, y1, { halfWidth = HALF_WIDTH, top = TOP, margin = 6 } = {}) {
  const c = [];
  for (const x of [-halfWidth, halfWidth]) for (const y of [y0, y1]) for (const z of [0, top]) {
    const p = project(cam, [x, y, z]);
    if (!(p[2] > 0.05)) return () => true;          // behind the camera: no test possible
    c.push([p[0], p[1]]);
  }
  const H = hull(c);
  return (u, v) => {
    for (let i = 0; i < H.length; i++) {
      const a = H[i], b = H[(i + 1) % H.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1;
      // outward side (hull is counter-clockwise in a y-down image: check the sign once)
      if (((u - a[0]) * ey - (v - a[1]) * ex) / len > margin) return false;
    }
    return true;
  };
}

/**
 * Whether a tracked path is a delivery down this pitch: it stays on the pitch, and
 * it gets well down it. Returns { ok, why }.
 */
export function deliveryCheck(obs, cam, L, minSize = 0) {
  if (!cam) return { ok: true };
  if (minSize && obs[0].n != null) {
    // a bowled ball starts big (near the lens) and shrinks as it goes away down the pitch;
    // a ball hit back, or one in the next net, does not
    const first = median(obs.slice(0, 3).map((o) => o.n));
    // the smallest it gets later on (three-point medians over the second half): the path can end
    // merged into the batter, which makes its last points big again
    let least = Infinity;
    for (let k = obs.length >> 1; k + 3 <= obs.length; k++) least = Math.min(least, median(obs.slice(k, k + 3).map((o) => o.n)));
    if (!isFinite(least)) least = median(obs.slice(-3).map((o) => o.n));
    if (first < minSize) return { ok: false, why: 'too small to be just out of the hand' };
    if (first < 1.5 * least) return { ok: false, why: 'not going away from the camera' };
  }
  const onPitch = pitchRegion(cam, -0.5, L - 0.3);
  const off = obs.filter((o) => !onPitch(o.u, o.v)).length;
  if (off > 0.15 * obs.length) return { ok: false, why: 'off the pitch' };
  const downPitch = pitchRegion(cam, -0.5, L - 4);
  const end = obs[obs.length - 1];
  if (!downPitch(end.u, end.v)) return { ok: false, why: 'did not go down the pitch' };
  return { ok: true };
}

/** Whether a delivery's last point is at the batter's end: near the batter's stumps in the picture. */
export function reachesBatter(last, cam) {
  if (!cam) return true;
  const q = project(cam, [0, 0.5, 0.3]);
  return Math.hypot(last.u - q[0], last.v - q[1]) < 0.2 * 2 * cam.cx;
}
