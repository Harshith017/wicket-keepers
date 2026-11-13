// Finds small fast-moving things in the video (three-frame differencing) and
// links them into ball tracks.

const CELL = 8;

export class Detector {
  constructor() { this.thr = 45; this.reset(); }
  reset() { this.frames = []; this.times = []; this.w = 0; this.h = 0; }

  /**
   * Feed one RGBA frame. Returns { t, blobs, noisy } for the PREVIOUS frame
   * (a pixel counts as moving only if it differs from both neighbours in time,
   * which removes the ghost a moving object leaves behind), or null while warming up.
   */
  process(img, t) {
    const w = img.width, h = img.height;
    if (w !== this.w || h !== this.h) {
      this.reset(); this.w = w; this.h = h;
      this.gw = Math.ceil(w / CELL); this.gh = Math.ceil(h / CELL);
      const n = this.gw * this.gh;
      this.cnt = new Uint16Array(n); this.sx = new Float32Array(n); this.sy = new Float32Array(n);
      this.label = new Uint8Array(n);
    }
    this.frames.push(img.data); this.times.push(t);
    if (this.frames.length < 3) return null;
    if (this.frames.length > 3) { this.frames.shift(); this.times.shift(); }
    const [a, b, c] = this.frames, thr = this.thr;
    const { cnt, sx, sy, label, gw, gh } = this;
    cnt.fill(0); sx.fill(0); sy.fill(0); label.fill(0);
    let hot = 0;
    for (let y = 0; y < h; y++) {
      const row = (y >> 3) * gw;
      let i = y * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        const d1 = Math.abs(b[i] - a[i]) + Math.abs(b[i + 1] - a[i + 1]) + Math.abs(b[i + 2] - a[i + 2]);
        if (d1 <= thr) continue;
        const d2 = Math.abs(b[i] - c[i]) + Math.abs(b[i + 1] - c[i + 1]) + Math.abs(b[i + 2] - c[i + 2]);
        if (d2 <= thr) continue;
        const ci = row + (x >> 3);
        cnt[ci]++; sx[ci] += x; sy[ci] += y; hot++;
      }
    }
    const out = { t: this.times[1], blobs: [], noisy: false, hot };
    if (hot > 0.06 * w * h) { out.noisy = true; return out; }      // camera shake / lighting change
    const maxDim = Math.max(24, 0.09 * w), stack = [];
    for (let s = 0; s < cnt.length; s++) {
      if (!cnt[s] || label[s]) continue;
      let n = 0, mx = 0, my = 0, x0 = gw, x1 = 0, y0 = gh, y1 = 0;
      stack.push(s); label[s] = 1;
      while (stack.length) {
        const q = stack.pop(), qx = q % gw, qy = (q - qx) / gw;
        n += cnt[q]; mx += sx[q]; my += sy[q];
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (cnt[ni] && !label[ni]) { label[ni] = 1; stack.push(ni); }
        }
      }
      const bw = (x1 - x0 + 1) * CELL, bh = (y1 - y0 + 1) * CELL;
      if (n < 3 || bw > maxDim || bh > maxDim) continue;
      out.blobs.push({ x: mx / n + 0.5, y: my / n + 0.5, n, bw, bh });
    }
    if (out.blobs.length > 40) { out.blobs.sort((p, q) => q.n - p.n); out.blobs.length = 40; }
    return out;
  }
}

const extent = (tr) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of tr.pts) { if (p.u < x0) x0 = p.u; if (p.u > x1) x1 = p.u; if (p.v < y0) y0 = p.v; if (p.v > y1) y1 = p.v; }
  return Math.hypot(x1 - x0, y1 - y0);
};

export class Tracker {
  constructor() { this.W = 1280; this.reset(); }
  reset() { this.tracks = []; this.closed = []; this.nextId = 1; }

  /** blobs in source-pixel coords. Returns { live, finished } where finished is null or a list of candidate observation lists. */
  update(blobs, t) {
    const W = this.W, gateMin = 0.025 * W;
    const used = new Array(blobs.length).fill(false), matched = new Map();
    // Every track predicts where it should be now. A ball moves smoothly, so an
    // established track only looks close to its prediction; this stops a track
    // made of random jumps from grabbing everything (including the ball).
    const pairs = [];
    this.tracks.forEach((tr, ti) => {
      const n = tr.pts.length, last = tr.pts[n - 1], dt = t - last.t;
      if (dt <= 0) return;
      const sp = Math.hypot(tr.vx, tr.vy) * dt;
      const px = last.u + tr.vx * dt, py = last.v + tr.vy * dt;
      const gate = n >= 3 ? Math.max(gateMin, 0.35 * sp + 0.01 * W) : n === 2 ? Math.max(1.5 * gateMin, 0.6 * sp) : Math.min(0.15 * W, 12 * W * dt);
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        if (Math.hypot(b.x - last.u, b.y - last.v) <= 1.5) continue;     // not moving: noise
        const d = Math.hypot(b.x - px, b.y - py);
        // A ball moving away only shrinks. A much bigger blob on its path is the ball
        // merged with a person (often the batter): treat the ball as hidden, don't follow it.
        if (n >= 3 && tr.size && b.n > 1.7 * tr.size + 8) continue;
        if (d < gate) pairs.push({ ti, i, cost: d / gate - Math.min(n, 30) * 0.004 });
      }
    });
    pairs.sort((a, b) => a.cost - b.cost);
    for (const pr of pairs) {
      if (used[pr.i] || matched.has(pr.ti)) continue;
      used[pr.i] = true; matched.set(pr.ti, pr.i);
    }
    const keep = [];
    this.tracks.forEach((tr, ti) => {
      const last = tr.pts[tr.pts.length - 1], dt = t - last.t;
      if (dt <= 0) { keep.push(tr); return; }
      if (matched.has(ti)) {
        const b = blobs[matched.get(ti)];
        const vx = (b.x - last.u) / dt, vy = (b.y - last.v) / dt;
        if (tr.pts.length >= 2) { tr.vx = 0.5 * tr.vx + 0.5 * vx; tr.vy = 0.5 * tr.vy + 0.5 * vy; } else { tr.vx = vx; tr.vy = vy; }
        tr.pts.push({ t, u: b.x, v: b.y });
        if (b.n) tr.size = b.n;
        keep.push(tr);
      } else if (dt > (tr.pts.length >= 4 ? 0.11 : 0.05)) {
        if (tr.pts.length >= 6 && extent(tr) > 0.06 * W) this.closed.push(tr);
      } else keep.push(tr);
    });
    this.tracks = keep;
    for (let i = 0; i < blobs.length && this.tracks.length < 60; i++) {
      if (!used[i]) this.tracks.push({ id: this.nextId++, pts: [{ t, u: blobs[i].x, v: blobs[i].y }], vx: 0, vy: 0 });
    }

    let live = null;
    for (const tr of this.tracks) if (tr.pts.length >= 4 && (!live || tr.pts.length > live.pts.length)) live = tr;

    // Once things have gone quiet, hand back every candidate path (longest first).
    // The ball is often lost for a frame or two at the bat, so pieces are stitched.
    let finished = null;
    if (this.closed.length) {
      const end = (tr) => tr.pts[tr.pts.length - 1].t;
      const newest = Math.max(...this.closed.map(end)), oldest = Math.min(...this.closed.map(end));
      const busy = this.tracks.some((tr) => tr.pts.length >= 4 && extent(tr) > 0.03 * W);
      if ((!busy && t - newest > 0.6) || t - oldest > 6) {
        const pool = this.closed.concat(this.tracks.filter((tr) => tr.pts.length >= 4));
        const seeds = this.closed.slice().sort((a, b) => extent(b) - extent(a));
        const usedTr = new Set();
        finished = [];
        const near = (p, q) => Math.hypot(p.u - q.u, p.v - q.v) <= 0.3 * W;
        for (const seed of seeds) {
          if (usedTr.has(seed) || finished.length >= 4) continue;
          usedTr.add(seed);
          let chain = seed.pts.slice();
          for (let guard = 0; guard < 4; guard++) {
            const lp = chain[chain.length - 1], fp = chain[0];
            let pick = null, mode = '';
            for (const tr of pool) {
              if (usedTr.has(tr)) continue;
              const f = tr.pts[0], l = tr.pts[tr.pts.length - 1];
              let how = '';
              if (f.t > lp.t && f.t - lp.t <= 0.3 && near(f, lp)) how = 'after';
              else if (fp.t > l.t && fp.t - l.t <= 0.3 && near(fp, l)) how = 'before';
              else if (f.t > fp.t && f.t <= lp.t && lp.t - f.t <= 0.25 && l.t > lp.t) {
                // Branch: the path wandered onto the bat/batter while the ball itself
                // carried on as a new track. Take the branch if it travels further.
                let j = chain.length - 1;
                while (j > 0 && chain[j].t >= f.t) j--;
                const tailPts = { pts: chain.slice(j) };
                if (near(f, chain[j]) && extent(tr) > 1.5 * extent(tailPts)) how = 'branch';
              }
              else if (f.t < fp.t && l.t >= fp.t && l.t - fp.t <= 0.25) {
                // The same situation seen from the other side: this chain is the branch, tr is the trunk.
                let j = tr.pts.length - 1;
                while (j > 0 && tr.pts[j].t >= fp.t) j--;
                if (near(fp, tr.pts[j]) && extent(tr) > 0.06 * W) how = 'trunk';
              }
              if (how && (!pick || tr.pts.length > pick.pts.length)) { pick = tr; mode = how; }
            }
            if (!pick) break;
            usedTr.add(pick);
            if (mode === 'before') chain = pick.pts.concat(chain);
            else if (mode === 'after') chain = chain.concat(pick.pts);
            else if (mode === 'trunk') chain = pick.pts.filter((q) => q.t < chain[0].t).concat(chain);
            else chain = chain.filter((q) => q.t < pick.pts[0].t).concat(pick.pts);
          }
          finished.push(chain);
        }
        this.tracks = this.tracks.filter((tr) => !usedTr.has(tr));
        this.closed = [];
      }
    }
    return { live: live ? live.pts : null, finished };
  }
}
