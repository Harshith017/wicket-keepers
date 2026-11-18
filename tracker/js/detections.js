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
