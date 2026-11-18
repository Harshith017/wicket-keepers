// Reading a ball detector's raw output, for the two kinds of model the tracker can run.
// Kept apart from ml.js (no browser APIs) so the tests can check it.
//
//   'yolo'  Ultralytics-style YOLO export: one output [1, 4 + classes, N], rows cx, cy, w, h
//           (input pixels) then one score per class. YOLO11n on COCO is this, ball = class 32.
//   'detr'  DETR-style export (RF-DETR, D-FINE, RT-DETR): boxes [1, N, 4] as cx, cy, w, h in 0..1,
//           and class logits [1, N, classes] (a sigmoid gives the score).
//
// Both return [{ x, y, w, score }] in the model's input pixels, best first, one per ball.

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Keeps the best of detections closer than `minGap` pixels (one ball, several boxes). */
export function keepBest(hits, minGap = 12) {
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const h of hits) if (kept.every((k) => Math.hypot(k.x - h.x, k.y - h.y) > minGap)) kept.push(h);
  return kept;
}

export function parseYolo(data, dims, classIndex, minScore) {
  const N = dims[2], hits = [];
  for (let k = 0; k < N; k++) {
    const s = data[(4 + classIndex) * N + k];
    if (s >= minScore) hits.push({ x: data[k], y: data[N + k], w: data[2 * N + k], score: s });
  }
  return keepBest(hits);
}

export function parseDetr(boxes, boxDims, logits, logitDims, classIndex, minScore, size) {
  const N = boxDims[1], C = logitDims[2], hits = [];
  for (let k = 0; k < N; k++) {
    const s = sigmoid(logits[k * C + classIndex]);
    if (s >= minScore) hits.push({ x: boxes[4 * k] * size, y: boxes[4 * k + 1] * size, w: boxes[4 * k + 2] * size, score: s });
  }
  return keepBest(hits);
}

/**
 * Picks the boxes and logits outputs of a DETR-style model by shape: boxes end in 4,
 * logits are the other [1, N, C] output. `outs` maps names to { dims, data }.
 */
export function detrOutputs(outs) {
  const list = Object.values(outs).filter((t) => t.dims.length === 3);
  const boxes = list.find((t) => t.dims[2] === 4);
  const logits = list.find((t) => t !== boxes && t.dims[1] === (boxes && boxes.dims[1]));
  return boxes && logits ? { boxes, logits } : null;
}

/** The default model: YOLO11n trained on COCO, its "sports ball" class. */
export const DEFAULT_MODEL = { file: 'yolo11n.onnx', format: 'yolo', size: 640, classIndex: 32, normalize: 'unit', minScore: 0.25 };

/** A model description (vendor/ball-model.json) with anything missing filled from the default. */
export function modelConfig(json) {
  const c = { ...DEFAULT_MODEL, ...(json || {}) };
  if (!['yolo', 'detr'].includes(c.format)) c.format = 'yolo';
  if (!['unit', 'imagenet'].includes(c.normalize)) c.normalize = 'unit';
  c.size = Math.max(64, Math.min(1280, Math.round(+c.size) || 640));
  c.classIndex = Math.max(0, Math.round(+c.classIndex) || 0);
  c.minScore = Math.min(0.95, Math.max(0.05, +c.minScore || 0.25));
  return c;
}

/** YOLO-format label line for a ball centred at (cx, cy) of size `w` pixels, in an image `size` pixels square. */
export function yoloLabel(cx, cy, w, size) {
  const f = (v) => Math.min(1, Math.max(0, v / size)).toFixed(6);
  return `0 ${f(cx)} ${f(cy)} ${f(w)} ${f(w)}`;
}

/**
 * The files of a training export: samples are [{ name, bytes (JPEG), label, x, y, ball }] in
 * time order. YOLO layout (images/train, labels/train, data.yaml) plus one table per ball,
 * frame by frame (sequences/<ball>.csv: Frame, Visibility, X, Y, Image), for trackers that
 * learn from consecutive frames, and a README.
 */
export function trainingFiles(samples) {
  const enc = new TextEncoder(), files = [];
  for (const t of samples) {
    files.push({ name: `images/train/${t.name}.jpg`, data: t.bytes });
    files.push({ name: `labels/train/${t.name}.txt`, data: enc.encode(t.label ? t.label + '\n' : '') });
  }
  const byBall = new Map();
  for (const t of samples) { if (!byBall.has(t.ball)) byBall.set(t.ball, []); byBall.get(t.ball).push(t); }
  for (const [id, list] of byBall) {
    const rows = list.map((t, i) => `${i},${t.label ? 1 : 0},${t.label ? t.x.toFixed(1) : 0},${t.label ? t.y.toFixed(1) : 0},${t.name}.jpg`);
    files.push({ name: `sequences/${id}.csv`, data: enc.encode('Frame,Visibility,X,Y,Image\n' + rows.join('\n') + '\n') });
  }
  files.push({ name: 'data.yaml', data: enc.encode("train: images/train\nval: images/train\nnc: 1\nnames: ['ball']\n") });
  files.push({ name: 'README.txt', data: enc.encode(
    'Wicket Keepers ball tracker: training frames for a cricket-ball detector.\n\n'
    + 'Each image is a 640x640 crop of the batter\'s end, as the detector sees it. Labels are YOLO format\n'
    + '(class 0 = ball) and come from where the tracker placed the ball: check every frame. An empty\n'
    + 'label file means the tracker did not place the ball there; the ball may still be in the picture.\n'
    + 'sequences/*.csv lists each ball\'s frames in order (Frame, Visibility, X, Y, Image) for trackers\n'
    + 'that learn from consecutive frames, such as TrackNet.\n'
    + 'See tracker/MODEL.md in the repository for labelling and training.\n') });
  return files;
}

/**
 * The frames of one ball worth sending to the training pipeline without anyone checking
 * them: those where the detector itself confirmed the ball (score at least `minScore`), at
 * most `max`, spread evenly over the ball's approach. Frames only the motion tracker placed,
 * or with no ball placed, are left out: an unchecked wrong label teaches the model wrong.
 */
export function pickForUpload(samples, max = 8, minScore = 0.5) {
  const good = samples.filter((t) => t.label && t.by === 'detector' && t.score >= minScore);
  if (good.length <= max) return good;
  const out = [];
  for (let k = 0; k < max; k++) out.push(good[Math.round(k * (good.length - 1) / (max - 1))]);
  return out;
}
