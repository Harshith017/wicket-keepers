// Finds the stumps in a frame, for calibration without dragging markers.
//
// From behind the bowler's stumps the picture has two clear features:
//   - your stump (or stumps): a long, narrow upright bar low in the frame,
//     standing on the crease line, and
//   - the batter's stumps: a short, narrow upright bar further up, near the
//     same column (the camera looks down the pitch over your stump).
// Both are found as "thin upright bars": a column of pixels that differs from
// the pixels a few columns either side of it, sustained over a vertical run.
//
// Works on any { width, height, data } RGBA image. Coordinates returned are in
// that image's pixels.

function bars(img, x0, x1, y0, y1, maxHalfWidth) {
  const { width: W, data: d } = img;
  const w = x1 - x0, h = y1 - y0, R = new Float32Array(w * h);
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  for (let y = y0; y < y1; y++) for (let x = x0 + maxHalfWidth + 2; x < x1 - maxHalfWidth - 2; x++) {
    const c = px(x, y);
    let best = 0;
    for (let k = 2; k <= maxHalfWidth + 1; k++) {
      const l = px(x - k, y), r = px(x + k, y);
      // differs from both sides, and the two sides look alike (a bar, not an edge)
      const m = Math.min(diff(c, l), diff(c, r)) - 0.5 * diff(l, r);
      if (m > best) best = m;
    }
    R[(y - y0) * w + (x - x0)] = best;
  }
  return { R, w, h, x0, y0 };
}

/** Longest well-supported vertical run in each column of a bar map. */
function runs(map, thr, maxGap) {
  const out = [];
  for (let x = 0; x < map.w; x++) {
    let start = -1, gap = 0, last = -1;
    for (let y = 0; y <= map.h; y++) {
      // a column of the bar can wobble by a pixel: take the best of three columns
      const v = y < map.h ? Math.max(map.R[y * map.w + x], x > 0 ? map.R[y * map.w + x - 1] : 0, x + 1 < map.w ? map.R[y * map.w + x + 1] : 0) : 0;
      if (v > thr) { if (start < 0) start = y; last = y; gap = 0; }
      else if (start >= 0 && ++gap > maxGap) {
        out.push({ x: x + map.x0, top: start + map.y0, bottom: last + map.y0, len: last - start + 1 });
        start = -1; gap = 0;
      }
    }
  }
  return out;
}

/** Strongest light horizontal line (a crease) crossing column x between rows y0 and y1. */
function creaseBelow(img, x, y0, y1) {
  const { width: W, height: H, data: d } = img;
  const lum = (xx, yy) => { const i = (Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  let best = null;
  for (let y = y0; y < Math.min(H - 4, y1); y++) {
    // look either side of the stump's base (the base itself hides the line)
    let s = 0;
    for (const dx of [-40, -30, -20, 20, 30, 40]) s += Math.min(lum(x + dx, y) - lum(x + dx, y - 4), lum(x + dx, y) - lum(x + dx, y + 4));
    if (!best || s > best.s) best = { y, s };
  }
  return best && best.s > 6 * 25 ? best.y : null;
}

/**
 * Your stump: the longest upright bar in the lower part of the frame.
 * Returns { x, top, base } or null. base is where it stands on the crease.
 */
export function findNearStump(img, near) {
  const W = img.width, H = img.height;
  const x0 = near ? Math.max(0, Math.round(near[0] - 0.12 * W)) : Math.round(0.15 * W), x1 = near ? Math.min(W, Math.round(near[0] + 0.12 * W)) : Math.round(0.85 * W);
  const y0 = Math.round(0.45 * H), y1 = H - 2;
  const map = bars(img, x0, x1, y0, y1, Math.max(3, Math.round(W / 90)));
  const thr = 40;
  let best = null;
  for (const r of runs(map, thr, 6)) {
    if (r.len < 0.12 * H) continue;
    // the camera stands behind your stump, so it is near the middle; net strings run down the sides
    const score = r.len - (near ? Math.abs(r.x - near[0]) * 1.5 : Math.abs(r.x - W / 2) * 1.5);
    if (!best || score > best.score) best = { ...r, score };
  }
  if (!best) return null;
  // stumps stand on the crease; a training stump's rubber foot hides the very bottom
  const crease = creaseBelow(img, best.x, best.bottom - 4, best.bottom + Math.round(0.05 * H));
  return { x: best.x, top: best.top, base: crease != null ? crease : best.bottom };
}

/**
 * The batter's stumps: a short upright bar above your stump, near the same column.
 * Returns { x, top, base } or null.
 */
export function findFarStumps(img, nearStump, guess) {
  const W = img.width, H = img.height;
  const cx = guess ? guess[0] : nearStump.x;
  const x0 = Math.max(0, Math.round(cx - 0.1 * W)), x1 = Math.min(W, Math.round(cx + 0.1 * W));
  const y0 = guess ? Math.max(0, Math.round(guess[1] - 0.08 * H)) : Math.round(0.3 * H);
  const y1 = guess ? Math.min(H, Math.round(guess[1] + 0.08 * H)) : Math.max(y0 + 10, Math.min(nearStump.top - 4, Math.round(0.75 * H)));
  const map = bars(img, x0, x1, y0, y1, 2);
  let best = null;
  for (const r of runs(map, 45, 2)) {
    // stumps far away are a few dozen pixels tall at most, and stand straight up
    if (r.len < 0.012 * H || r.len > 0.06 * H) continue;
    const near = guess ? Math.hypot(r.x - guess[0], r.bottom - guess[1]) : Math.abs(r.x - cx);
    // the batter's stumps stand on the pitch: the lowest such bar (walls and nets are higher up)
    const score = guess ? r.len - 0.5 * near : r.bottom - 1.0 * near;
    if (!best || score > best.score) best = { ...r, score };
  }
  // gather the neighbouring stumps of the same set, for a steadier base and top
  if (!best) return null;
  return { x: best.x, top: best.top, base: best.bottom + 1 };
}

/** Both sets: { near: { x, base }, far: { x, base, top } } or null. Optional rough taps guide the search. */
export function findStumps(img, taps = {}) {
  const near = findNearStump(img, taps.near);
  if (!near) return null;
  const far = findFarStumps(img, near, taps.far);
  if (!far) return null;
  return { near, far };
}
