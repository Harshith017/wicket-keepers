import { calibrate, calibrateFromTaps, project, makeCam, groundPoint } from './geometry.js';
import { MapView } from './maps.js';
import { analyseTrack, sampleSegments, simulateShot, runsFor, segPos, shotTrack, CREASE, STUMP_H } from './physics.js';
import { FrameRing, Player } from './clips.js';
import { measureDelivery, deliveryStart, tofSpeed, distanceFromKnown, flightDistance } from './bowling.js';
import { CropRing, followToBatter, loadDetector } from './ml.js';
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
const settings = Object.assign({ L: 20.12, rectW: 3.05, units: 'kmh', sens: 45, procW: 960, slowmo: 1, calMode: 'quick', camH: 150 }, saved.settings);
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
    await video.play();
    video.playbackRate = window.__clipRate || 0.25;
    if (!this.running) this.start(this.onFrame);
  }
  get paused() { return this.kind === 'file' && video.paused; }
  start(onFrame) {
    this.running = true; this.onFrame = onFrame;
    if (this.kind === 'file' && video.paused) setTimeout(() => onFrame(video.currentTime), 0);   // show the first frame
    const useRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    const tick = (now, meta) => {
      if (!this.running) return;
      let t;
      if (this.kind === 'file') t = (meta ? meta.mediaTime : video.currentTime) / Math.max(1, settings.slowmo);
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
    if (kind === 'file') S.status = 'Clip loaded \u2014 check the markers, then Start session';
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
  }
  $('calInfo').textContent = info;
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
  if (!S.calibrating) return;
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
  handlePts()[S.drag] = [Math.min(1, Math.max(0, x + S.dragOff[0])), Math.min(1, Math.max(0, y + S.dragOff[1]))];
  recalibrate();
  refresh();
});
const endDrag = () => { if (S.drag >= 0) { S.drag = -1; save(); refresh(); syncControls(); } };
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
  src.drawTo(vctx, W, H);
  if (S.drag >= 0) grabLoupe(W, H);
  if (S.session) ring.capture(view, t);
  if (S.session && S.cam && src.kind !== 'demo') captureBatterEnd(t);

  if (S.session && S.cam && !S.calibrating) {
    const pw = Math.min(W, settings.procW), ph = Math.round(H * pw / W);
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
  else if (S.calibrating) { txt = quick() ? 'Drag the three markers into place' : 'Drag the corners onto the pitch'; kind = 'busy'; }
  else if (!S.session) { txt = 'Ready \u2014 tap Start session'; kind = ''; }
  else if (S.camLow && !S.live) { txt = `Camera too low \u2014 raise it to ${MIN_CAM_HEIGHT * 100} cm or more`; kind = 'bad'; }
  else if (S.live) { txt = 'Tracking…'; kind = 'busy'; }
  else txt = S.status || `Recording \u00b7 ${S.session.balls.length} ball${S.session.balls.length === 1 ? '' : 's'}`;
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
  const p = handlePts()[S.drag];
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, 220, 220);
  lctx.imageSmoothingEnabled = false;
  lctx.drawImage(view, p[0] * W - r, p[1] * H - r, 2 * r, 2 * r, 0, 0, 220, 220);
}
function drawLoupe(W, H, k) {
  const p = handlePts()[S.drag], x = p[0] * W, y = p[1] * H, R = 60 * k;
  const cx = Math.min(W - R - 8 * k, Math.max(R + 8 * k, x)), cy = y > 2.6 * R ? y - 1.5 * R : y + 1.5 * R;
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
function onTrack(candidates) {
  const W = S.source.width, L = settings.L, demo = S.source.kind === 'demo';
  let best = null;
  for (const path of candidates) {
    // it must start where the bowler lets go of the ball (anything joined on before that is dropped)
    const i0 = deliveryStart(path, S.cam, L);
    const obs = i0 > 0 ? path.slice(i0) : path;
    if (obs[0].t < S.lastBallEnd + 1 && obs[0].t > S.lastBallEnd - 5) continue;      // leftovers of the ball just bowled
    const a = analyseTrack(obs, S.cam, { L, hand: F.hand, rmsMax: 5 * W / 1280 });
    // it must head from the bowler's end toward the batter's stumps
    if (i0 < 0 && !(demo && a.ok)) continue;
    if (!best || obs.length > best.obs.length) best = { obs, a };
  }
  if (!best) { S.status = 'Saw movement, but not a delivery'; updatePill(); return; }
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
  sess.balls.push(ball);
  if (!demo) refineWithDetector(ball, sess);
  ring.extract(obs[0].t - 0.6, obs[obs.length - 1].t + 0.9).then(async (clip) => {
    if (!clip) return;
    ball.clip = `${sess.id}/${sess.balls.indexOf(ball)}`;
    try { await putClip(ball.clip, clip); } catch (e) { clipMemory.set(ball.clip, clip); }
    saveSession(sess);
  });
  S.last = { ball, shownAt: performance.now() };
  S.status = 'Ready \u2014 waiting for the next ball';
  saveSession(sess); renderResult(); renderScore(); updatePill();
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
/** After a delivery: follow the ball into the batter with the detector, for the "reached bat" moment. */
async function refineWithDetector(ball, sess) {
  const last = ball.obs[ball.obs.length - 1], start = { t: last[0], u: last[1], v: last[2] };
  const frames = await crops.between(start.t - 0.02, start.t + 0.7);
  if (!frames.length) { ball.arriveBy = 'motion'; return; }
  const s = video.videoWidth / ball.cam.W;
  const toView = (r, x, y) => ({ u: (r.x + x * r.w / 640) / s, v: (r.y + y * r.h / 640) / s });
  S.status = 'Finding where the ball met the bat\u2026'; updatePill();
  try {
    const pts = await followToBatter(frames, start, toView);
    if (pts.length) {
      ball.obs.push(...pts.map((p) => [+p.t.toFixed(4), Math.round(p.u), Math.round(p.v)]));
      ball.marks.arrive = pts[pts.length - 1].t;
      ball.arriveBy = 'detector';
      applyMarks(ball);
    } else ball.arriveBy = 'motion';
  } catch (e) {
    ball.arriveBy = 'motion';     // the detector could not load (offline, or an old browser)
  }
  S.status = 'Ready \u2014 waiting for the next ball';
  saveSession(sess); renderResult(); renderSession(); updatePill();
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
    if (!had) { $('calInfo').textContent = 'Clip finished. No delivery was picked up; check the calibration markers and try again.'; }
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
  $('camHRow').hidden = !quick();
  $('camH').value = settings.camH;
  $('pitchLen').value = [20.12, 21.95].includes(settings.L) ? String(settings.L) : 'custom';
  $('calHelp').textContent = quick()
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
$('calBtn').addEventListener('click', () => { S.calibrating = !S.calibrating; detector.reset(); tracker.reset(); if (!S.calibrating) save(); syncControls(); refresh(); });
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

window.addEventListener('resize', () => { big.draw(); mini.draw(); renderMaps(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.source && navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
});

syncField(); syncControls(); renderScore(); loadSessions(); syncSpeedScale();
window.__tracker = { S, F, settings };
window.__pl = player;      // handy for debugging from the console
