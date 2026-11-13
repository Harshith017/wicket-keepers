// Finds the ball near the batter with a small trained detector (YOLO11n, the
// COCO "sports ball" class) running in the browser on ONNX Runtime.
//
// Motion detection follows the ball well from the bowler's hand down the pitch,
// but loses it against the batter's whites. The detector picks it up there, which
// is where the "reached the bat" moment for the speed comes from.
//
// While recording, sharp crops around the batter's end are kept for the last few
// seconds; after each delivery the detector runs over the frames around the batter.

const BALL = 32, SIZE = 640, MIN_SCORE = 0.25;
let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/** Loads the runtime and the model once (about 25 MB, cached by the browser after the first time). */
export function loadDetector() {
  if (!loading) {
    loading = (async () => {
      const base = new URL('vendor/', location.href).href;
      if (!window.ort) await loadScript(base + 'ort.wasm.min.js');
      const ort = window.ort;
      ort.env.wasm.wasmPaths = base;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      return ort.InferenceSession.create(base + 'yolo11n.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const work = document.createElement('canvas');
work.width = work.height = SIZE;
const wctx = work.getContext('2d', { willReadFrequently: true });

/** Ball detections in a 640x640 image source: [{ x, y, score }] in that image's pixels. */
export async function detectBalls(img) {
  const session = await loadDetector(), ort = window.ort;
  wctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = wctx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, inp = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { inp[i] = px[j] / 255; inp[n + i] = px[j + 1] / 255; inp[2 * n + i] = px[j + 2] / 255; }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, SIZE, SIZE]) });
  const t = out[session.outputNames[0]], N = t.dims[2], d = t.data, hits = [];
  for (let k = 0; k < N; k++) {
    const s = d[(4 + BALL) * N + k];
    if (s >= MIN_SCORE) hits.push({ x: d[k], y: d[N + k], score: s });
  }
  // keep the best of overlapping boxes
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const h of hits) if (kept.every((k) => Math.hypot(k.x - h.x, k.y - h.y) > 12)) kept.push(h);
  return kept;
}

/**
 * Keeps sharp crops of the batter's end of the picture (from the full-resolution
 * video, not the scaled-down working frame) for the last few seconds.
 */
export class CropRing {
  constructor(seconds = 4) { this.seconds = seconds; this.frames = []; this.pool = []; this.busy = 0; }
  reset() { this.frames = []; }
  /** rect: { x, y, w, h } in the source's own pixels. */
  capture(source, rect, t) {
    if (this.busy > 4) return;
    const c = this.pool.pop() || document.createElement('canvas');
    c.width = c.height = SIZE;
    c.getContext('2d').drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, SIZE, SIZE);
    this.busy++;
    c.toBlob((b) => {
      this.busy--; this.pool.push(c);
      if (!b) return;
      const f = this.frames;
      let i = f.length;
      while (i > 0 && f[i - 1].t > t) i--;
      f.splice(i, 0, { t, b, rect: { ...rect } });
      const cut = f[f.length - 1].t - this.seconds;
      while (f.length && f[0].t < cut) f.shift();
    }, 'image/jpeg', 0.9);
  }
  async between(t0, t1) {
    for (let k = 0; k < 40 && this.busy > 0; k++) await new Promise((r) => setTimeout(r, 25));
    return this.frames.filter((f) => f.t >= t0 && f.t <= t1);
  }
}

/**
 * Follows the ball from where motion tracking lost it into the batter, using the
 * detector on the saved crops. `toView(rect, x, y)` maps crop pixels to working-frame
 * pixels. Returns the extra points [{ t, u, v, score }] in time order.
 */
export async function followToBatter(frames, start, toView, onProgress) {
  const pts = [];
  let last = start, vel = null, firstSpeed = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.t <= last.t + 1e-4) continue;
    const bmp = await createImageBitmap(f.b);
    const hits = (await detectBalls(bmp)).map((h) => ({ ...toView(f.rect, h.x, h.y), score: h.score }));
    if (bmp.close) bmp.close();
    if (onProgress) onProgress(i / frames.length);
    const dt = f.t - last.t;
    let best = null;
    if (!pts.length) {
      // First pickup: the ball has often bounced since motion tracking lost it, so its
      // old direction is no help. Take a confident detection near where it was last seen.
      for (const h of hits) {
        const d = Math.hypot(h.u - last.u, h.v - last.v);
        if (h.score >= 0.4 && d < 120 + 600 * dt && (!best || h.score > best.score)) best = h;
      }
      if (!best) { if (dt > 0.35) break; continue; }
      last = { t: f.t, u: best.u, v: best.v };
      pts.push({ ...last, score: best.score });
      continue;
    }
    const px = last.u + (vel ? vel[0] * dt : 0), py = last.v + (vel ? vel[1] * dt : 0);
    const gate = vel ? 14 + 0.6 * Math.hypot(vel[0], vel[1]) * dt : 50;
    for (const h of hits) {
      const d = Math.hypot(h.u - px, h.v - py);
      if (d < gate && (!best || d - 20 * h.score < best.d - 20 * best.score)) best = { ...h, d };
    }
    // in plain view near the batter, a few missed frames mean the bat or pad has it
    if (!best) { if (dt > 0.06) break; continue; }
    const nv = [(best.u - last.u) / dt, (best.v - last.v) / dt], sp = Math.hypot(nv[0], nv[1]);
    if (vel) {
      // a sharp change of direction, or a sharp loss of speed: it has met the bat or pad
      const a = Math.hypot(vel[0], vel[1]);
      if (a > 1 && sp > 1 && (vel[0] * nv[0] + vel[1] * nv[1]) / (a * sp) < 0.5) break;
      if (firstSpeed && pts.length >= 3 && sp < 0.55 * firstSpeed) break;
    }
    vel = vel ? [0.5 * vel[0] + 0.5 * nv[0], 0.5 * vel[1] + 0.5 * nv[1]] : nv;
    if (pts.length === 2) firstSpeed = Math.hypot(vel[0], vel[1]);
    last = { t: f.t, u: best.u, v: best.v };
    pts.push({ ...last, score: best.score });
  }
  return pts;
}
