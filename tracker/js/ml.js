// Finds the ball near the batter with a small trained detector running in the browser on
// ONNX Runtime. By default that is YOLO11n and its COCO "sports ball" class; a model trained
// on cricket balls can be swapped in with vendor/ball-model.json (see MODEL.md).
//
// Motion detection follows the ball well from the bowler's hand down the pitch,
// but loses it against the batter's whites. The detector picks it up there, which
// is where the "reached the bat" moment for the speed comes from.
//
// While recording, sharp crops around the batter's end are kept for the last few
// seconds; after each delivery the detector runs over the frames around the batter.

import { contactTime } from './bowling.js';
import { modelConfig, parseYolo, parseDetr, detrOutputs } from './detections.js';

const SIZE = 640;            // the crops kept around the batter's end
let loading = null, config = modelConfig(null);
const IMAGENET_MEAN = [0.485, 0.456, 0.406], IMAGENET_STD = [0.229, 0.224, 0.225];

/** The model in use: { file, format, size, classIndex, normalize, minScore, name? }. */
export const detectorInfo = () => config;

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
      // a cricket-ball model, if one has been added, else the default
      try {
        const r = await fetch(base + 'ball-model.json', { cache: 'no-cache' });
        if (r.ok) config = modelConfig(await r.json());
      } catch (e) { /* no file: the default model */ }
      work.width = work.height = config.size;
      return ort.InferenceSession.create(base + config.file, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const work = document.createElement('canvas');
work.width = work.height = SIZE;
const wctx = work.getContext('2d', { willReadFrequently: true });

/** Ball detections in a 640x640 image source: [{ x, y, w, score }] in that image's pixels. */
export async function detectBalls(img) {
  const session = await loadDetector(), ort = window.ort, M = config.size;
  wctx.drawImage(img, 0, 0, M, M);
  const px = wctx.getImageData(0, 0, M, M).data, n = M * M, inp = new Float32Array(3 * n);
  const net = config.normalize === 'imagenet';
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    for (let c = 0; c < 3; c++) {
      const v = px[j + c] / 255;
      inp[c * n + i] = net ? (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c] : v;
    }
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, M, M]) });
  let hits;
  if (config.format === 'detr') {
    const o = detrOutputs(out);
    if (!o) throw new Error('model outputs are not boxes and class scores');
    hits = parseDetr(o.boxes.data, o.boxes.dims, o.logits.data, o.logits.dims, config.classIndex, config.minScore, M);
  } else {
    const t = out[session.outputNames[0]];
    hits = parseYolo(t.data, t.dims, config.classIndex, config.minScore);
  }
  // back to the 640 crop's pixels
  const k = SIZE / M;
  return hits.map((h) => ({ x: h.x * k, y: h.y * k, w: h.w * k, score: h.score }));
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
  /** The frame kept nearest to time t, within `tol` seconds, or null. */
  at(t, tol = 0.006) {
    let best = null;
    for (const f of this.frames) if (Math.abs(f.t - t) <= tol && (!best || Math.abs(f.t - t) < Math.abs(best.t - t))) best = f;
    return best;
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
export async function followToBatter(frames, start, toView, onProgress, allowed = () => true) {
  const pts = [];
  let last = start, vel = null, firstSpeed = null;
  const hitsAt = async (f) => {
    const bmp = await createImageBitmap(f.b);
    // balls in the next net, or lying about, are not ours
    const hits = (await detectBalls(bmp)).map((h) => ({ ...toView(f.rect, h.x, h.y), score: h.score })).filter((h) => allowed(h.u, h.v));
    if (bmp.close) bmp.close();
    return hits;
  };
  // The contact, between frames: from the paths in and out when the ball is seen leaving the
  // bat or pad, else half a frame after it was last seen on the way in.
  const steps = [];
  for (let i = 1; i < frames.length; i++) if (frames[i].t > frames[i - 1].t) steps.push(frames[i].t - frames[i - 1].t);
  steps.sort((a, b) => a - b);
  const frameDt = steps.length ? steps[steps.length >> 1] : 1 / 60;
  const finish = async (i, out) => {
    if (pts.length) {
      const before = [start, ...pts].slice(-3);
      const after = out ? [out] : [];
      if (out && vel) {
        // one more frame on the way out gives the direction it left in
        for (let k = i + 1; k < frames.length && k <= i + 2 && after.length < 2; k++) {
          const g = frames[k];
          const ddt = g.t - out.t, px = out.u + (out.u - last.u) / (out.t - last.t) * ddt, py = out.v + (out.v - last.v) / (out.t - last.t) * ddt;
          let b2 = null;
          for (const h of await hitsAt(g)) { const d = Math.hypot(h.u - px, h.v - py); if (d < 40 + 400 * ddt && (!b2 || d < b2.d)) b2 = { t: g.t, u: h.u, v: h.v, d }; }
          if (b2) after.push(b2);
        }
      }
      pts.contact = after.length ? contactTime(before, after) : last.t + frameDt / 2;
    }
    return pts;
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.t <= last.t + 1e-4) continue;
    const hits = await hitsAt(f);
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
    if (!best) { if (dt > 0.06) return finish(i, null); continue; }
    const nv = [(best.u - last.u) / dt, (best.v - last.v) / dt], sp = Math.hypot(nv[0], nv[1]);
    if (vel) {
      // a sharp change of direction, or a sharp loss of speed: it has met the bat or pad
      const a = Math.hypot(vel[0], vel[1]);
      const out = { t: f.t, u: best.u, v: best.v };
      if (a > 1 && sp > 1 && (vel[0] * nv[0] + vel[1] * nv[1]) / (a * sp) < 0.5) return finish(i, out);
      if (firstSpeed && pts.length >= 3 && sp < 0.55 * firstSpeed) return finish(i, out);
    }
    vel = vel ? [0.5 * vel[0] + 0.5 * nv[0], 0.5 * vel[1] + 0.5 * nv[1]] : nv;
    if (pts.length === 2) firstSpeed = Math.hypot(vel[0], vel[1]);
    last = { t: f.t, u: best.u, v: best.v };
    pts.push({ ...last, score: best.score });
  }
  return finish(frames.length, null);
}

/**
 * Is this tracked path a ball? Up to `n` points along it are looked at in the sharp crops kept
 * of the ball's flight (`ring`, a CropRing): a small window around each point goes through the
 * ball detector, and a point counts when it finds a ball close to where the tracker put it.
 * `toCrop(rect, u, v)` maps working-frame pixels to the crop's 640 pixels.
 * Returns { checked, hits }: how many points could be looked at, and how many showed a ball.
 */
export async function confirmBall(path, ring, toCrop, n = 5) {
  const WIN = 240, R = 26;
  // A busy phone skips some crops: look only at points with a crop kept within about a frame of
  // them, spread along the path.
  const pts = (path.length > 6 ? path.slice(1) : path).filter((p) => ring.at(p.t, 0.02));
  const pick = pts.length <= n ? pts : Array.from({ length: n }, (_, j) => pts[Math.round(j * (pts.length - 1) / (n - 1))]);
  const win = document.createElement('canvas');
  win.width = win.height = WIN;
  const wctx2 = win.getContext('2d');
  let checked = 0, hits = 0;
  for (const p of pick) {
    const f = ring.at(p.t, 0.02);
    if (!f) continue;
    const c = toCrop(f.rect, p.u, p.v);
    if (c.x < 0 || c.y < 0 || c.x >= SIZE || c.y >= SIZE) continue;
    const bmp = await createImageBitmap(f.b);
    const x0 = Math.min(SIZE - WIN, Math.max(0, Math.round(c.x - WIN / 2))), y0 = Math.min(SIZE - WIN, Math.max(0, Math.round(c.y - WIN / 2)));
    wctx2.drawImage(bmp, x0, y0, WIN, WIN, 0, 0, WIN, WIN);
    if (bmp.close) bmp.close();
    checked++;
    const k = WIN / SIZE;      // detectBalls answers in 640 pixels of whatever it was given
    const found = (await detectBalls(win)).some((h) => h.score >= 0.5 && Math.hypot(h.x * k + x0 - c.x, h.y * k + y0 - c.y) < R);
    if (found) hits++;
  }
  return { checked, hits };
}
