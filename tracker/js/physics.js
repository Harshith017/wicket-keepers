// Trajectory reconstruction from a single calibrated camera, plus the
// "where would that shot have gone" simulation.
//
// One camera cannot see depth directly. We recover it from physics: the ball is
// in free flight between release, bounce and bat, gravity is known, and the
// bounce happens on the ground plane we calibrated. Each flight segment is a
// constant-acceleration arc whose parameters enter the projection equations
// linearly, so segments are fitted by (reweighted) linear least squares and the
// bounce / impact frames are found by exhaustive search over split points.

import { project, groundPoint, lstsq, levenberg } from './geometry.js';

export const G = 9.81;
export const RB = 0.036;        // ball radius (m)
export const KD = 0.0068;       // drag: a = -KD * |v| * v   (cricket ball, Cd ~ 0.45)
export const STUMP_H = 0.711, STUMP_HALF_W = 0.1143, CREASE = 1.22;

function accelFor(v, ax) {
  const s = Math.hypot(v[0], v[1], v[2]);
  return [ax - KD * s * v[0], -KD * s * v[1], -G - KD * s * v[2]];
}
export function segPos(seg, t) {
  const T = t - seg.t0, h = 0.5 * T * T;
  return [seg.p[0] + seg.v[0] * T + seg.a[0] * h, seg.p[1] + seg.v[1] * T + seg.a[1] * h, seg.p[2] + seg.v[2] * T + seg.a[2] * h];
}
export function segVel(seg, t) {
  const T = t - seg.t0;
  return [seg.v[0] + seg.a[0] * T, seg.v[1] + seg.a[1] * T, seg.v[2] + seg.a[2] * T];
}
/** Outfield bounce: restitution on the vertical, friction impulse on the horizontal. Returns true once rolling. */
export function groundBounce(v) {
  const vz = -v[2], h = Math.hypot(v[0], v[1]);
  const loss = Math.min(h * 0.45, 0.35 * 1.48 * vz);
  const k = h > 1e-9 ? (h - loss) / h : 0;
  v[0] *= k; v[1] *= k;
  if (vz * 0.48 < 1.3) { v[2] = 0; return true; }
  v[2] = 0.48 * vz;
  return false;
}
/** Deceleration of a ball rolling over grass at speed s (rolling resistance + air drag). */
export const rollDecel = (s) => 2.0 + KD * s * s;
/** Constant-acceleration arc. Drag is linearised about the velocity at tRef (mid-segment) for 2nd-order accuracy. */
function makeSeg(t0, p, v, ax, tRef = t0) {
  let a = accelFor(v, ax);
  for (let i = 0; i < 2 && tRef !== t0; i++) {
    const T = tRef - t0;
    a = accelFor([v[0] + a[0] * T, v[1] + a[1] * T, v[2] + a[2] * T], ax);
  }
  return { t0, p, v, ax, a, tRef };
}

// Pixel residual of a predicted 3D position against an observation. Very close
// to the lens a few centimetres of model error is dozens of pixels, so those
// points are down-weighted.
const NEAR = 8;
function resid(cam, X, o) {
  const q = project(cam, X);
  if (q[2] <= 0.05) return [1e4, 1e4];
  const w = Math.min(1, q[2] / NEAR);
  return [(q[0] - o.u) * w, (q[1] - o.v) * w];
}
function segRss(cam, obs, seg) {
  let rss = 0;
  for (const o of obs) {
    const r = resid(cam, segPos(seg, o.t), o);
    rss += r[0] * r[0] + r[1] * r[1];
  }
  return rss;
}

/**
 * Fit one flight segment. If `anchor` is given the segment passes through it at
 * t0 and only velocity (and optionally swing) is solved for; otherwise the
 * start position is free too.
 */
function fitSeg(cam, obs, t0, anchor, useSwing, priors) {
  const P = cam.P;
  const nP = anchor ? 0 : 3;
  const nU = nP + 3 + (useSwing ? 1 : 0);
  if (obs.length * 2 + (priors ? priors.length : 0) < nU) return null;
  let p = anchor || [0, 10, 1], v = [0, 0, 0], ax = 0;
  let known = [0, 0, -G];
  let depths = null;
  const tRef = (obs[0].t + obs[obs.length - 1].t) / 2;
  for (let pass = 0; pass < 4; pass++) {
    const rows = [], rhs = [];
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i], T = o.t - t0, h = 0.5 * T * T;
      const dep = depths ? depths[i] : Math.max(0.5, project(cam, p)[2]);
      const w = Math.min(1, dep / NEAR) / dep;
      const c = [known[0] * h, known[1] * h, known[2] * h];
      for (let e = 0; e < 2; e++) {
        const pix = e ? o.v : o.u;
        const q = [P[e][0] - pix * P[2][0], P[e][1] - pix * P[2][1], P[e][2] - pix * P[2][2], P[e][3] - pix * P[2][3]];
        const row = [];
        let r = -(q[3] + q[0] * c[0] + q[1] * c[1] + q[2] * c[2]);
        if (anchor) r -= q[0] * anchor[0] + q[1] * anchor[1] + q[2] * anchor[2];
        else row.push(q[0] * w, q[1] * w, q[2] * w);
        row.push(q[0] * T * w, q[1] * T * w, q[2] * T * w);
        if (useSwing) row.push(q[0] * h * w);
        rows.push(row); rhs.push(r * w);
      }
    }
    if (priors) for (const pr of priors) {
      const { row, rhs: r } = pr(known);
      rows.push(row); rhs.push(r);
    }
    const x = lstsq(rows, rhs);
    if (!x || x.some((n) => !isFinite(n))) return null;
    if (!anchor) p = [x[0], x[1], x[2]];
    v = [x[nP], x[nP + 1], x[nP + 2]];
    ax = useSwing ? x[nP + 3] : 0;
    const seg = makeSeg(t0, p, v, ax, tRef);
    known = [seg.a[0] - ax, seg.a[1], seg.a[2]];
    depths = obs.map((o) => Math.max(0.3, project(cam, segPos(seg, o.t))[2]));
  }
  const seg = makeSeg(t0, p, v, ax, tRef);
  return { seg, rss: segRss(cam, obs, seg), n: obs.length };
}

const speed = (v) => Math.hypot(v[0], v[1], v[2]);
const heading = (v) => Math.atan2(v[0], -v[1]) * 180 / Math.PI;   // 0 = straight at the striker, + toward +x

/** Smallest t >= tMin at which the segment reaches world y = yTarget (ball travelling toward -y). */
function timeAtY(seg, yTarget, tMin, tMax) {
  const A = 0.5 * seg.a[1], B = seg.v[1], C = seg.p[1] - yTarget;
  const cands = [];
  if (Math.abs(A) < 1e-9) { if (Math.abs(B) > 1e-9) cands.push(-C / B); }
  else {
    const D = B * B - 4 * A * C;
    if (D >= 0) { const s = Math.sqrt(D); cands.push((-B - s) / (2 * A), (-B + s) / (2 * A)); }
  }
  let best = null;
  for (const T of cands) {
    const t = seg.t0 + T;
    if (t >= tMin - 1e-6 && t <= tMax + 1e-6 && (best === null || t < best)) best = t;
  }
  return best;
}

function fitShot(cam, obs, prevSeg, tA, tB, fine) {
  let best = null;
  for (const fr of fine ? [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95] : [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const ti = tA + (tB - tA) * fr;
    const I = segPos(prevSeg, ti);
    const f = fitSeg(cam, obs, ti, I, false);
    if (f && (!best || f.rss < best.rss)) best = { ...f, ti, impact: I };
  }
  return best;
}

/** Positions of a struck ball at the given times after impact (ascending), with true drag, bounces and roll. */
export function shotTrack(I, u, times) {
  const p = [I[0], I[1], Math.max(I[2], RB)], v = u.slice(), out = [];
  const h = 0.002;
  let t = 0, rolling = false;
  for (const T of times) {
    while (t < T - 1e-9) {
      const dt = Math.min(h, T - t);
      if (!rolling) {
        const s = Math.hypot(v[0], v[1], v[2]);
        v[0] -= KD * s * v[0] * dt; v[1] -= KD * s * v[1] * dt; v[2] -= (G + KD * s * v[2]) * dt;
        p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
        if (p[2] <= RB && v[2] < 0) { p[2] = RB; rolling = groundBounce(v); }
      } else {
        const s = Math.hypot(v[0], v[1]);
        if (s > 0.05) {
          const k = Math.max(0, s - rollDecel(s) * dt) / s;
          v[0] *= k; v[1] *= k;
          p[0] += v[0] * dt; p[1] += v[1] * dt;
        }
      }
      t += dt;
    }
    out.push([p[0], p[1], p[2]]);
  }
  return out;
}

function shotResiduals(cam, obs, I, ti, u) {
  const pos = shotTrack(I, u, obs.map((o) => Math.max(0, o.t - ti))), out = [];
  for (let i = 0; i < obs.length; i++) { const r = resid(cam, pos[i], obs[i]); out.push(r[0], r[1]); }
  return out;
}
const shotRss = (cam, obs, I, ti, u) => shotResiduals(cam, obs, I, ti, u).reduce((a, r) => a + r * r, 0);

/** Final shot estimate over a longer window, aware that the ball may already be bouncing along the ground. */
function refineShot(cam, obs, prevSeg, tA, tB, first) {
  let best = null;
  const tis = [first.ti, tA + (tB - tA) * 0.2, tA + (tB - tA) * 0.5, tA + (tB - tA) * 0.8];
  for (const ti of tis) {
    const I = segPos(prevSeg, ti);
    const inits = [];
    for (const n of [3, 4, 6, 9, 14, obs.length]) {
      if (n > obs.length) continue;
      const f = fitSeg(cam, obs.slice(0, n), ti, I, false);
      if (f) inits.push(f.seg.v);
    }
    // Along-the-ground guess straight from the calibrated ground plane.
    const g1 = groundPoint(cam, obs[0].u, obs[0].v, RB), j = Math.min(obs.length - 1, 8), g2 = groundPoint(cam, obs[j].u, obs[j].v, RB);
    if (g1 && g2 && obs[j].t > obs[0].t) {
      const d = obs[j].t - obs[0].t;
      inits.push([(g2[0] - g1[0]) / d, (g2[1] - g1[1]) / d, 0]);
    }
    inits.sort((p, q) => shotRss(cam, obs, I, ti, p) - shotRss(cam, obs, I, ti, q));
    for (const u0 of inits.slice(0, 2)) {
      const sol = levenberg((x) => shotResiduals(cam, obs, I, ti, x), u0, { iters: 25 });
      if (sol.x.every(isFinite) && (!best || sol.cost < best.rss)) best = { seg: makeSeg(ti, I, sol.x, 0), rss: sol.cost, ti, impact: I, n: obs.length };
    }
  }
  return best;
}

function shotValid(sh, L, vIn, obs, cam, rmsMax) {
  if (!sh) return false;
  if (obs) {
    // A real shot moves across the picture and follows a ballistic path closely;
    // a few jittery points around the batter (bat, pads, gloves) do neither.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const o of obs) { x0 = Math.min(x0, o.u); x1 = Math.max(x1, o.u); y0 = Math.min(y0, o.v); y1 = Math.max(y1, o.v); }
    if (Math.hypot(x1 - x0, y1 - y0) < 0.06 * cam.cx) return false;
    if (Math.sqrt(sh.rss / (2 * obs.length)) > 0.4 * rmsMax) return false;
  }
  const I = sh.impact, u = sh.seg.v, s = speed(u);
  if (!(I[1] > -0.6 && I[1] < Math.min(3.5, L * 0.3) && I[2] > -0.1 && I[2] < 2.6 && Math.abs(I[0]) < 2.5 && s > 1.5 && s < 65)) return false;
  // Must actually change the ball's motion, otherwise it is just the same flight carrying on.
  if (vIn && Math.hypot(u[0] - vIn[0], u[1] - vIn[1], u[2] - vIn[2]) < 3) return false;
  return true;
}

/**
 * Reconstruct a delivery from 2D ball observations [{t,u,v}] (seconds, pixels).
 * Returns { ok:false, why } or a full description of the ball.
 */
export function analyseDelivery(obsIn, cam, cfg) {
  const L = cfg.L, off = cfg.hand === 'L' ? -1 : 1;
  let obs = obsIn.slice().sort((a, b) => a.t - b.t).filter((o, i, arr) => i === 0 || o.t > arr[i - 1].t);
  while (obs.length > 140) obs = obs.filter((_, i) => i % 2 === 0);
  const N = obs.length;
  if (N < 6) return { ok: false, why: 'too few points' };
  const dtF = (obs[N - 1].t - obs[0].t) / (N - 1);
  const pen = 1.5 * Math.log(N), rmsMax = cfg.rmsMax || 8;
  // Frames a model leaves unexplained are charged as 4px misses, so a model cannot win by explaining less.
  const score = (rss, unexplained, nPar) => N * Math.log((rss + 16 * unexplained) / N + 0.25) + pen * nPar;
  const minShot = Math.min(5, Math.max(3, Math.round(0.085 / dtF))), SEL_WIN = 0.14, SHOT_WIN = 0.6, POST_WIN = 0.45;
  const lastWithin = (from, win) => { let j = from; while (j + 1 < N && obs[j + 1].t <= obs[from].t + win) j++; return j; };
  const tail = (m) => N - 1 - m;                   // frames left unexplained if the ball is lost after m
  const shotSel = (s) => obs.slice(s, Math.max(s + minShot, lastWithin(s, SEL_WIN) + 1));
  // Around the bat the tracker often rides the bat or the batter for a few frames; allow skipping them.
  const GAPS = [0, 2, 4, 6, 9, 12];
  let best = null;
  const consider = (m) => { if (isFinite(m.score) && (!best || m.score < best.score)) best = m; };
  const reflect = (tk, B, pv) => makeSeg(tk, B, [pv[0] * 0.86, pv[1] * 0.86, -pv[2] * 0.55], 0);

  // Models with a bounce between observations k and k+1.
  for (let k = 3; k < N - 1 && obs[k].t - obs[0].t < 1.6; k++) {
    // The bounce pixel is extrapolated along the incoming path to a sub-frame time.
    const o0 = obs[k - 1], o1 = obs[k], span = obs[k + 1].t - o1.t;
    const nearPost = obs.slice(k + 1, Math.min(N, k + 5));
    let cand = null;
    for (const fr of [0.1, 0.35, 0.6, 0.85]) {
      const tb = o1.t + fr * span, e = (tb - o1.t) / (o1.t - o0.t);
      const B = groundPoint(cam, o1.u + (o1.u - o0.u) * e, o1.v + (o1.v - o0.v) * e, RB);
      if (!B || B[1] < -1 || B[1] > L - 1.5 || Math.abs(B[0]) > 2.6) continue;
      const pre = fitSeg(cam, obs.slice(0, k + 1), tb, B, true);
      if (!pre) continue;
      const near = nearPost.length >= 2 ? fitSeg(cam, nearPost, tb, B, false) : null;
      const c = pre.rss + (near ? near.rss : 0);
      if (!cand || c < cand.c) cand = { c, tb, B, pre };
    }
    if (!cand) continue;
    const { tb, B, pre } = cand;
    const pv = pre.seg.v, ps = speed(pv);
    if (pv[1] > -4 || pv[2] > 0 || ps < 6 || ps > 55 || Math.abs(pre.seg.ax) > 6) continue;
    const mEnd = lastWithin(k, POST_WIN);
    for (let m = k + 1; m <= mEnd; m++) {
      const noShot = m === mEnd;
      if (!noShot && N - 1 - m < minShot) continue;
      let post = null, rssPost = 0;
      if (m - k >= 2) {
        post = fitSeg(cam, obs.slice(k + 1, m + 1), tb, B, false);
        if (!post) continue;
        const w = post.seg.v;
        if (w[2] < 0 || w[1] > -1 || speed(w) > ps * 1.15) continue;
        rssPost = post.rss;
      } else if (noShot) continue;
      // The ball may simply be lost from here on (hidden by the batter, or out of frame).
      if (post) consider({ type: 'bounce', k, m, tb, pre, post, shot: null, score: score(pre.rss + rssPost, tail(m), 10) });
      if (!noShot) {
        const carry = post ? post.seg : reflect(tb, B, pv);
        for (const g of GAPS) {
          const s0 = m + 1 + g;
          if (N - s0 < minShot || obs[s0].t - obs[m].t > 0.3) break;
          const so = shotSel(s0);
          const sh = fitShot(cam, so, carry, obs[m].t, obs[s0].t, g > 0);
          if (!sh || !shotValid(sh, L, segVel(carry, sh.ti), so, cam, rmsMax)) continue;
          consider({ type: 'bounce', k, m, s0, tb, pre, post, shot: sh, score: score(pre.rss + rssPost + sh.rss, g, 14) });
        }
      }
    }
  }

  // Full-toss models (no bounce before the bat / keeper).
  const yRel = L - CREASE;
  const priors = [
    () => ({ row: [0, 0.6, 0, 0, 0, 0, 0], rhs: 0.6 * yRel }),          // released near the crease
    () => ({ row: [0, 0, 0.8, 0, 0, 0, 0], rhs: 0.8 * 2.0 }),           // from about head height
    () => ({ row: [0, 0, 0, 0, 0, 0, 0.15], rhs: 0 }),                  // little swing unless seen
  ];
  const mFull = lastWithin(0, 1.2);
  for (let m = 4; m <= mFull; m++) {
    const noShot = m === mFull;
    if (!noShot && N - 1 - m < minShot) continue;
    const seg0 = obs.slice(0, m + 1), t0 = seg0[0].t;
    const pre = fitSeg(cam, seg0, t0, null, true, priors);
    if (!pre) continue;
    const pv = pre.seg.v, ps = speed(pv), p0 = pre.seg.p;
    if (pv[1] > -4 || ps < 6 || ps > 55 || p0[2] < 0.3 || p0[2] > 3.5 || Math.abs(pre.seg.ax) > 6) continue;
    const pEnd = segPos(pre.seg, obs[m].t);
    if (pEnd[2] < -0.15) continue;
    consider({ type: 'full', k: -1, m, pre, post: null, shot: null, score: score(pre.rss, tail(m), 8) });
    if (!noShot) {
      for (const g of GAPS) {
        const s0 = m + 1 + g;
        if (N - s0 < minShot || obs[s0].t - obs[m].t > 0.3) break;
        const so = shotSel(s0);
        const sh = fitShot(cam, so, pre.seg, obs[m].t, obs[s0].t, g > 0);
        if (!sh || !shotValid(sh, L, segVel(pre.seg, sh.ti), so, cam, rmsMax)) continue;
        // A "hit" at ground level that carries on toward the keeper is a bounce, not a shot.
        if (sh.impact[2] < 0.2 && (sh.seg.v[1] < 0 || sh.impact[1] > 2.5)) continue;
        consider({ type: 'full', k: -1, m, s0, pre, post: null, shot: sh, score: score(pre.rss + sh.rss, g, 12) });
      }
    }
  }
  if (!best) return { ok: false, why: 'no physical trajectory fits' };

  // Re-solve both arcs together while sliding the bounce time between frames:
  // removes the bias from assuming the ball is exactly on the ground in frame k.
  let preSeg = best.pre.seg, postSeg = best.post ? best.post.seg : null, tb = null, B = null, carry = null;
  const m = best.m, s0 = best.s0;
  if (best.type === 'bounce') {
    const k = best.k, tk = best.tb;
    // Refine the bounce point and time together with both arcs (the search
    // above assumed the ball was exactly on the ground in frame k).
    const used = obs.slice(0, m + 1), hasPost = !!postSeg;
    if (hasPost) {
      const tR1 = (obs[0].t + tk) / 2, tR2 = (tk + obs[m].t) / 2, yMax = L - 0.8;
      const unpack = (x) => {
        const Bp = [x[0], x[1], RB];
        return [makeSeg(x[2], Bp, [x[3], x[4], x[5]], x[6], tR1), makeSeg(x[2], Bp, [x[7], x[8], x[9]], 0, tR2)];
      };
      const res = (x) => {
        const [s1, s2] = unpack(x), out = [];
        for (let i = 0; i < used.length; i++) {
          const o = used[i];
          const r = resid(cam, segPos(i <= k ? s1 : s2, o.t), o);
          out.push(r[0], r[1]);
        }
        out.push(3 * Math.max(0, Math.abs(x[2] - tk) - dtF) / dtF);            // bounce stays near frame k
        out.push(10 * Math.max(0, segPos(s1, obs[0].t)[1] - yMax));            // cannot be seen before it is released
        return out;
      };
      const sol = levenberg(res, [preSeg.p[0], preSeg.p[1], tk, ...preSeg.v, preSeg.ax, ...postSeg.v], { iters: 30 });
      const [s1, s2] = unpack(sol.x);
      if (sol.x.every(isFinite) && s1.v[1] < -4 && s1.v[2] < 0 && s2.v[2] >= 0 && s2.v[1] < -1 && Math.abs(s1.ax) < 6
        && Math.abs(sol.x[2] - tk) < 2.5 * dtF && s1.p[1] > -1 && s1.p[1] < L - 1.5) { preSeg = s1; postSeg = s2; }
    }
    tb = preSeg.t0; B = preSeg.p;
    carry = postSeg || reflect(tb, B, preSeg.v);
  }
  const lastSeg = carry || preSeg;
  let shotFit = best.shot;
  if (shotFit) {
    const tA = Math.max(obs[m].t, tb === null ? -Infinity : tb), tB = Math.max(tA + 1e-4, obs[s0].t);
    const so = obs.slice(s0, lastWithin(s0, SHOT_WIN) + 1);
    const short = fitShot(cam, shotSel(s0), lastSeg, tA, tB, s0 > m + 1);
    if (short && shotValid(short, L, segVel(lastSeg, short.ti))) shotFit = short;
    const re = refineShot(cam, so, lastSeg, tA, tB, shotFit);
    // Prefer the long bounce-aware fit when it really explains the flight.
    if (re && shotValid(re, L, segVel(lastSeg, re.ti)) && Math.sqrt(re.rss / (2 * re.n)) < (cfg.rmsMax || 8) * 0.75) shotFit = re;
  }

  // ---- Derived numbers -------------------------------------------------
  const tFirst = obs[0].t;
  const tPreEnd = tb !== null ? tb : (shotFit ? shotFit.ti : obs[m].t);
  let tRel = tFirst;
  {
    // Extrapolate back to the bowling crease if we picked the ball up late.
    const A = 0.5 * preSeg.a[1], Bq = preSeg.v[1], Cq = preSeg.p[1] - (L - CREASE);
    const D = Bq * Bq - 4 * A * Cq;
    if (D >= 0 && Math.abs(A) > 1e-9) {
      for (const T of [(-Bq - Math.sqrt(D)) / (2 * A), (-Bq + Math.sqrt(D)) / (2 * A)]) {
        const t = preSeg.t0 + T;
        if (t < tFirst && t > tFirst - 0.3 && t < tPreEnd) tRel = t;
      }
    }
  }
  const relSpeed = speed(segVel(preSeg, tRel));
  // under 36 km/h is not a delivery (usually a person moving); the fit pins to this floor when forced
  if (relSpeed < 10 || relSpeed > 52) return { ok: false, why: 'implausible speed' };
  if (Math.abs(preSeg.ax) * (tPreEnd - tRel) ** 2 * 50 > 70) return { ok: false, why: 'implausible swing' };
  const flightT = tPreEnd - tRel;
  const swingM = 0.5 * preSeg.ax * flightT * flightT;

  const tSegStart = tb !== null ? tb : tRel;
  const tImpact = shotFit ? shotFit.ti : null;
  const tStumps = timeAtY(lastSeg, 0, tSegStart, tSegStart + 3);
  let atStumps = null;
  if (tStumps !== null) {
    const p = segPos(lastSeg, tStumps);
    // Below ground means the ball would have pitched again first: no meaningful arrival point.
    if (p[2] >= 0) atStumps = { x: p[0] * off, z: p[2], hitting: Math.abs(p[0]) <= STUMP_HALF_W + RB && p[2] <= STUMP_H + RB && p[2] > 0 };
  }

  const nPostObs = best.type === 'bounce' ? obs.slice(0, m + 1).filter((o) => o.t > tb).length : 0;
  let turnDeg = null;
  if (postSeg && nPostObs >= 3) turnDeg = (heading(postSeg.v) - heading(preSeg.v)) * off;

  let shot = null, tShotEnd = null;
  if (shotFit) {
    const u = shotFit.seg.v, s = speed(u);
    const vIn = speed(segVel(lastSeg, shotFit.ti));
    tShotEnd = obs[lastWithin(s0, SHOT_WIN)].t;
    shot = {
      impact: shotFit.impact, v: u, speed: s, t: shotFit.ti,
      elevDeg: Math.atan2(u[2], Math.hypot(u[0], u[1])) * 180 / Math.PI,
      azimDeg: Math.atan2(u[0] * off, u[1]) * 180 / Math.PI,     // 0 = back past the bowler, + = off side
      // Collision model: v_exit = e*v_ball + (1+e)*v_bat with e ~ 0.2 for a cricket bat.
      batSpeed: Math.max(0, (s - 0.2 * vIn) / 1.2), rms: Math.sqrt(shotFit.rss / (2 * shotFit.n)), n: shotFit.n,
      ballIn: vIn,
    };
  }

  // Goodness of fit of the delivery itself.
  let rss = 0, nUsed = 0;
  for (let i = 0; i <= m; i++) {
    const r = resid(cam, segPos(tb !== null && obs[i].t > tb ? lastSeg : preSeg, obs[i].t), obs[i]);
    rss += r[0] * r[0] + r[1] * r[1]; nUsed++;
  }
  const rms = Math.sqrt(rss / (2 * nUsed));
  if (rms > (cfg.rmsMax || 8)) return { ok: false, why: 'fit too loose', rms };

  const segments = [{ kind: 'pre', seg: preSeg, t0: tRel, t1: tPreEnd }];
  if (carry) segments.push({ kind: 'post', seg: carry, t0: tb, t1: tImpact !== null ? tImpact : Math.max(obs[m].t, Math.min(tStumps || 0, tb + 0.6)) });
  if (shot) segments.push({ kind: 'shot', impact: shot.impact, v: shot.v, t0: tImpact, t1: tShotEnd });

  return {
    ok: true, type: best.type, rms, nObs: N, fps: 1 / dtF, tEnd: obs[N - 1].t,
    // Tracking stopped in front of the stumps with frames left over: we do not know what the batter did.
    // or the ball was last seen well short of the batter (often hidden by the batter's body from behind the bowler)
    lost: !shot && ((N - 1 - m >= 3 && segPos(lastSeg, obs[m].t)[1] > 0.3) || (!B && segPos(lastSeg, obs[m].t)[1] > 2)),
    release: { speed: relSpeed, pos: segPos(preSeg, tRel), t: tRel },
    bounce: B ? { x: B[0] * off, y: B[1], t: tb, speedAfter: postSeg ? speed(postSeg.v) : null } : null,
    swingCm: swingM * 100 * off,           // + = toward the off side (away from the batter), - = in
    turnDeg,                               // + = toward off (leg-break to a right-hander), - = toward leg (off-break)
    atStumps, shot, segments,
  };
}

/**
 * analyseDelivery for a raw tracker path, which may start with something that
 * is not the ball in flight (the tracker often rides the bowler's arm into the
 * release). If the whole path does not fit, retry from each sharp change of motion.
 */
export function analyseTrack(obs, cam, cfg) {
  const good = (cfg.rmsMax || 8) * 0.3;
  const first = analyseDelivery(obs, cam, cfg);
  if (first.ok && first.rms < good) return first;
  const cuts = [];
  for (let i = 2; i < obs.length - 6; i++) {
    const a = obs[i - 2], b = obs[i - 1], c = obs[i], d = obs[i + 1];
    const v1 = [(b.u - a.u) / (b.t - a.t), (b.v - a.v) / (b.t - a.t)], v2 = [(d.u - c.u) / (d.t - c.t), (d.v - c.v) / (d.t - c.t)];
    const s1 = Math.hypot(v1[0], v1[1]), s2 = Math.hypot(v2[0], v2[1]);
    if (s1 < 1e-6 || s2 < 1e-6) continue;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (s1 * s2);
    const jump = Math.max(s1, s2) / Math.min(s1, s2);
    const strength = (1 - cos) + (jump > 2 ? Math.log(jump) : 0);
    if (strength > 0.45) cuts.push({ i, strength });
  }
  const dts = obs.slice(1).map((o, i) => o.t - obs[i].t).sort((a, b) => a - b), med = dts[dts.length >> 1];
  for (let i = 1; i < obs.length - 6; i++) if (obs[i].t - obs[i - 1].t > 4 * med) cuts.push({ i, strength: 10 });
  cuts.sort((a, b) => b.strength - a.strength);
  // keep the strongest change within any 3-frame neighbourhood
  const picks = cuts.filter((c) => !cuts.some((o) => o !== c && Math.abs(o.i - c.i) <= 2 && o.strength > c.strength)).slice(0, 6);
  // Earliest start that fits cleanly wins; otherwise the cleanest fit of all.
  let best = first.ok ? first : null;
  for (const c of picks.sort((a, b) => a.i - b.i)) {
    for (const s of [c.i, c.i + 1]) {
      const r = analyseDelivery(obs.slice(s), cam, cfg);
      if (!r.ok) continue;
      if (r.rms < good) return r;
      if (!best || r.rms < best.rms) best = r;
    }
  }
  return best || first;
}

/** Sample a reconstructed delivery as 3D points for drawing. */
export function sampleSegments(segments, step = 0.01) {
  return segments.map((s) => {
    const pts = [];
    const n = Math.max(2, Math.ceil((s.t1 - s.t0) / step));
    for (let i = 0; i <= n; i++) {
      const T = (s.t1 - s.t0) * i / n;
      const p = s.kind === 'shot' ? shotTrack(s.impact, s.v, [T])[0] : segPos(s.seg, s.t0 + T);
      if (p[2] < 0) p[2] = 0;
      pts.push(p);
    }
    return { kind: s.kind, pts };
  });
}

/**
 * Carry a shot out into the field: flight with drag, bounces, then rolling,
 * checked against the boundary rope and every fielder's reach.
 * field = { L, boundary, fielders:[{x,y,name}] }
 */
export function simulateShot(impact, vel, field) {
  const cy = field.L / 2, R = field.boundary;
  const p = impact.slice(), v = vel.slice();
  if (p[2] < RB) p[2] = RB;
  const dt = 0.01, path = [[p[0], p[1], p[2]]];
  let t = 0, bounced = false, rolling = false, firstBounce = null;
  const done = (outcome, extra = {}) => ({ outcome, t, bounced, path, end: [p[0], p[1]], firstBounce, ...extra });
  for (let i = 0; i < 4000; i++) {
    if (!rolling) {
      const s = Math.hypot(v[0], v[1], v[2]);
      v[0] -= KD * s * v[0] * dt; v[1] -= KD * s * v[1] * dt; v[2] -= (G + KD * s * v[2]) * dt;
      p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
      if (p[2] <= RB && v[2] < 0) {
        p[2] = RB;
        if (!bounced) firstBounce = [p[0], p[1]];
        bounced = true;
        if (groundBounce(v)) rolling = true;
      }
    } else {
      const s = Math.hypot(v[0], v[1]);
      if (s < 0.4) return done('STOPPED', nearest(field, p));
      const k = Math.max(0, s - rollDecel(s) * dt) / s;
      v[0] *= k; v[1] *= k;
      p[0] += v[0] * dt; p[1] += v[1] * dt;
    }
    t += dt;
    if (i % 3 === 0) path.push([p[0], p[1], p[2]]);
    if (Math.hypot(p[0], p[1] - cy) >= R) { path.push([p[0], p[1], p[2]]); return done(bounced ? 'FOUR' : 'SIX'); }
    if (t > 0.12 && p[2] <= 2.7) {
      const reach = 1.3 + 6.5 * Math.max(0, t - 0.4);
      for (const f of field.fielders) {
        if (Math.hypot(p[0] - f.x, p[1] - f.y) <= reach) {
          path.push([p[0], p[1], p[2]]);
          return done(bounced ? 'FIELDED' : 'CAUGHT', { by: f });
        }
      }
    }
  }
  return done('STOPPED', nearest(field, p));
}

function nearest(field, p) {
  let by = null, d = Infinity;
  for (const f of field.fielders) { const q = Math.hypot(p[0] - f.x, p[1] - f.y); if (q < d) { d = q; by = f; } }
  return { by };
}

/** Rough runs for a ball that was fielded: time to gather + throw vs ~3.2 s per run. */
export function runsFor(sim, L) {
  if (sim.outcome === 'SIX') return 6;
  if (sim.outcome === 'FOUR') return 4;
  if (sim.outcome === 'CAUGHT') return 0;
  const [x, y] = sim.end;
  const throwD = Math.min(Math.hypot(x, y), Math.hypot(x, y - L));
  const total = sim.t + 0.6 + throwD / 28 + (sim.outcome === 'STOPPED' ? 1.5 : 0);
  return Math.max(0, Math.min(3, Math.floor(total / 3.2)));
}
