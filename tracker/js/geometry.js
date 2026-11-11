// Small linear-algebra + single-camera geometry toolkit.
// World frame: origin at the base of the striker's middle stump, y runs down the
// pitch toward the bowler, z is up, x completes a right-handed frame (so +x is
// the off side for a right-hander). Units are metres and seconds.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const unit = (a) => scale(a, 1 / (norm(a) || 1));

/** Solve A x = b by Gaussian elimination with partial pivoting. Returns null if singular. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-13) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Least squares for an over-determined system via the normal equations. */
export function lstsq(rows, rhs) {
  const n = rows[0].length;
  const ATA = Array.from({ length: n }, () => new Array(n).fill(0));
  const ATb = new Array(n).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let a = 0; a < n; a++) {
      if (r[a] === 0) continue;
      ATb[a] += r[a] * rhs[i];
      for (let b = a; b < n; b++) ATA[a][b] += r[a] * r[b];
    }
  }
  let tr = 0;
  for (let a = 0; a < n; a++) {
    tr += ATA[a][a];
    for (let b = 0; b < a; b++) ATA[a][b] = ATA[b][a];
  }
  for (let a = 0; a < n; a++) ATA[a][a] += 1e-10 * tr + 1e-12;
  return solve(ATA, ATb);
}

/** Levenberg-Marquardt with a numeric Jacobian. resFn(x) -> residual array. */
export function levenberg(resFn, x0, { iters = 40 } = {}) {
  let x = x0.slice();
  let r = resFn(x);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  const n = x.length;
  for (let it = 0; it < iters; it++) {
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice();
      xp[j] += h;
      const rp = resFn(xp);
      J.push(rp.map((v, i) => (v - r[i]) / h));
    }
    const JTJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const JTr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let i = 0; i < r.length; i++) JTr[a] += J[a][i] * r[i];
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let i = 0; i < r.length; i++) s += J[a][i] * J[b][i];
        JTJ[a][b] = JTJ[b][a] = s;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dx = solve(A, JTr.map((v) => -v));
      if (dx) {
        const xn = x.map((v, i) => v + dx[i]);
        const rn = resFn(xn);
        const cn = rn.reduce((s, v) => s + v * v, 0);
        if (cn < cost) {
          const gain = cost - cn;
          x = xn; r = rn; cost = cn;
          lambda = Math.max(lambda * 0.3, 1e-9);
          improved = gain > 1e-10 * (1 + cost);
          break;
        }
      }
      lambda *= 6;
    }
    if (!improved) break;
  }
  return { x, cost, r };
}

export function rodrigues(w) {
  const th = norm(w);
  if (th < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [kx, ky, kz] = scale(w, 1 / th);
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [
    [c + kx * kx * C, kx * ky * C - kz * s, kx * kz * C + ky * s],
    [ky * kx * C + kz * s, c + ky * ky * C, ky * kz * C - kx * s],
    [kz * kx * C - ky * s, kz * ky * C + kx * s, c + kz * kz * C],
  ];
}

const matMul = (A, B) =>
  A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

/** Build a pinhole camera. R rows are the camera axes (right, down, forward) in world coords. */
export function makeCam(f, cx, cy, R, t) {
  const P = [
    [f * R[0][0] + cx * R[2][0], f * R[0][1] + cx * R[2][1], f * R[0][2] + cx * R[2][2], f * t[0] + cx * t[2]],
    [f * R[1][0] + cy * R[2][0], f * R[1][1] + cy * R[2][1], f * R[1][2] + cy * R[2][2], f * t[1] + cy * t[2]],
    [R[2][0], R[2][1], R[2][2], t[2]],
  ];
  const C = [
    -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
    -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
    -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
  ];
  return { f, cx, cy, R, t, P, C };
}

export function lookAtCam(C, target, f, W, H) {
  const fwd = unit(sub(target, C));
  const right = unit(cross(fwd, [0, 0, 1]));
  const down = cross(fwd, right);
  const R = [right, down, fwd];
  const t = [-dot(right, C), -dot(down, C), -dot(fwd, C)];
  return makeCam(f, W / 2, H / 2, R, t);
}

/** Project a world point. Returns [u, v, depth]. */
export function project(cam, X) {
  const P = cam.P;
  const w = P[2][0] * X[0] + P[2][1] * X[1] + P[2][2] * X[2] + P[2][3];
  return [
    (P[0][0] * X[0] + P[0][1] * X[1] + P[0][2] * X[2] + P[0][3]) / w,
    (P[1][0] * X[0] + P[1][1] * X[1] + P[1][2] * X[2] + P[1][3]) / w,
    w,
  ];
}

/** Where the viewing ray through pixel (u,v) meets the horizontal plane z = z0. */
export function groundPoint(cam, u, v, z0 = 0) {
  const d = [(u - cam.cx) / cam.f, (v - cam.cy) / cam.f, 1];
  const R = cam.R;
  const dw = [
    R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2],
    R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2],
    R[0][2] * d[0] + R[1][2] * d[1] + R[2][2] * d[2],
  ];
  if (Math.abs(dw[2]) < 1e-9) return null;
  const s = (z0 - cam.C[2]) / dw[2];
  if (s <= 0) return null;
  return [cam.C[0] + s * dw[0], cam.C[1] + s * dw[1], z0];
}

function homography(world, img) {
  const rows = [], rhs = [];
  for (let i = 0; i < world.length; i++) {
    const [X, Y] = world[i], [u, v] = img[i];
    rows.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); rhs.push(u);
    rows.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); rhs.push(v);
  }
  const h = world.length === 4 ? solve(rows, rhs) : lstsq(rows, rhs);
  return h && [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function calibrateOnce(world, img, W, H) {
  const cx = W / 2, cy = H / 2;
  const pts = img.map(([u, v]) => [(u - cx) / W, (v - cy) / W]);
  const Hm = homography(world, pts);
  if (!Hm) return null;
  const a = [Hm[0][0], Hm[1][0], Hm[2][0]];
  const b = [Hm[0][1], Hm[1][1], Hm[2][1]];
  const c = [Hm[0][2], Hm[1][2], Hm[2][2]];
  // Focal length from the two constraints r1.r2 = 0 and |r1| = |r2|.
  const cands = [];
  const d1 = a[2] * b[2], n1 = -(a[0] * b[0] + a[1] * b[1]);
  const d2 = a[2] * a[2] - b[2] * b[2], n2 = -(a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  if (Math.abs(d1) > 1e-12 && n1 / d1 > 0) cands.push([Math.abs(d1), Math.sqrt(n1 / d1)]);
  if (Math.abs(d2) > 1e-12 && n2 / d2 > 0) cands.push([Math.abs(d2), Math.sqrt(n2 / d2)]);
  cands.sort((p, q) => q[0] - p[0]);
  let f = cands.length ? cands[0][1] : 0.85;
  f = Math.min(4, Math.max(0.3, f));

  let r1 = [a[0] / f, a[1] / f, a[2]], r2 = [b[0] / f, b[1] / f, b[2]], t = [c[0] / f, c[1] / f, c[2]];
  let lam = 2 / (norm(r1) + norm(r2));
  if (t[2] < 0) lam = -lam;
  r1 = unit(scale(r1, lam));
  r2 = scale(r2, lam);
  r2 = unit(sub(r2, scale(r1, dot(r1, r2))));
  const r3 = cross(r1, r2);
  t = scale(t, lam);
  const R0 = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];

  // Refine focal length + pose on reprojection error (R = rodrigues(delta) * R0).
  const build = (x) => makeCam(x[0], 0, 0, matMul(rodrigues([x[1], x[2], x[3]]), R0), [x[4], x[5], x[6]]);
  const res = (x) => {
    const cam = build(x), out = [];
    for (let i = 0; i < world.length; i++) {
      const p = project(cam, [world[i][0], world[i][1], 0]);
      out.push((p[0] - pts[i][0]) * W, (p[1] - pts[i][1]) * W);
    }
    return out;
  };
  const sol = levenberg(res, [f, 0, 0, 0, t[0], t[1], t[2]], { iters: 60 });
  const x = sol.x;
  if (!(x[0] > 0.2 && x[0] < 6)) return null;
  const cam = makeCam(x[0] * W, cx, cy, matMul(rodrigues([x[1], x[2], x[3]]), R0), [x[4], x[5], x[6]]);
  // All reference points must be in front of the camera.
  for (const w of world) if (project(cam, [w[0], w[1], 0])[2] <= 0) return null;
  return { cam, rms: Math.sqrt(sol.cost / (2 * world.length)) };
}

/**
 * Calibrate from the four corners of a rectangle lying on the pitch.
 * img order: striker-end left, striker-end right, bowler-end right, bowler-end left
 * (left/right as they appear in the picture). Works from either end of the
 * ground: the mirrored assignment puts the camera underground, so we reject it.
 */
export function calibrate(img, rectW, L, W, H) {
  const hw = rectW / 2;
  const variants = [
    [[hw, 0], [-hw, 0], [-hw, L], [hw, L]],
    [[-hw, 0], [hw, 0], [hw, L], [-hw, L]],
  ];
  let best = null;
  for (const world of variants) {
    const r = calibrateOnce(world, img, W, H);
    if (!r || r.cam.C[2] < 0.15) continue;
    if (!best || r.rms < best.rms) best = r;
  }
  return best;
}
