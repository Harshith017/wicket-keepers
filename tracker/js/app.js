import { calibrate, calibrateFromTaps, project, makeCam, groundPoint } from './geometry.js';
import { MapView } from './maps.js';
import { analyseTrack, sampleSegments, simulateShot, runsFor, segPos, shotTrack, CREASE, STUMP_H } from './physics.js';
import { FrameRing, Player } from './clips.js';
import { measureDelivery, deliveryStart, deliveryCheck, reachesBatter, pitchRegion, tofSpeed, distanceFromKnown, flightDistance, frameRateNote, CONTACT_AHEAD } from './bowling.js';
import { decodeClipAudio, soundContact } from './sound.js';
import { yoloLabel, trainingFiles, pickForUpload } from './detections.js';
import { signIn, signOut, signedInEmail, sendFrames } from './pipeline.js';
import { makeZip } from './zip.js';
import { CropRing, followToBatter, loadDetector } from './ml.js';
import { findStumps, findNearStump, findFarStumps } from './stumps.js';
import { putSession, allSessions, putClip, getClip, deleteSession } from './store.js';
import { Detector, Tracker } from './detector.js';
import { FieldView, makeField, positionName, PRESETS } from './field.js';
import { DemoSource } from './sim.js';

const $ = (id) => document.getElementById(id);
const STORE = 'wkt:v1';
const MIN_CAM_HEIGHT = 1.5;      // metres
const MAX_VIEW = 1280;           // frames are worked on at up to this many pixels on the long side

// ---------------------------------------------------------------- state
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
const settings = Object.assign({ L: 20.12, rectW: 3.05, units: 'kmh', sens: 45, procW: 960, slowmo: 1, calMode: 'quick', camH: 150, sound: 'off', collect: 'off', autoSend: 'off' }, saved.settings);
if (settings.calMode === 'stumps') settings.calMode = 'quick';      // the old stump mode became the quick setup
const F = {                                   // field state, shared by both field views
  L: settings.L, boundary: saved.boundary || 65, hand: saved.hand || 'R',
  preset: saved.preset || 'balanced', fielders: saved.fielders || null,
};
if (!F.fielders) F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
const S = {
  source: null, cam: null, camInfo: '', calibrating: false, armed: true,
  calibPts: saved.calibPts || [[0.42, 0.42], [0.58, 0.42], [0.72, 0.85], [0.28, 0.85]],   // striker L, striker R, bowler R, bowler L
  quickPts: (saved.quickPts && saved.quickPtsV === 2) ? saved.quickPts : [[0.5, 0.45], [0.5, 0.92], [0.5, 0.41]],   // batter's stumps base, own stumps base, top of batter's stumps
  session: null, sessions: [], viewSession: null,
  last: null, live: null, lastT: -1, drag: -1,
  fps: 0, fpsN: 0, fpsT0: 0, status: '', statusKind: '',
};
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      settings, boundary: F.boundary, hand: F.hand, preset: F.preset, fielders: F.fielders,
      calibPts: S.calibPts, quickPts: S.quickPts, quickPtsV: 2,
    }));
  } catch (e) { /* storage unavailable: carry on without persistence */ }
}

const detector = new Detector(), tracker = new Tracker(), ring = new FrameRing(), crops = new CropRing();
const curBalls = () => (S.session ? S.session.balls : []);
const view = $('view'), vctx = view.getContext('2d');
const proc = document.createElement('canvas'), pctx = proc.getContext('2d', { willReadFrequently: true });
const video = $('video');

// ---------------------------------------------------------------- sources
class VideoSource {
  constructor(kind) { this.kind = kind; this.running = false; }
  // 4K or portrait video is worked on scaled down to MAX_VIEW on its long side.
  get scale() { return Math.min(1, MAX_VIEW / Math.max(video.videoWidth || 1, video.videoHeight || 1)); }
  get width() { return Math.round(video.videoWidth * this.scale); }
  get height() { return Math.round(video.videoHeight * this.scale); }
  async open(file) {
    if (this.kind === 'camera') {
      // Insist on 60 fps first: with only an "ideal" hint most phones quietly
      // hand back 30. Phones usually offer 60 at 720p or 1080p, so try both
      // before settling for whatever the camera will give.
      const base = { facingMode: { ideal: 'environment' } };
      const ladder = [
        { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { min: 55, ideal: 60 } },
        { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { min: 55, ideal: 60 } },
        { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      ];
      let lastErr = null;
      for (const videoC of ladder) {
        try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoC }); break; }
        catch (err) {
          lastErr = err;
          if (err.name !== 'OverconstrainedError' && err.name !== 'ConstraintNotSatisfiedError') throw err;   // e.g. permission denied
        }
      }
      if (!this.stream) throw lastErr;
      const st = this.stream.getVideoTracks()[0].getSettings();
      this.camFps = st.frameRate ? Math.round(st.frameRate) : null;
      video.srcObject = this.stream; video.loop = false;
    } else {
      this.url = URL.createObjectURL(file);
      this.file = file; this.audio = null;
      video.srcObject = null; video.loop = false;
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      // iPhone Safari only reports the clip's size until it is played, so wait for
      // that, then play and pause to get the first frame decoded.
      const ready = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 20000);
        video.onloadedmetadata = () => { clearTimeout(t); resolve(); };
        video.onerror = () => { clearTimeout(t); reject(new Error(video.error && video.error.code === 4 ? 'format' : 'decode')); };
      });
      video.src = this.url; video.load();
      await ready;
      try { await video.play(); } catch (e) { /* some browsers refuse; the seek below still gives a frame */ }
      video.pause();
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 3000);
        video.onseeked = () => { clearTimeout(t); resolve(); };
        video.currentTime = 0;
      });
      if (!video.videoWidth) throw new Error('format');
    }
    video.muted = true;
    if (this.kind === 'file') { video.pause(); video.currentTime = 0; return; }   // waits on the first frame for calibration
    await video.play();
  }
  /** Play a clip from the start. It is analysed at quarter speed so every frame is looked at, even 4K at 60 fps. */
  async playFromStart() {
    video.onended = () => { video.onended = null; onClipEnd(); };
    video.currentTime = 0;
    this.frameSteps = []; this.lastMediaTime = null; this.clipFps = null;
    await video.play();
    video.playbackRate = window.__clipRate || 0.25;
    if (!this.running) this.start(this.onFrame);
  }
  get paused() { return this.kind === 'file' && video.paused; }
  /** The clip's own frame rate, from the steps between the frames it shows (a skipped frame does not count). */
  noteFrame(mt) {
    if (this.lastMediaTime != null) { const d = mt - this.lastMediaTime; if (d > 0 && d < 0.5) this.frameSteps.push(d); }
    this.lastMediaTime = mt;
    if (this.frameSteps.length === 30) {
      // the short steps are the clip's own frame interval: a busy phone that skips frames only
      // adds longer ones, so take a low percentile, not the median
      const s = this.frameSteps.slice().sort((a, b) => a - b);
      this.clipFps = 1 / s[Math.floor(s.length * 0.1)];
      showClipRate(this);
    }
  }
  start(onFrame) {
    this.running = true; this.onFrame = onFrame;
    if (this.kind === 'file' && video.paused) setTimeout(() => onFrame(video.currentTime), 0);   // show the first frame
    const useRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    const tick = (now, meta) => {
      if (!this.running) return;
      let t;
      if (this.kind === 'file') {
        t = (meta ? meta.mediaTime : video.currentTime) / Math.max(1, settings.slowmo);
        if (meta && this.frameSteps) this.noteFrame(meta.mediaTime);
      }
      else t = meta ? (meta.captureTime !== undefined ? meta.captureTime / 1000 : meta.mediaTime) : now / 1000;
      onFrame(t);
      if (useRvfc) video.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
    };
    if (useRvfc) video.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
  }
  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    video.pause(); video.srcObject = null;
    if (this.url) { URL.revokeObjectURL(this.url); video.removeAttribute('src'); video.load(); }
  }
  drawTo(ctx, w, h) { ctx.drawImage(video, 0, 0, w, h); }
}

let wakeLock = null;
async function setSource(kind, file) {
  if (S.source) { S.source.stop(); S.source = null; }
  detector.reset(); tracker.reset(); ring.reset(); S.live = null; S.lastT = -1; S.lastBallEnd = -100; S.calibrating = false;
  if (S.session) await endSession(false);
  document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.src === kind));
  try {
    let src;
    if (kind === 'demo') src = new DemoSource(settings.L, settings.rectW);
    else { src = new VideoSource(kind); await src.open(file); }
    S.source = src;
    $('stageEmpty').hidden = true; $('pill').hidden = false;
    recalibrate();
    src.start(onFrame);
    if (kind === 'file') S.status = 'Clip loaded \u2014 finding the stumps\u2026';
    if (kind !== 'demo') setTimeout(async () => { if (S.calibrating) return; const ok = await autoCalibrate(false); S.status = ok ? (kind === 'file' ? 'Stumps found \u2014 tap Start session' : 'Stumps found \u2014 ready') : 'Couldn\u2019t find the stumps \u2014 tap Calibrate pitch'; updatePill(); }, kind === 'file' ? 300 : 1200);
    if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
  } catch (err) {
    document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.remove('on'));
    $('stageEmpty').hidden = false; $('pill').hidden = true;
    $('stageEmpty').innerHTML = kind === 'camera'
      ? '<b>Camera unavailable</b><span>Allow camera access for this page (it needs HTTPS), or try a video clip or the demo.</span>'
      : err && err.message === 'timeout'
        ? '<b>The clip didn\u2019t load</b><span>It took more than 20 seconds. Try a shorter clip (under a minute), or trim it in Photos first.</span>'
        : '<b>This browser can\u2019t play that clip</b><span>iPhone videos are HEVC with HDR, which only Safari plays reliably. Open this page in Safari, or set Settings \u203a Camera \u203a Formats to Most Compatible and turn off HDR Video, then record again.</span>';
  }
  syncControls();
}

// ---------------------------------------------------------------- calibration
const quick = () => settings.calMode === 'quick';
// Guided calibration: one point at a time on a still picture. Order: your stump, then the batter's.
const STEP_PT = [1, 0, 2];
const STEPS = [
  ['Bottom of your stump', 'The stump nearest the camera, where it meets the ground.'],
  ['Bottom of the batter\u2019s stumps', 'Where the far stumps meet the ground.'],
  ['Top of the batter\u2019s stumps', 'The very top of the far stumps (the bails).'],
];
const SLIDE_GAIN = 0.3;
const guided = () => S.calibrating && quick() && S.calStep != null && !S.tapStep;
const handlePts = () => (quick() ? S.quickPts : S.calibPts);
function demoPts(src) {
  if (!quick()) return src.corners();
  const L = settings.L;
  return [[0, 0, 0], [0, L, 0], [0, 0, STUMP_H]].map((X) => { const q = project(src.cam, X); return [q[0] / src.width, q[1] / src.height]; });
}
const activePts = () => (S.source && S.source.kind === 'demo' ? demoPts(S.source) : handlePts());
const camHeight = () => (S.source && S.source.kind === 'demo' ? S.source.cam.C[2] : settings.camH / 100);
function recalibrate() {
  const src = S.source;
  S.cam = null; S.camInfo = ''; S.camLow = false;
  if (!src || !src.width) return;
  const W = src.width, H = src.height;
  const px = activePts().map(([x, y]) => [x * W, y * H]);
  if (quick()) {
    const r = calibrateFromTaps(px[0], px[1], px[2], camHeight(), null, W, H, settings.L);
    if (r && r.rms < 0.004 * Math.max(W, H)) {
      S.cam = r.cam;
      S.camLow = camHeight() < MIN_CAM_HEIGHT;
      S.camInfo = `Camera ${(camHeight() * 100).toFixed(0)} cm high, ${r.distBehind.toFixed(1)} m behind your stumps`
        + (S.camLow ? `. Raise it to at least ${MIN_CAM_HEIGHT * 100} cm; this low, speed and length readings are unreliable` : '');
    } else S.camInfo = 'Those markers don\u2019t fit: check they are on the bottom and top of the batter\u2019s stumps and the bottom of yours.';
  } else {
    const r = calibrate(px, settings.rectW, settings.L, W, H);
    if (r && r.rms < 0.02 * W) {
      S.cam = r.cam;
      const C = r.cam.C;
      S.camLow = C[2] < MIN_CAM_HEIGHT;
      S.camInfo = `Camera ${(C[2] * 100).toFixed(0)} cm high, ${Math.hypot(C[0], C[1]).toFixed(0)} m from the striker's stumps`
        + (S.camLow ? `. Raise it to at least ${MIN_CAM_HEIGHT * 100} cm; this low, speed and length readings are unreliable` : '');
    } else S.camInfo = 'Those corners don\u2019t form a pitch the camera could be seeing \u2014 adjust them.';
  }
  tracker.W = W;
  let info = src.kind === 'demo' ? 'Demo scene is calibrated automatically. ' + S.camInfo : S.camInfo;
  if (src.kind === 'camera' && src.camFps) {
    info += src.camFps >= 55 ? ` \u00b7 Camera running at ${src.camFps} fps.`
      : ` \u00b7 This browser only gave ${src.camFps} fps, so fast balls will read less accurately.`;
    info += ' ' + frameRateNote(src.camFps, settings.L);
  }
  $('calInfo').textContent = info;
}

/** Under the picture: the clip's frame rate, in real time, and what it means for speed. */
function showClipRate(src) {
  const slow = Math.max(1, settings.slowmo), real = src.clipFps * slow;
  const what = slow > 1 ? `Clip ${Math.round(src.clipFps)} fps, slowed ${slow}\u00d7: ${Math.round(real)} fps in real time.` : `Clip ${Math.round(real)} fps.`;
  const base = ($('calInfo').textContent || '').split(' \u00b7 Clip ')[0];
  $('calInfo').textContent = `${base} \u00b7 ${what} ${frameRateNote(real, settings.L)}`;
}

function canvasPos(e) {
  const r = view.getBoundingClientRect();
  // the canvas uses object-fit: contain inside the stage
  const sc = Math.min(r.width / view.width, r.height / view.height);
  const ox = (r.width - view.width * sc) / 2, oy = (r.height - view.height * sc) / 2;
  return [(e.clientX - r.left - ox) / (view.width * sc), (e.clientY - r.top - oy) / (view.height * sc), sc];
}
// Where a handle is drawn relative to the point it marks (stump handles sit to one side).
const handleOffset = () => 0;
view.addEventListener('pointerdown', (e) => {
  if (S.tapStep) { onStumpTap(e); return; }
  if (!S.calibrating) return;
  if (guided()) {
    // trackpad-style: slide anywhere, the cross follows at a fraction of the finger's movement
    const [x, y] = canvasPos(e), i = STEP_PT[S.calStep];
    S.drag = i; S.dragFrom = [x, y]; S.dragStart = handlePts()[i].slice();
    view.setPointerCapture(e.pointerId); e.preventDefault();
    return;
  }
  const [x, y, sc] = canvasPos(e), ar = view.height / view.width;
  let bi = -1, bd = 44 / (sc * view.width);
  handlePts().forEach((p, i) => {
    const d = Math.min(Math.hypot(p[0] - x, (p[1] - y) * ar), Math.hypot(p[0] + handleOffset(i) - x, (p[1] - y) * ar));
    if (d < bd) { bd = d; bi = i; }
  });
  if (bi >= 0) {
    // Keep the grab offset so the point does not jump under the finger.
    S.drag = bi; S.dragOff = [handlePts()[bi][0] - x, handlePts()[bi][1] - y];
    view.setPointerCapture(e.pointerId); e.preventDefault();
  }
});
view.addEventListener('pointermove', (e) => {
  if (S.drag < 0) return;
  const [x, y] = canvasPos(e);
  if (guided()) {
    const g = SLIDE_GAIN, p0 = S.dragStart;
    handlePts()[S.drag] = [Math.min(1, Math.max(0, p0[0] + (x - S.dragFrom[0]) * g)), Math.min(1, Math.max(0, p0[1] + (y - S.dragFrom[1]) * g))];
    recalibrate(); refresh();
    return;
  }
  handlePts()[S.drag] = [Math.min(1, Math.max(0, x + S.dragOff[0])), Math.min(1, Math.max(0, y + S.dragOff[1]))];
  recalibrate();
  refresh();
});
const endDrag = () => { if (S.drag >= 0) { S.drag = -1; save(); refresh(); syncControls(); if (!S.freeze) grabFrame().then(rememberStumps); } };
// A paused clip has no new frames coming, so redraw by hand.
function refresh() { if (S.source && S.source.paused) onFrame(Math.max(0, S.lastT)); }
view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- frame loop
function onFrame(t) {
  const src = S.source;
  if (!src || !src.width) return;
  const W = src.width, H = src.height;
  if (view.width !== W || view.height !== H) {
    view.width = W; view.height = H;
    $('stage').style.aspectRatio = `${W} / ${H}`;
    recalibrate();
  }
  if (t < S.lastT || t - S.lastT > 1.5) { detector.reset(); tracker.reset(); S.live = null; S.lastBallEnd = -100; }
  S.lastT = t;
  if (S.freeze && S.calibrating && S.freeze.width === W) vctx.putImageData(S.freeze, 0, 0);
  else src.drawTo(vctx, W, H);
  if (S.wantFrame) { const r = S.wantFrame; S.wantFrame = null; r(vctx.getImageData(0, 0, W, H)); }
  if (S.drag >= 0 || guided()) grabLoupe(W, H);
  if (S.session) ring.capture(view, t);
  if (S.session && S.cam && src.kind !== 'demo') captureBatterEnd(t);

  if (S.session && S.cam && !S.calibrating) {
    const pw = Math.min(W, settings.procW), ph = Math.round(H * pw / W);
    S.procScale = pw / 720;
    if (proc.width !== pw || proc.height !== ph) { proc.width = pw; proc.height = ph; }
    pctx.drawImage(view, 0, 0, pw, ph);
    detector.thr = settings.sens;
    const det = detector.process(pctx.getImageData(0, 0, pw, ph), t);
    if (det) {
      const k = W / pw;
      const blobs = det.noisy ? [] : det.blobs.map((b) => ({ x: b.x * k, y: b.y * k, n: b.n }));   // n stays in detector pixels: only ratios are used
      const res = tracker.update(blobs, det.t);
      S.live = res.live;
      if (res.finished) onTrack(res.finished);
    }
  } else S.live = null;

  S.fpsN++;
  const now = performance.now();
  if (now - S.fpsT0 > 1000) { S.fps = S.fpsN * 1000 / (now - S.fpsT0); S.fpsN = 0; S.fpsT0 = now; updatePill(); }
  drawOverlay(W, H);
}

function updatePill() {
  let txt, kind = 'live';
  if (!S.cam) { txt = 'Not calibrated'; kind = 'bad'; }
  else if (S.calibrating) { txt = guided() ? `Step ${S.calStep + 1} of 3: ${STEPS[S.calStep][0].toLowerCase()}` : quick() ? 'Drag the three markers into place' : 'Drag the corners onto the pitch'; kind = 'busy'; }
  else if (!S.session) { txt = 'Ready \u2014 tap Start session'; kind = ''; }
  else if (S.camLow && !S.live) { txt = `Camera too low \u2014 raise it to ${MIN_CAM_HEIGHT * 100} cm or more`; kind = 'bad'; }
  else if (S.live) { txt = 'Tracking…'; kind = 'busy'; }
  else txt = S.status || `Recording \u00b7 ${S.session.balls.length} ball${S.session.balls.length === 1 ? '' : 's'}`;
  if (S.realignedAt && performance.now() - S.realignedAt < 2500 && S.cam) txt = 'Stand moved \u2014 re-aligned to the stumps';
  if (S.tapStep) { txt = S.tapStep === 'near' ? 'Tap your stump' : 'Tap the batter\u2019s stumps'; kind = 'busy'; }
  if (S.fps) txt += ` · ${Math.round(S.fps)} fps`;
  $('pillTxt').textContent = txt;
  $('pillDot').className = 'dot ' + kind;
}

// ---------------------------------------------------------------- magnifier
// While a handle is dragged, a magnified view of the clean frame under it is
// shown clear of the finger, so it can be placed to the pixel.
const loupe = document.createElement('canvas'), lctx = loupe.getContext('2d');
loupe.width = loupe.height = 220;
function grabLoupe(W, H) {
  const shown = view.getBoundingClientRect().width, r = 14 * (shown ? view.width / shown : W / 1280);
  const p = handlePts()[loupePt()];
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, 220, 220);
  lctx.imageSmoothingEnabled = false;
  lctx.drawImage(view, p[0] * W - r, p[1] * H - r, 2 * r, 2 * r, 0, 0, 220, 220);
}
const loupePt = () => (S.drag >= 0 ? S.drag : STEP_PT[S.calStep]);
function drawLoupe(W, H, k) {
  const p = handlePts()[loupePt()], x = p[0] * W, y = p[1] * H;
  let R, cx, cy;
  if (guided()) {
    // a big magnifier in the top corner away from the point
    R = 85 * k; cy = R + 48 * k; cx = x > W / 2 ? R + 12 * k : W - R - 12 * k;
    if (y < 2.4 * R + 12 * k) cy = H - R - 12 * k;
  } else {
    R = 60 * k;
    cx = Math.min(W - R - 8 * k, Math.max(R + 8 * k, x)); cy = y > 2.6 * R ? y - 1.5 * R : y + 1.5 * R;
  }
  const c = vctx;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip();
  c.drawImage(loupe, cx - R, cy - R, 2 * R, 2 * R);
  c.strokeStyle = 'rgba(255,224,102,.95)'; c.lineWidth = 1.5 * k;
  c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - 8 * k, cy); c.moveTo(cx + 8 * k, cy); c.lineTo(cx + R, cy);
  c.moveTo(cx, cy - R); c.lineTo(cx, cy - 8 * k); c.moveTo(cx, cy + 8 * k); c.lineTo(cx, cy + R); c.stroke();
  c.restore();
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.lineWidth = 3 * k; c.strokeStyle = '#ffe066'; c.stroke();
}

// ---------------------------------------------------------------- overlay
function crossAt(c, x, y, r, gap) {
  c.beginPath();
  c.moveTo(x - r, y); c.lineTo(x - gap, y); c.moveTo(x + gap, y); c.lineTo(x + r, y);
  c.moveTo(x, y - r); c.lineTo(x, y - gap); c.moveTo(x, y + gap); c.lineTo(x, y + r);
  c.stroke();
}
function poly(pts3, color, width, W) {
  const c = vctx;
  c.beginPath();
  let pen = false;
  for (const X of pts3) {
    const p = project(S.cam, X);
    if (p[2] <= 0.2) { pen = false; continue; }
    if (pen) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]);
    pen = true;
  }
  c.strokeStyle = color; c.lineWidth = width * W / 1280; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke();
}
function drawOverlay(W, H) {
  const c = vctx, k = W / 1280, L = settings.L, hw = settings.rectW / 2;
  if (S.cam && (S.calibrating || !S.last)) {
    const col = S.calibrating ? 'rgba(255,224,102,.95)' : 'rgba(255,255,255,.35)';
    poly([[hw, 0, 0], [-hw, 0, 0], [-hw, L, 0], [hw, L, 0], [hw, 0, 0]], col, 2, W);
    for (const y of [CREASE, L - CREASE]) poly([[-hw, y, 0], [hw, y, 0]], col, 1.5, W);
    for (const y of [0, L]) for (const x of [-0.1143, 0, 0.1143]) poly([[x, y, 0], [x, y, STUMP_H]], col, 2, W);
  }
  if (S.calibrating && guided()) {
    const shown = view.getBoundingClientRect().width;
    const k = shown ? view.width / shown : W / 1280;
    handlePts().forEach((p, i) => {
      const x = p[0] * W, y = p[1] * H, cur = STEP_PT[S.calStep] === i;
      if (!cur) { c.beginPath(); c.arc(x, y, 4 * k, 0, 7); c.fillStyle = 'rgba(255,224,102,.8)'; c.fill(); return; }
      // a cross with a gap in the middle, so the exact spot stays visible
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 4 * k; crossAt(c, x, y, 26 * k, 5 * k);
      c.strokeStyle = '#ffe066'; c.lineWidth = 2 * k; crossAt(c, x, y, 26 * k, 5 * k);
    });
    drawLoupe(W, H, k);
    return;
  }
  if (S.calibrating) {
    // handles are sized for the finger, in screen pixels, whatever the video size
    const shown = view.getBoundingClientRect().width;
    const k = shown ? view.width / shown : W / 1280;
    const stumps = false;
    const names = quick() ? ['Bottom of batter\u2019s stumps', 'Bottom of your stumps', 'Top of batter\u2019s stumps'] : ['Striker end', 'Striker end', 'Bowler end', 'Bowler end'];
    handlePts().forEach((p, i) => {
      const x = p[0] * W, y = p[1] * H, held = S.drag === i;
      // Stump handles sit off to the side with a pointer, so they never cover the stump itself.
      const ox = stumps ? (i === 1 || i === 2 ? -1 : 1) * 30 * k : 0;
      if (stumps) {
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + ox, y);
        c.lineWidth = 2 * k; c.strokeStyle = '#ffe066'; c.stroke();
      }
      c.beginPath(); c.arc(x + ox, y, 14 * k, 0, 7); c.fillStyle = held ? 'rgba(255,224,102,.1)' : 'rgba(255,224,102,.3)'; c.fill();
      c.lineWidth = 3 * k; c.strokeStyle = '#ffe066'; c.stroke();
      if (!held) { c.beginPath(); c.arc(x, y, 3 * k, 0, 7); c.fillStyle = '#ffe066'; c.fill(); }
      c.font = `600 ${14 * k}px Geist, sans-serif`; c.textAlign = quick() ? 'left' : 'center';
      const tx = quick() ? x + 22 * k : x, ty = quick() ? y + 5 * k : y - 24 * k;
      c.lineWidth = 4 * k; c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(names[i], tx, ty);
      c.fillStyle = '#fff'; c.fillText(names[i], tx, ty);
    });
    if (S.drag >= 0) drawLoupe(W, H, k);
    return;
  }
  if (S.live) {
    c.fillStyle = '#ffe066';
    for (const p of S.live) { c.beginPath(); c.arc(p.u, p.v, 3.5 * k, 0, 7); c.fill(); }
  }
  const last = S.last;
  if (last && last.ball.obs && performance.now() - last.shownAt < 9000) {
    // the path the last ball was tracked along, and where it pitched
    c.beginPath();
    last.ball.obs.forEach(([, u, v], i) => { if (i) c.lineTo(u, v); else c.moveTo(u, v); });
    c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 7 * k; c.stroke();
    c.strokeStyle = '#ffd84d'; c.lineWidth = 3.5 * k; c.stroke();
    const pt = last.ball.marks && last.ball.marks.pitch;
    if (pt && pt.u != null) { c.beginPath(); c.arc(pt.u, pt.v, 8 * k, 0, 7); c.lineWidth = 3 * k; c.strokeStyle = '#ff9f43'; c.stroke(); }
  }
}

// ---------------------------------------------------------------- a ball
const spd = (ms) => (settings.units === 'mph' ? ms * 2.23694 : ms * 3.6);
const unit = () => (settings.units === 'mph' ? 'mph' : 'km/h');

const lengthText = (b) => (b.length == null ? 'Not seen' : lengthName(b.length));
function lengthName(y) {
  if (y < 2) return 'Yorker';
  if (y < 6) return 'Full';
  if (y < 8) return 'Good length';
  if (y < 10) return 'Short of a length';
  return 'Short';
}
function lineName(x) {              // x: + toward off
  if (x > 0.3) return 'Outside off';
  if (x > 0.075) return 'Off stump';
  if (x >= -0.075) return 'Middle';
  if (x >= -0.3) return 'Leg stump';
  return 'Down leg';
}
function shotDirection(az) {
  const a = Math.abs(az), offS = az >= 0;
  if (a < 14) return 'straight back past the bowler';
  if (a < 40) return offS ? 'through mid-off' : 'through mid-on';
  if (a < 75) return offS ? 'through the covers' : 'through midwicket';
  if (a < 105) return offS ? 'square on the off side' : 'square on the leg side';
  if (a < 150) return offS ? 'behind point' : 'behind square leg';
  return offS ? 'fine on the off side' : 'fine down the leg side';
}

const MAX_KMH = 165;     // faster than this, the automatic frames must be wrong
const MIN_KMH = 30;      // slower than this is not a bowled ball
const MIN_RELEASE_PX = 11;   // moving pixels (in a 720-wide frame) a ball covers at least just out of the hand: low enough for a bowler releasing a few metres from the lens (real clips: 25-45 at 960 wide)
function onTrack(candidates) {
  const W = S.source.width, L = settings.L, demo = S.source.kind === 'demo';
  let best = null, why = null, whyLen = 0;
  // the reason the longest rejected path was not a delivery (the longest is most likely the ball)
  const reject = (path, reason) => { if (path.length > whyLen) { whyLen = path.length; why = reason; } };
  for (const path of candidates) {
    // it must start where the bowler lets go of the ball (anything joined on before that is dropped)
    const minSize = demo ? 0 : MIN_RELEASE_PX * (S.procScale || 1) ** 2;
    const i0 = deliveryStart(path, S.cam, L, minSize);
    const obs = i0 > 0 ? path.slice(i0) : path;
    // nobody bowls twice within a couple of seconds: anything that soon is the last ball moving on
    if (obs[0].t < S.lastBallEnd + 2.5 && obs[0].t > S.lastBallEnd - 5) { reject(path, 'too soon after the last ball'); continue; }
    const a = analyseTrack(obs, S.cam, { L, hand: F.hand, rmsMax: 5 * W / 1280 });
    // it must head from the bowler's end toward the batter's stumps
    if (i0 < 0 && !(demo && a.ok)) { reject(path, 'it did not start where a bowler lets go of the ball (check the markers and the camera height)'); continue; }
    // and stay on this pitch: not a ball in the next net, a throw back, or someone walking past
    const dc = demo ? { ok: true } : deliveryCheck(obs, S.cam, L, minSize);
    if (!dc.ok) { reject(path, dc.why); continue; }
    if (!best || obs.length > best.obs.length) best = { obs, a };
  }
  if (!best) {
    S.status = why ? `Saw movement, but not a delivery: ${why}` : 'Saw movement, but not a delivery';
    console.info('[tracker] not a delivery:', why, `(${candidates.length} path(s), longest rejected ${whyLen} points)`);
    updatePill(); return;
  }
  const { obs, a: r } = best;
  const m = measureDelivery(obs, S.cam, L, F.hand);
  S.lastBallEnd = obs[obs.length - 1].t;
  const ball = { at: Date.now(), hand: F.hand, L, fps: Math.round((obs.length - 1) / (obs[obs.length - 1].t - obs[0].t)), obs: obs.map((o) => [+o.t.toFixed(4), Math.round(o.u), Math.round(o.v)]) };
  if (demo && r.ok) {
    // the demo is filmed from a raised camera where the full 3D fit is reliable
    ball.speed = r.release.speed; ball.swingCm = r.swingCm; ball.turnDeg = r.turnDeg;
    ball.length = r.bounce ? r.bounce.y : null; ball.bx = r.bounce ? r.bounce.x : null;
    ball.line = r.atStumps ? r.atStumps.x : null; ball.sz = r.atStumps ? r.atStumps.z : null; ball.hitting = !!(r.atStumps && r.atStumps.hitting);
    ball.marks = { release: r.release.t, arrive: m.tArrive, pitch: r.bounce ? { t: r.bounce.t } : null };
  } else {
    ball.marks = { release: m.tRelease, arrive: m.tArrive, pitch: m.bounce ? { t: m.bounce.t, u: m.bounce.u, v: m.bounce.v } : null };
    applyMarks(ball);
    ball.swingCm = null; ball.turnDeg = null;            // not measurable from behind the bowler with one camera
  }
  ball.check = !(ball.speed > 0) || ball.speed * 3.6 > MAX_KMH;
  const c = S.cam;
  ball.cam = { f: c.f, cx: c.cx, cy: c.cy, R: c.R, t: c.t, W: S.source.width, H: S.source.height };
  if (S.source.kind === 'demo' && S.source.lastTruth) {
    const T = S.source.lastTruth;
    ball.truth = { speed: T.speed, swingCm: T.swingCm, turnDeg: T.turnDeg, length: T.bounce ? T.bounce.y : null };
  }
  const sess = S.session;
  // keep the frames now, before they roll out of memory; the ball is only added once it checks out
  const clip = ring.extract(obs[0].t - 0.6, obs[obs.length - 1].t + 0.9);
  if (demo) { addBall(sess, ball, clip); return; }
  S.status = 'Checking the ball\u2026'; updatePill();
  S.pending = (S.pending || 0) + 1;
  refineWithDetector(ball).finally(() => { S.pending--; }).then(() => {
    const kmh = ball.speed * 3.6;
    // far too slow or fast for a bowled ball, or it never got to the batter: something else moved
    const end = ball.obs[ball.obs.length - 1];
    if (!(kmh >= MIN_KMH && kmh <= MAX_KMH) || !reachesBatter({ u: end[1], v: end[2] }, S.cam)) {
      S.status = 'Ignored something that was not a delivery'; updatePill();
      return;
    }
    addBall(sess, ball, clip);
  });
}

function addBall(sess, ball, clipPromise) {
  if (!sess.balls) return;
  sess.balls.push(ball);
  clipPromise.then(async (clip) => {
    if (!clip) return;
    ball.clip = `${sess.id}/${sess.balls.indexOf(ball)}`;
    try { await putClip(ball.clip, clip); } catch (e) { clipMemory.set(ball.clip, clip); }
    saveSession(sess);
  });
  if (S.session === sess) S.last = { ball, shownAt: performance.now() };
  S.status = S.session ? 'Ready \u2014 waiting for the next ball' : '';
  saveSession(sess); renderResult(); renderScore(); renderSession(); updatePill();
}

/** Speed from release to bat, and length and line from where the ball pitched. */
function applyMarks(b) {
  const mk = b.marks, L = b.L || settings.L;
  b.speed = tofSpeed(mk.release, mk.arrive, L, settings.flightDist);
  b.length = null; b.bx = null; b.line = null; b.sz = null; b.hitting = false;
  if (mk.pitch && mk.pitch.u != null) {
    const cam = b.cam ? makeCam(b.cam.f, b.cam.cx, b.cam.cy, b.cam.R, b.cam.t) : S.cam;
    const g = cam && groundPoint(cam, mk.pitch.u, mk.pitch.v, 0.036);
    if (g && g[1] > -1 && g[1] < L) { b.length = g[1]; b.bx = g[0] * (b.hand === 'L' ? -1 : 1); b.line = b.bx; }
  }
  b.check = !(b.speed > 0) || b.speed * 3.6 > MAX_KMH;
}

function headline(b) {
  const sp = b.speed > 0 ? `${spd(b.speed).toFixed(0)} ${unit()}` : 'Speed not measured';
  return [sp, '', b.check ? 'Check the release and bat frames in the replay: the automatic ones look wrong.'
    : (b.length != null ? `${lengthName(b.length)}, ${lineName(b.line).toLowerCase()}.` : 'Where it pitched wasn\u2019t seen. You can mark it in the replay.')];
}
const isFigure = (v) => /^[\d.\u2014/ \u00d7-]+$/.test(String(v));
const tile = (label, value, u, note) => `<div class="tile"><div class="label">${label}</div><div class="v${isFigure(value) ? '' : ' word'}">${value}${u ? `<small>${u}</small>` : ''}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
function swingText(b) {
  if (b.swingCm === null || b.swingCm === undefined) return ['—', '', ''];
  const a = Math.abs(b.swingCm);
  if (a < 3) return ['Straight', '', 'under 3 cm'];
  return [a.toFixed(0), 'cm', b.swingCm > 0 ? 'away from the batter' : 'in to the batter'];
}
function turnText(b) {
  if (b.turnDeg === null || b.turnDeg === undefined) return ['—', '', b.unseenEnd ? 'not seen pitching' : b.length == null ? 'full toss' : 'hit too soon after pitching'];
  const a = Math.abs(b.turnDeg);
  if (a < 0.5) return ['None', '', 'held its line'];
  return [a.toFixed(1), '°', b.turnDeg > 0 ? 'away, like a leg-break' : 'in, like an off-break'];
}
function renderResult() {
  const last = S.last;
  $('result').hidden = !last; $('miniCard').hidden = true;
  if (!last) return;
  const b = last.ball, [h, cls, sub] = headline(b);
  $('resLabel').textContent = `Ball ${curBalls().length}`;
  $('resHead').textContent = h; $('resHead').className = 'head ' + cls;
  $('resSub').textContent = sub;
  const sw = swingText(b);
  $('resTiles').innerHTML = tile('Speed', b.speed > 0 ? spd(b.speed).toFixed(0) : '\u2014', b.speed > 0 ? unit() : '', b.check ? 'check in the replay' : 'out of the hand')
    + tile('Length', lengthText(b), '', b.length == null ? '' : `pitched ${b.length.toFixed(1)} m from the stumps`)
    + tile('Line', b.line == null ? '\u2014' : lineName(b.line), '', b.line == null ? '' : `${Math.abs(b.line * 100).toFixed(0)} cm ${b.line >= 0 ? 'off' : 'leg'} side of middle`)
    + tile('Swing', sw[0], sw[1], b.swingCm == null ? 'needs a side-on or raised camera' : sw[2]);
  const tr = $('resTruth');
  tr.hidden = !b.truth;
  if (b.truth) {
    const T = b.truth;
    tr.textContent = `Demo ground truth: ${spd(T.speed).toFixed(0)} ${unit()}` + (T.length != null ? `, pitched ${T.length.toFixed(1)} m` : '') + (T.swingCm != null ? `, swing ${Math.abs(T.swingCm).toFixed(0)} cm` : '') + '.';
  }
}

function renderScore() {
  const B = curBalls();
  const runs = B.reduce((a, b) => a + (b.runs || 0), 0);
  const wk = B.filter((b) => b.outcome === 'CAUGHT' || b.outcome === 'BOWLED').length;
  $('score').innerHTML = S.session ? `${B.length} ball${B.length === 1 ? '' : 's'}` : '';
}
const when = (ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function renderSession() {
  const V = S.viewSession, B = V ? V.balls : [];
  // list of every session
  $('pastCard').hidden = S.sessions.length < 2;
  $('sessList').innerHTML = S.sessions.map((x) => {
    const fast = x.balls.length ? Math.max(...x.balls.map((b) => b.speed)) : 0;
    return `<button data-id="${x.id}" class="${x === V ? 'on' : ''}"><span class="grow">${when(x.startedAt)}${x.endedAt ? '' : ' \u00b7 recording'}<br><small>${x.balls.length} ball${x.balls.length === 1 ? '' : 's'}${fast ? ` \u00b7 fastest ${spd(fast).toFixed(0)} ${unit()}` : ''}</small></span></button>`;
  }).join('');
  $('sessTitle').textContent = V ? `Session \u00b7 ${when(V.startedAt)}` : 'No sessions yet';
  $('sessMeta').textContent = V ? (V.endedAt ? `${B.length} ball${B.length === 1 ? '' : 's'}, ${Math.max(1, Math.round((V.endedAt - V.startedAt) / 60000))} min` : `Recording now \u00b7 ${B.length} ball${B.length === 1 ? '' : 's'} so far`)
    : 'Start a session on the Track tab. Every ball is saved here with its video.';
  $('playAll').hidden = !B.some((b) => b.clip);
  renderMaps();
  if (!B.length) {
    $('sessTiles').innerHTML = '<p class="muted" style="margin:0;grid-column:1/-1;padding:20px">No balls yet. Each delivery is added here as it is tracked.</p>';
    $('sessTable').innerHTML = ''; $('clearBtn').disabled = !V; return;
  }
  $('clearBtn').disabled = false;
  const speeds = B.filter((b) => b.speed > 0 && !b.check).map((b) => b.speed), lens = B.filter((b) => b.length != null);
  $('sessTiles').innerHTML = tile('Balls', B.length, '', B.some((b) => b.check) ? `${B.filter((b) => b.check).length} to check` : '')
    + tile('Fastest', speeds.length ? spd(Math.max(...speeds)).toFixed(0) : '\u2014', speeds.length ? unit() : '')
    + tile('Average', speeds.length ? spd(speeds.reduce((a, v) => a + v, 0) / speeds.length).toFixed(0) : '\u2014', speeds.length ? unit() : '')
    + tile('Good length', lens.length ? `${lens.filter((b) => b.length >= 6 && b.length < 8).length}/${lens.length}` : '\u2014', '', 'pitched 6\u20138 m from the stumps');
  let rows = '';
  for (let i = B.length - 1; i >= 0; i--) {
    const b = B[i];
    rows += `<tr class="${b.clip ? 'clickable' : ''}" data-ball="${i}"><td>${i + 1}</td>`
      + `<td class="num">${b.speed > 0 ? spd(b.speed).toFixed(0) : '\u2014'}${b.check ? ' <span class="muted">check</span>' : ''}</td>`
      + `<td>${lengthText(b)}</td><td>${b.line == null ? '\u2014' : lineName(b.line)}</td></tr>`;
  }
  $('sessTable').innerHTML = `<table><thead><tr><th>#</th><th class="num">Speed ${unit()}</th><th>Length</th><th>Line</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------- finding the stumps
// Calibration without dragging: the app finds your stump and the batter's stumps
// in the picture, and keeps finding them as the session runs, so a stand that
// shifts or wobbles is followed.
function grabFrame() {
  return new Promise((resolve) => { S.wantFrame = resolve; refresh(); setTimeout(() => { if (S.wantFrame === resolve) { S.wantFrame = null; resolve(null); } }, 1500); });
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function showCalHint(text) { $('calHelp').textContent = text; S.calHint = text; updatePill(); }
function applyStumps(near, far, W, H) {
  S.quickPts = [[far.x / W, far.base / H], [near.x / W, near.base / H], [far.x / W, far.top / H]];
  if (settings.calMode !== 'quick') settings.calMode = 'quick';
  recalibrate(); save(); syncControls(); refresh();
  if (!(S.freeze && S.calibrating)) grabFrame().then(rememberStumps);
}
/** Start calibrating on a still of the current picture, so it does not shake while you point. */
async function startCalibration() {
  S.freeze = null;
  const img = await grabFrame();
  S.freeze = img;
  S.calibrating = true; S.calHint = null; S.tapStep = null; S.calStep = quick() ? 0 : null;
  detector.reset(); tracker.reset();
  syncControls(); refresh();
}
function finishCalibration() {
  S.calibrating = false; S.calHint = null; S.tapStep = null; S.calStep = null;
  // the markers were placed on the still: remember the stumps there, then follow the live picture
  if (S.freeze) rememberStumps(S.freeze);
  S.freeze = null; S.alignVote = null;
  detector.reset(); tracker.reset(); save(); syncControls(); refresh();
}
function syncSteps() {
  const on = guided();
  $('calSteps').hidden = !on;
  if (!on) return;
  const [title, hint] = STEPS[S.calStep];
  $('stepNum').textContent = `Step ${S.calStep + 1} of 3`;
  $('stepTitle').textContent = title;
  $('stepHint').textContent = hint + ' Slide a finger anywhere on the picture to move the cross.';
  document.querySelectorAll('#stepDots i').forEach((d, i) => d.classList.toggle('on', i <= S.calStep));
  $('stepBack').disabled = S.calStep === 0;
  $('stepNext').textContent = S.calStep === 2 ? 'Done' : 'Next';
}
/** Look at several frames, keep the answer they agree on. */
async function autoCalibrate(user) {
  if (!S.source || S.source.kind === 'demo') return false;
  if (user) showCalHint('Looking for the stumps\u2026');
  const found = [];
  const n = S.source.paused || (S.freeze && S.calibrating) ? 1 : 7;
  let W = 0, H = 0;
  for (let k = 0; k < n; k++) {
    const img = await grabFrame();
    if (img) { W = img.width; H = img.height; const r = findStumps(img); if (r) found.push(r); }
    if (k < n - 1) await new Promise((r) => setTimeout(r, 160));
  }
  const need = n === 1 ? 1 : 4;
  if (found.length >= need) {
    const near = { x: median(found.map((r) => r.near.x)), base: median(found.map((r) => r.near.base)) };
    const far = { x: median(found.map((r) => r.far.x)), base: median(found.map((r) => r.far.base)), top: median(found.map((r) => r.far.top)) };
    const agree = found.filter((r) => Math.abs(r.far.x - far.x) <= 4 && Math.abs(r.far.base - far.base) <= 5 && Math.abs(r.near.x - near.x) <= 4).length;
    if (agree >= Math.max(1, Math.ceil(found.length * 0.6)) && far.base - far.top > 0.008 * H) {
      applyStumps(near, far, W, H);
      if (S.calibrating && quick()) { S.calStep = 0; syncSteps(); }
      showCalHint(S.cam ? 'Stumps found. Check the yellow markers sit on the bottom and top of the batter\u2019s stumps and the bottom of yours; drag one if not.' : 'Stumps found, but they don\u2019t fit together. Tap the stumps instead.');
      return !!S.cam;
    }
  }
  showCalHint('Couldn\u2019t find the stumps clearly. Tap \u201cTap the stumps\u201d and tap each one instead.');
  return false;
}
async function onStumpTap(e) {
  const [fx, fy] = canvasPos(e), W = view.width, H = view.height, p = [fx * W, fy * H];
  e.preventDefault();
  if (S.tapStep === 'near') { S.taps.near = p; S.tapStep = 'far'; showCalHint('Now tap the batter\u2019s stumps.'); return; }
  S.taps.far = p; S.tapStep = null;
  const img = await grabFrame();
  let near = img && findNearStump(img, S.taps.near), far = near && findFarStumps(img, near, S.taps.far);
  // nothing clear near a tap: use the tap itself and let the markers be fine-tuned
  if (!near) near = { x: S.taps.near[0], base: S.taps.near[1] };
  if (!far) far = { x: S.taps.far[0], base: S.taps.far[1] + 0.012 * H, top: S.taps.far[1] - 0.012 * H };
  applyStumps(near, far, W, H);
  S.calStep = 0; syncControls();
  showCalHint('Placed. Check each point, then tap Next.');
}
// While a session runs, follow the picture if the stand moves. At calibration the
// areas around both sets of stumps are remembered; each check finds where those
// patches have moved to and shifts the markers with them.
function lumPatch(img, x0, y0, w, h) {
  const out = new Float32Array(w * h), W = img.width, d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xx = Math.min(W - 1, Math.max(0, x0 + x)), yy = Math.min(img.height - 1, Math.max(0, y0 + y)), i = (yy * W + xx) * 4;
    out[y * w + x] = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  }
  return out;
}
function patchAround(img, cx, top, bottom, padX) {
  const x0 = Math.round(cx - padX), y0 = Math.round(top), w = Math.round(2 * padX), h = Math.max(8, Math.round(bottom - top));
  return { x0, y0, w, h, lum: lumPatch(img, x0, y0, w, h) };
}
/** Best shift of a remembered patch in a new frame, searched within +-R pixels. */
function findShift(img, ref, R) {
  const big = lumPatch(img, ref.x0 - R, ref.y0 - R, ref.w + 2 * R, ref.h + 2 * R), bw = ref.w + 2 * R;
  const cost = (dx, dy) => {
    let s = 0;
    for (let y = 0; y < ref.h; y += 2) { const ro = y * ref.w, bo = (y + dy + R) * bw + dx + R; for (let x = 0; x < ref.w; x += 2) s += Math.abs(ref.lum[ro + x] - big[bo + x]); }
    return s;
  };
  let best = { dx: 0, dy: 0, c: cost(0, 0) };
  const c0 = best.c;
  for (let dy = -R; dy <= R; dy += 3) for (let dx = -R; dx <= R; dx += 3) { const c = cost(dx, dy); if (c < best.c) best = { dx, dy, c }; }
  const b0 = best;
  for (let dy = b0.dy - 2; dy <= b0.dy + 2; dy++) for (let dx = b0.dx - 2; dx <= b0.dx + 2; dx++) {
    if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
    const c = cost(dx, dy); if (c < best.c) best = { dx, dy, c };
  }
  return { ...best, gain: c0 > 0 ? best.c / c0 : 1 };
}
function rememberStumps(img) {
  if (!img || !S.cam || settings.calMode !== 'quick') return;
  const W = img.width, H = img.height, [farP, nearP, topP] = S.quickPts.map(([x, y]) => [x * W, y * H]);
  S.align = {
    pts: S.quickPts.map((p) => p.slice()),
    near: patchAround(img, nearP[0], nearP[1] - 0.18 * H, nearP[1] + 0.02 * H, 0.04 * W),
    far: patchAround(img, farP[0], topP[1] - 0.03 * H, farP[1] + 0.02 * H, 0.05 * W),
    W, H,
  };
}
async function realign() {
  // runs even while things move (the bowler is nearly always moving): a shift is only
  // accepted when both ends of the pitch agree and match clearly
  if (!S.cam || !S.source || S.source.kind === 'demo' || S.calibrating || settings.calMode !== 'quick' || S.drag >= 0) return;
  const img = await grabFrame();
  if (!img) return;
  if (!S.align || S.align.W !== img.width) { rememberStumps(img); return; }
  const A = S.align, R = Math.round(0.05 * img.width);
  const n = findShift(img, A.near, R), f = findShift(img, A.far, R);
  // both ends must move together (someone walking past moves only one), and clearly match
  if (Math.hypot(n.dx - f.dx, n.dy - f.dy) > 6 || n.gain > 0.85 || f.gain > 0.85) return;
  const W = A.W, H = A.H;
  const next = [[A.pts[0][0] + f.dx / W, A.pts[0][1] + f.dy / H], [A.pts[1][0] + n.dx / W, A.pts[1][1] + n.dy / H], [A.pts[2][0] + f.dx / W, A.pts[2][1] + f.dy / H]];
  const moved = Math.max(...next.map((p, i) => Math.hypot((p[0] - S.quickPts[i][0]) * W, (p[1] - S.quickPts[i][1]) * H)));
  // small wobbles are left alone, so the markers stay put; a real knock shows in two checks running
  if (moved < 3) { S.alignVote = null; return; }
  const v = S.alignVote, same = v && Math.hypot(v.dx - n.dx, v.dy - n.dy) <= 2;
  S.alignVote = { dx: n.dx, dy: n.dy };
  if (!same) return;
  S.quickPts = next;
  recalibrate(); S.realignedAt = performance.now(); updatePill();
}
setInterval(() => { realign().catch(() => {}); }, 900);

// ---------------------------------------------------------------- the batter's end, at full resolution
// The detector needs a sharp picture of the ball near the batter; the working frame
// is scaled down, so crops come straight from the video.
function batterRect() {
  const vw = video.videoWidth, vh = video.videoHeight, s = vw / view.width;
  // from above the batter's head down to the middle of the pitch, where short balls pitch
  const top = project(S.cam, [0, 0, 2.2]), mid = project(S.cam, [0, settings.L * 0.55, 0]);
  const span = (mid[1] - top[1]) * s;
  const size = Math.round(Math.max(Math.min(640, Math.max(vw, vh) / 6), Math.min(1280, span * 1.1), 240));
  const x = Math.max(0, Math.min(vw - size, Math.round(top[0] * s - size / 2)));
  const y = Math.max(0, Math.min(vh - size, Math.round(top[1] * s - size * 0.05)));
  return { x, y, w: size, h: size, s };
}
function captureBatterEnd(t) {
  if (!video.videoWidth) return;
  crops.capture(video, batterRect(), t);
}
/** After a delivery: the "reached bat" moment, from the picture and then (if switched on) the sound. */
async function refineWithDetector(ball) {
  await refineByPicture(ball);
  await refineBySound(ball);
}
/**
 * Experimental: the bat's click in a clip's sound pins the contact to well under a millisecond.
 * Clips only (their sound and picture share one clock), and not slowed slo-mo clips.
 */
async function refineBySound(ball) {
  const src = S.source;
  if (settings.sound !== 'on' || !src || src.kind !== 'file' || !src.file || settings.slowmo > 1 || !ball.cam) return;
  try {
    if (!src.audio) src.audio = decodeClipAudio(src.file);
    const audio = await src.audio;
    if (!audio) { ball.soundNote = 'no sound in this clip'; return; }
    const cam = makeCam(ball.cam.f, ball.cam.cx, ball.cam.cy, ball.cam.R, ball.cam.t);
    const P = [0, CONTACT_AHEAD, 0.6], dist = Math.hypot(cam.C[0] - P[0], cam.C[1] - P[1], cam.C[2] - P[2]);
    const r = soundContact(audio, ball.marks.arrive, dist);
    if (!r) { ball.soundNote = 'no clear bat click'; return; }
    ball.marks.arrive = r.t;
    ball.arriveBy = 'sound';
    applyMarks(ball);
  } catch (e) { ball.soundNote = 'sound could not be read'; }
}
// ---------------------------------------------------------------- training frames
// For training a cricket-ball detector (MODEL.md): the sharp crops of the batter's end the
// detector looks at, with the ball marked where the tracker placed it. The marks are a head
// start for labelling, not the truth: every frame needs checking by eye.
const MAX_TRAINING = 600, BALL_DIAMETER = 0.072;
S.training = [];
function collectTraining(ball, frames, start, pts, cam, s) {
  const known = [start, ...pts];
  const tEnd = (pts.contact != null ? pts.contact : known[known.length - 1].t) + 0.1;
  const P = [0, CONTACT_AHEAD, 0.6], dist = Math.hypot(cam.C[0] - P[0], cam.C[1] - P[1], cam.C[2] - P[2]);
  const ballView = cam.f * BALL_DIAMETER / dist;           // the ball's size near the batter, in working-frame pixels
  const mine = [];
  for (const f of frames) {
    if (f.t > tEnd || S.training.length >= MAX_TRAINING) break;
    const r = f.rect, sc = 640 / r.w, p = known.find((q) => Math.abs(q.t - f.t) < 0.002);
    let label = '', x = null, y = null;
    if (p) {
      const px = (p.u * s - r.x) * sc, py = (p.v * s - r.y) * sc;
      if (px >= 0 && px < 640 && py >= 0 && py < 640) { x = px; y = py; label = yoloLabel(x, y, Math.max(6, ballView * s * sc), 640); }
    }
    const sample = { b: f.b, label, x, y, ball: String(ball.at), name: `${ball.at}-${String(Math.round(f.t * 1000)).padStart(7, '0')}`,
      score: p && p.score != null ? p.score : null, by: p ? (p === start ? 'motion' : 'detector') : 'none' };
    S.training.push(sample); mine.push(sample);
  }
  updateTrainingButton();
  if (settings.autoSend === 'on') autoSend(mine);
}
// Sending frames to the training pipeline (Firebase, then a weekly move to Roboflow).
S.sent = 0; S.sendNote = '';
async function autoSend(samples) {
  const pick = pickForUpload(samples);
  if (!pick.length) return;
  try {
    S.sent += await sendFrames(pick);
    S.sendNote = '';
  } catch (e) {
    S.sendNote = e.message === 'not-approved' ? 'This account is not approved in Wicket Keepers, so frames are not sent.'
      : e.message === 'not-signed-in' ? 'Signed out: sign in again to keep sending frames.' : 'Could not send frames (offline?).';
  }
  updateSendInfo();
}
async function updateSendInfo() {
  const el = $('sendInfo'), btn = $('sendSignIn');
  if (!el || !btn) return;
  if (settings.autoSend !== 'on') { el.textContent = 'off'; btn.textContent = 'Sign in'; btn.hidden = true; return; }
  btn.hidden = false;
  let who = null;
  try { who = await signedInEmail(); } catch (e) { el.textContent = 'Could not reach the training pipeline (offline?).'; return; }
  btn.textContent = who ? 'Sign out' : 'Sign in';
  el.textContent = who ? `as ${who} \u00b7 ${S.sent} sent this visit${S.sendNote ? ' \u00b7 ' + S.sendNote : ''}` : 'sign in with your Wicket Keepers Google account';
}
function updateTrainingButton() {
  const b = $('exportTrain');
  if (!b) return;
  b.disabled = !S.training.length;
  b.textContent = `Export (${S.training.length})`;
}
async function exportTraining() {
  if (!S.training.length) return;
  const samples = [];
  for (const t of S.training) samples.push({ ...t, bytes: new Uint8Array(await t.b.arrayBuffer()) });
  const blob = new Blob([makeZip(trainingFiles(samples))], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `ball-frames-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/** Follow the ball into the batter with the detector, for the "reached bat" moment. */
async function refineByPicture(ball) {
  const last = ball.obs[ball.obs.length - 1], start = { t: last[0], u: last[1], v: last[2] };
  const frames = await crops.between(start.t - 0.02, start.t + 0.7);
  if (!frames.length) { ball.arriveBy = 'motion'; return; }
  const s = video.videoWidth / ball.cam.W;
  const toView = (r, x, y) => ({ u: (r.x + x * r.w / 640) / s, v: (r.y + y * r.h / 640) / s });
  S.status = 'Finding where the ball met the bat\u2026'; updatePill();
  try {
    // only a ball near the batter's end of this pitch counts
    const cam = makeCam(ball.cam.f, ball.cam.cx, ball.cam.cy, ball.cam.R, ball.cam.t);
    const near = pitchRegion(cam, -1.5, Math.min(ball.L * 0.6, 12), { halfWidth: 1.8, top: 2.6 });
    const pts = await followToBatter(frames, start, toView, null, near);
    if (settings.collect === 'on') collectTraining(ball, frames, start, pts, cam, s);
    if (pts.length) {
      ball.obs.push(...pts.map((p) => [+p.t.toFixed(4), Math.round(p.u), Math.round(p.v)]));
      ball.marks.arrive = pts.contact != null ? pts.contact : pts[pts.length - 1].t;   // between frames when it could be worked out
      ball.arriveBy = 'detector';
      applyMarks(ball);
    } else ball.arriveBy = 'motion';
  } catch (e) {
    ball.arriveBy = 'motion';     // the detector could not load (offline, or an old browser)
  }
}

// ---------------------------------------------------------------- sessions
const clipMemory = new Map();          // clips kept in memory if the browser will not store them
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function saveSession(sess) { putSession(sess).catch(() => {}); }
function trailOf(segments) {
  return segments.map((sg) => {
    const pts = [], n = 40;
    for (let i = 0; i <= n; i++) {
      const t = sg.t0 + (sg.t1 - sg.t0) * i / n;
      const p = sg.kind === 'shot' ? shotTrack(sg.impact, sg.v, [t - sg.t0])[0] : segPos(sg.seg, t);
      pts.push([+p[0].toFixed(3), +p[1].toFixed(3), +Math.max(0, p[2]).toFixed(3), +t.toFixed(4)]);
    }
    return { kind: sg.kind, pts };
  });
}
function startSession() {
  if (S.session || !S.cam) return;
  S.session = { id: newId(), startedAt: Date.now(), endedAt: null, hand: F.hand, L: settings.L, balls: [] };
  S.sessions.unshift(S.session);
  S.viewSession = S.session; S.last = null; S.status = '';
  detector.reset(); tracker.reset(); ring.reset(); crops.reset(); S.lastT = -1;
  if (S.source && S.source.kind !== 'demo') loadDetector().catch(() => {});
  if (S.source && S.source.kind === 'file') S.source.playFromStart().catch(() => {});
  saveSession(S.session);
  renderResult(); renderScore(); renderSession(); syncControls();
}
async function endSession(showSummary) {
  const sess = S.session;
  if (!sess) return;
  S.session = null;
  await new Promise((r) => setTimeout(r, 300));       // let the last clip finish saving
  // a ball still being checked belongs to this session
  if (S.pending) { S.status = 'Checking the last ball\u2026'; updatePill(); }
  for (let k = 0; k < 600 && S.pending; k++) await new Promise((r) => setTimeout(r, 100));
  if (!S.session) S.status = '';
  sess.endedAt = Date.now();
  if (!sess.balls.length) {
    S.sessions = S.sessions.filter((x) => x !== sess);
    deleteSession(sess).catch(() => {});
    if (S.viewSession === sess) S.viewSession = S.sessions[0] || null;
  } else saveSession(sess);
  renderScore(); renderSession(); syncControls();
  if (showSummary && sess.balls.length) showTab('session');
}
function onClipEnd() {
  // the last ball is still waiting for its quiet spell: give the tracker the rest of it
  if (S.session && S.cam) for (let k = 1; k <= 90; k++) { const r = tracker.update([], S.lastT + k / 60); if (r.finished) onTrack(r.finished); }
  S.status = 'Clip finished';
  const had = S.session && S.session.balls.length;
  endSession(true).then(() => {
    if (!had) {
      const src = S.source, maybeSlowmo = src && src.clipFps && src.clipFps < 35 && settings.slowmo <= 1;
      $('calInfo').textContent = 'Clip finished. No delivery was picked up; check the calibration markers and try again.'
        + (maybeSlowmo ? ' If this is an iPhone slo-mo clip, set its slow-motion factor in Setup (240 fps shown at 30 = 8): unslowed, the ball looks too slow to be bowled.' : '');
    }
  });
  updatePill();
}
async function loadSessions() {
  try { S.sessions = (await allSessions()).sort((a, b) => b.startedAt - a.startedAt); } catch (e) { S.sessions = []; }
  // balls from the earlier version of the app become one session
  if (saved.balls && saved.balls.length && !S.sessions.some((x) => x.id === 'earlier')) {
    const old = { id: 'earlier', startedAt: saved.balls[0].at || Date.now(), endedAt: saved.balls[saved.balls.length - 1].at || Date.now(), hand: F.hand, L: settings.L, balls: saved.balls };
    S.sessions.push(old); saveSession(old);
    delete saved.balls; save();
  }
  for (const x of S.sessions) if (!x.endedAt) { x.endedAt = (x.balls[x.balls.length - 1] || {}).at || x.startedAt; saveSession(x); }
  S.viewSession = S.sessions[0] || null;
  renderSession(); syncField();
}
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + name));
  syncField(); renderMaps();
}

// ---------------------------------------------------------------- replay
const PL = { sess: null, i: 0, all: false, ball: null, cam: null };
const player = new Player($('plCanvas'), (ctx, clip, t, atEnd) => {
  const b = PL.ball;
  if (!b || !b.cam) return;
  const k = clip.w / b.cam.W, r = Math.max(2, 2.5 * clip.w / 720);
  // the path the ball was tracked along, up to now
  ctx.beginPath();
  let n = 0;
  for (const [ot, u, v] of b.obs || []) { if (!atEnd && ot > t + 1e-4) break; if (n++) ctx.lineTo(u * k, v * k); else ctx.moveTo(u * k, v * k); }
  ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = r + 2; ctx.stroke();
  ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = r; ctx.stroke();
  const mk = b.marks || {};
  if (mk.pitch && mk.pitch.u != null && (atEnd || t >= mk.pitch.t - 1e-3)) {
    ctx.beginPath(); ctx.arc(mk.pitch.u * k, mk.pitch.v * k, r * 2.4, 0, 7);
    ctx.lineWidth = r; ctx.strokeStyle = '#ff9f43'; ctx.stroke();
  }
  // which moment this frame is
  const tags = [];
  if (Math.abs(t - mk.release) < 0.009) tags.push('Release');
  if (mk.pitch && Math.abs(t - mk.pitch.t) < 0.009) tags.push('Pitched');
  if (Math.abs(t - mk.arrive) < 0.009) tags.push('Reached bat');
  if (tags.length) {
    ctx.font = `600 ${Math.round(14 * clip.w / 540)}px Geist, sans-serif`; ctx.textAlign = 'left';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(tags.join(' \u00b7 '), 12, 28 * clip.w / 540);
    ctx.fillStyle = '#ffd84d'; ctx.fillText(tags.join(' \u00b7 '), 12, 28 * clip.w / 540);
  }
});
function ballSummary(b) {
  const bits = [b.speed > 0 ? `${spd(b.speed).toFixed(0)} ${unit()}` : 'speed \u2014', lengthText(b)];
  if (b.line != null) bits.push(lineName(b.line));
  if (b.check) bits.push('check the frames');
  return bits.join(' \u00b7 ');
}
async function showBall(i) {
  const sess = PL.sess, b = sess.balls[i];
  PL.i = i; PL.ball = b;
  PL.cam = b.cam ? makeCam(b.cam.f, b.cam.cx, b.cam.cy, b.cam.R, b.cam.t) : null;
  $('plTitle').textContent = `Ball ${i + 1} of ${sess.balls.length}`;
  PL.awaitPitch = false;
  $('plSub').textContent = ballSummary(b);
  $('plPrev').disabled = i === 0; $('plNext').disabled = i === sess.balls.length - 1;
  let clip = null;
  if (b.clip) { try { clip = clipMemory.get(b.clip) || await getClip(b.clip); } catch (e) { clip = clipMemory.get(b.clip) || null; } }
  $('plMsg').hidden = !!clip;
  $('plCanvas').hidden = !clip;
  if (!clip) { $('plMsg').textContent = 'No video was saved for this ball.'; if (PL.all) setTimeout(nextBall, 1500); return; }
  await player.load(clip);
  player.rate = +$('plRate').value;
  play();
}
function play() { $('plPlay').textContent = 'Pause'; player.play(() => { $('plPlay').textContent = 'Replay'; if (PL.all) setTimeout(nextBall, 1500); }); }
function nextBall() {
  if ($('player').hidden) return;
  if (PL.i < PL.sess.balls.length - 1) showBall(PL.i + 1); else PL.all = false;
}
function openPlayer(sess, i, all) {
  PL.sess = sess; PL.all = all;
  $('player').hidden = false;
  showBall(i);
}
$('plClose').addEventListener('click', () => { player.pause(); player.clearCache(); $('player').hidden = true; PL.all = false; });
$('plPlay').addEventListener('click', () => { if (player.playing) { player.pause(); $('plPlay').textContent = 'Play'; } else play(); });
$('plNext').addEventListener('click', () => { PL.all = false; if (PL.i < PL.sess.balls.length - 1) showBall(PL.i + 1); });
$('plPrev').addEventListener('click', () => { PL.all = false; if (PL.i > 0) showBall(PL.i - 1); });
$('plRate').addEventListener('change', () => { player.rate = +$('plRate').value; });
async function stepFrame(d) {
  if (!player.clip) return;
  player.pause(); $('plPlay').textContent = 'Play';
  player.idx = Math.max(0, Math.min(player.clip.times.length - 1, player.idx + d));
  player.pos = player.clip.times[player.idx];
  await player.draw();
}
function marksChanged() {
  const b = PL.ball;
  applyMarks(b);
  $('plSub').textContent = ballSummary(b);
  saveSession(PL.sess); renderSession(); if (S.last && S.last.ball === b) renderResult();
  player.draw();
}
// One ball of known speed sets the real release-to-bat distance for this net.
$('knownSet').addEventListener('click', () => {
  const b = PL.ball, v = +$('knownKmh').value;
  if (!b || !b.marks || !(v >= 30 && v <= 170)) { $('plHint').textContent = 'Enter the ball\u2019s speed in km/h first.'; return; }
  settings.flightDist = distanceFromKnown(b.marks.release, b.marks.arrive, (settings.units === 'mph' ? v * 1.609 : v) / 3.6);
  save();
  for (const x of S.sessions) { let changed = false; for (const y of x.balls) if (y.marks && !y.truth) { applyMarks(y); changed = true; } if (changed) saveSession(x); }
  $('plHint').textContent = `Speeds now use ${settings.flightDist.toFixed(1)} m from release to bat (from this ball). Every ball has been updated.`;
  $('plSub').textContent = ballSummary(b);
  renderSession(); renderResult(); syncSpeedScale();
});
function syncSpeedScale() {
  const d = flightDistance(settings.L, settings.flightDist);
  $('scaleInfo').textContent = settings.flightDist ? `Set from a ball of known speed: ${d.toFixed(1)} m from release to bat.` : `From the pitch length: ${d.toFixed(1)} m from release to bat. Set a ball of known speed in the replay for accurate speeds.`;
  $('scaleReset').hidden = !settings.flightDist;
}
$('scaleReset').addEventListener('click', () => {
  settings.flightDist = null; save();
  for (const x of S.sessions) { for (const y of x.balls) if (y.marks && !y.truth) applyMarks(y); saveSession(x); }
  renderSession(); renderResult(); syncSpeedScale();
});
$('plBack').addEventListener('click', () => stepFrame(-1));
$('plFwd').addEventListener('click', () => stepFrame(1));
$('mkRelease').addEventListener('click', () => { if (!player.clip) return; PL.ball.marks.release = player.pos; marksChanged(); });
$('mkBat').addEventListener('click', () => { if (!player.clip) return; PL.ball.marks.arrive = player.pos; marksChanged(); });
$('mkPitch').addEventListener('click', () => {
  if (!player.clip) return;
  player.pause(); $('plPlay').textContent = 'Play';
  PL.awaitPitch = true;
  $('plHint').textContent = 'Tap the ball where it touches the pitch.';
});
$('plCanvas').addEventListener('click', (e) => {
  if (!PL.awaitPitch || !player.clip) return;
  const r = $('plCanvas').getBoundingClientRect(), b = PL.ball, k = player.clip.w / b.cam.W;
  const u = (e.clientX - r.left) / r.width * player.clip.w / k, v = (e.clientY - r.top) / r.height * player.clip.h / k;
  b.marks.pitch = { t: player.pos, u, v };
  PL.awaitPitch = false; $('plHint').textContent = '';
  marksChanged();
});

// ---------------------------------------------------------------- session maps
const describeBall = (b, i) => `Ball ${i + 1} \u00b7 ${spd(b.speed).toFixed(0)} ${unit()} \u00b7 ${lengthText(b).toLowerCase()}${b.line == null ? '' : ', ' + lineName(b.line).toLowerCase()}`;
const pitchMap = new MapView($('pitchMap'), 'pitch', $('mapTip'), describeBall);
const stumpMap = new MapView($('stumpMap'), 'stumps', $('mapTip'), describeBall);
function renderMaps() {
  const B = S.viewSession ? S.viewSession.balls : [], mapped = B.filter((b) => b.sz != null);
  $('mapsCard').hidden = !mapped.length;
  if (!mapped.length) return;
  const opts = { hand: F.hand, L: settings.L };
  pitchMap.draw(B, opts); stumpMap.draw(B, opts);
  const full = mapped.filter((b) => b.length == null && !b.unseenEnd).length;
  $('pitchNote').textContent = full ? `${full} full toss${full > 1 ? 'es' : ''} not shown (never pitched).` : 'Tap a dot for that ball.';
}

// ---------------------------------------------------------------- field views
const mini = new FieldView($('miniField'), F);
const big = new FieldView($('bigField'), F, (f, done) => { if (done) { F.preset = 'custom'; syncField(); save(); } });
big.editable = true;
function syncField() {
  const sel = $('preset');
  sel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')
    + (F.preset === 'custom' ? '<option value="custom">Custom field</option>' : '');
  sel.value = F.preset;
  document.querySelectorAll('#handSeg button').forEach((b) => b.classList.toggle('on', b.dataset.hand === F.hand));
  $('bnd').value = F.boundary; $('bndTxt').textContent = `${F.boundary} m`;
  big.shots = (S.viewSession || { balls: [] }).balls.filter((x) => x.path);
  big.draw(); mini.draw();
}
$('preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  F.preset = e.target.value; F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
  syncField(); save();
});
$('handSeg').addEventListener('click', (e) => {
  const h = e.target.dataset.hand;
  if (!h || h === F.hand) return;
  F.hand = h; F.fielders.forEach((f) => { f.x = -f.x; });     // mirror the field for the other hand
  syncField(); save();
});
$('bnd').addEventListener('input', (e) => {
  F.boundary = +e.target.value;
  if (F.preset !== 'custom') F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
  syncField(); save();
});

// ---------------------------------------------------------------- controls
function syncControls() {
  const has = !!S.source, demo = has && S.source.kind === 'demo';
  $('calBtn').disabled = !has || demo || !!S.session;
  $('calBtn').textContent = S.calibrating ? 'Done' : 'Calibrate pitch';
  $('calBtn').classList.toggle('primary', S.calibrating);
  $('sessBtn').disabled = !has || !S.cam || S.calibrating;
  $('sessBtn').textContent = S.session ? 'End session' : 'Start session';
  $('sessBtn').classList.toggle('warn', !!S.session);
  $('calPanel').hidden = !S.calibrating;
  syncSteps();
  $('camHRow').hidden = !quick();
  $('camH').value = settings.camH;
  $('pitchLen').value = [20.12, 21.95].includes(settings.L) ? String(settings.L) : 'custom';
  $('autoRow').hidden = !quick();
  $('calHelp').hidden = guided() && !S.calHint;
  $('calHelp').textContent = S.calHint && S.calibrating ? S.calHint : quick()
    ? 'Drag the markers onto the bottom and the top of the batter\u2019s stumps, and the bottom of your stumps. If the batter hides their stumps, move the phone a little to one side. Then enter the phone\u2019s height from the ground.'
    : 'Drag the four corners onto the corners of the pitch: the stump line at each end, at the edges of the pitch.';
  $('sCal').value = settings.calMode;
  document.querySelectorAll('#calModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.calMode));
  view.style.touchAction = S.calibrating ? 'none' : 'auto';
  updatePill();
}
$('srcSeg').addEventListener('click', (e) => {
  const k = e.target.dataset.src;
  if (!k) return;
  if (k === 'file') $('fileIn').click(); else setSource(k);
});
$('calModeSeg').addEventListener('click', (e) => {
  const m = e.target.dataset.mode;
  if (!m || m === settings.calMode) return;
  settings.calMode = m; detector.reset(); tracker.reset(); recalibrate(); save(); syncControls(); refresh();
});
$('fileIn').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setSource('file', f); e.target.value = ''; });
$('autoCal').addEventListener('click', () => autoCalibrate(true));
$('tapCal').addEventListener('click', async () => { if (!S.calibrating) await startCalibration(); S.tapStep = 'near'; S.taps = {}; syncControls(); showCalHint('Tap your stump (the one in front of the camera).'); refresh(); });
$('calBtn').addEventListener('click', () => { if (S.calibrating) finishCalibration(); else startCalibration(); });
$('stepNext').addEventListener('click', () => { if (S.calStep >= 2) finishCalibration(); else { S.calStep++; syncControls(); refresh(); } });
$('stepBack').addEventListener('click', () => { if (S.calStep > 0) { S.calStep--; syncControls(); refresh(); } });
document.querySelectorAll('#calSteps .nudge').forEach((b) => b.addEventListener('click', () => {
  if (!guided()) return;
  const [dx, dy] = b.dataset.n.split(',').map(Number), i = STEP_PT[S.calStep], p = handlePts()[i];
  handlePts()[i] = [p[0] + dx / view.width, p[1] + dy / view.height];
  recalibrate(); save(); refresh();
}));
$('sessBtn').addEventListener('click', () => { if (S.session) endSession(true); else startSession(); });
$('pitchLen').addEventListener('change', () => {
  const v = $('pitchLen').value;
  if (v === 'custom') { showTab('setup'); return; }
  settings.L = +v; $('sL').value = settings.L; F.L = settings.L; save(); recalibrate(); refresh(); updatePill();
});
$('camH').addEventListener('input', () => {
  const v = +$('camH').value;
  if (v >= 50 && v <= 600) { settings.camH = v; recalibrate(); save(); updatePill(); refresh(); }
});
$('clearBtn').addEventListener('click', async () => {
  const V = S.viewSession;
  if (!V || !confirm('Delete this session and its videos?')) return;
  if (V === S.session) await endSession(false);
  try { await deleteSession(V); } catch (e) { /* not stored */ }
  S.sessions = S.sessions.filter((x) => x !== V);
  S.viewSession = S.sessions[0] || null;
  renderSession(); syncField();
});
$('sessList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  S.viewSession = S.sessions.find((x) => x.id === b.dataset.id) || null;
  renderSession(); syncField();
});
$('sessTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-ball]');
  if (tr && S.viewSession) openPlayer(S.viewSession, +tr.dataset.ball, false);
});
$('playAll').addEventListener('click', () => { if (S.viewSession) openPlayer(S.viewSession, 0, true); });
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.tab));
  syncField();
  renderMaps();
});

const bind = (id, key, parse, after) => {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => {
    const v = parse(el.value);
    if (!(v > 0) && typeof v !== 'string') { el.value = settings[key]; return; }
    settings[key] = v; save(); after && after();
  });
};
const geometryChanged = () => {
  F.L = settings.L;
  if (S.source && S.source.kind === 'demo') { setSource('demo'); return; }
  recalibrate(); syncField();
};
bind('sL', 'L', (v) => Math.min(25, Math.max(8, +v)), geometryChanged);
bind('sW', 'rectW', (v) => Math.min(6, Math.max(0.5, +v)), geometryChanged);
bind('sCal', 'calMode', String, () => { detector.reset(); tracker.reset(); recalibrate(); syncControls(); });
bind('camH', 'camH', (v) => Math.min(600, Math.max(50, +v)), () => { recalibrate(); updatePill(); });
bind('sUnits', 'units', String, () => { renderResult(); renderSession(); });
bind('sSens', 'sens', (v) => Math.min(150, Math.max(15, +v)));
bind('sProc', 'procW', (v) => +v);
bind('sSlow', 'slowmo', (v) => Math.min(32, Math.max(1, +v)));
bind('sSound', 'sound', String);
bind('sCollect', 'collect', String, updateTrainingButton);
bind('sAutoSend', 'autoSend', String, () => {
  if (settings.autoSend === 'on' && settings.collect !== 'on') { settings.collect = 'on'; $('sCollect').value = 'on'; save(); }
  updateSendInfo();
});
$('sendSignIn').addEventListener('click', async () => {
  try {
    if ((await signedInEmail())) await signOut(); else await signIn();
  } catch (e) { S.sendNote = 'Sign-in did not finish.'; }
  updateSendInfo();
});
updateSendInfo();
$('exportTrain').addEventListener('click', () => { exportTraining().catch(() => {}); });
updateTrainingButton();

window.addEventListener('resize', () => { big.draw(); mini.draw(); renderMaps(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.source && navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
});

syncField(); syncControls(); renderScore(); loadSessions(); syncSpeedScale();
window.__tracker = { S, F, settings };
window.__pl = player;      // handy for debugging from the console
