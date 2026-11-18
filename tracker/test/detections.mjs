// Reading detector outputs (both model kinds), the model description, labels and the zip.
import { parseYolo, parseDetr, detrOutputs, modelConfig, yoloLabel } from '../js/detections.js';
import { makeZip, crc32 } from '../js/zip.js';

export function detectionChecks(check) {
  // YOLO: [1, 4 + C, N]; class 2 is the ball here, two boxes on one ball and one elsewhere
  const C = 3, N = 4, y = new Float32Array((4 + C) * N);
  const set = (k, cx, cy, w, scores) => { y[k] = cx; y[N + k] = cy; y[2 * N + k] = w; y[3 * N + k] = w; scores.forEach((s, c) => { y[(4 + c) * N + k] = s; }); };
  set(0, 100, 200, 10, [0, 0, 0.9]); set(1, 104, 202, 11, [0, 0, 0.6]); set(2, 400, 300, 9, [0, 0, 0.5]); set(3, 50, 50, 30, [0.99, 0, 0.1]);
  const yh = parseYolo(y, [1, 4 + C, N], 2, 0.25);
  check('yolo: best box per ball, other classes ignored', yh.length === 2 && yh[0].x === 100 && yh[0].score > 0.89 && yh[1].x === 400);
  // DETR: boxes 0..1, logits; size 512
  const boxes = new Float32Array([0.5, 0.25, 0.02, 0.02, 0.9, 0.9, 0.5, 0.5]), logits = new Float32Array([3, -4, -5, -2]);
  const dh = parseDetr(boxes, [1, 2, 4], logits, [1, 2, 2], 0, 0.3, 512);
  check('detr: sigmoid scores, boxes scaled to pixels', dh.length === 1 && dh[0].x === 256 && dh[0].y === 128 && Math.abs(dh[0].score - 0.9526) < 1e-3);
  const outs = { a: { dims: [1, 300, 2], data: [] }, b: { dims: [1, 300, 4], data: [] } };
  const o = detrOutputs(outs);
  check('detr: outputs told apart by shape', o && o.boxes === outs.b && o.logits === outs.a);
  check('model description: default is YOLO11n ball class', modelConfig(null).file === 'yolo11n.onnx' && modelConfig(null).classIndex === 32);
  const mc = modelConfig({ file: 'ball.onnx', format: 'detr', size: 384, classIndex: 0, normalize: 'imagenet' });
  check('model description: a DETR model is read', mc.format === 'detr' && mc.size === 384 && mc.classIndex === 0 && mc.normalize === 'imagenet');
  check('model description: nonsense falls back safely', modelConfig({ format: 'x', size: -5, minScore: 7 }).format === 'yolo' && modelConfig({ size: -5 }).size === 64 && modelConfig({ minScore: 7 }).minScore === 0.95);
  check('label: YOLO format, clamped', yoloLabel(320, 160, 8, 640) === '0 0.500000 0.250000 0.012500 0.012500' && yoloLabel(-5, 700, 8, 640).startsWith('0 0.000000 1.000000'));
  // zip: standard CRC, structure
  check('zip: CRC-32 matches the standard check value', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  const z = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
  const dv = new DataView(z.buffer);
  check('zip: local header, then end record with one file', dv.getUint32(0, true) === 0x04034b50 && dv.getUint32(z.length - 22, true) === 0x06054b50 && dv.getUint16(z.length - 12, true) === 1);
}
