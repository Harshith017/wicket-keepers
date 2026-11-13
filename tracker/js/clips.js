// Short video clips of each ball: the last few seconds of frames are kept as
// small JPEGs, and when a delivery is found the frames around it are saved.

export class FrameRing {
  constructor(maxSide = 540, seconds = 8) {
    this.maxSide = maxSide; this.seconds = seconds;
    this.frames = []; this.pool = []; this.busy = 0;
  }
  reset() { this.frames = []; }
  /** Copy the clean camera frame (before any drawing on top of it). */
  capture(src, t) {
    if (this.busy > 6) return;            // the phone is behind: skip a frame rather than pile up
    const k = Math.min(1, this.maxSide / Math.max(src.width, src.height));
    const w = Math.round(src.width * k), h = Math.round(src.height * k);
    const c = this.pool.pop() || document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    this.busy++;
    c.toBlob((b) => {
      this.busy--; this.pool.push(c);
      if (!b) return;
      const f = this.frames;
      let i = f.length;
      while (i > 0 && f[i - 1].t > t) i--;
      f.splice(i, 0, { t, b, w, h });
      const cut = f[f.length - 1].t - this.seconds;
      while (f.length && f[0].t < cut) f.shift();
    }, 'image/jpeg', 0.72);
  }
  /** Frames between t0 and t1, once any still being encoded have landed. */
  async extract(t0, t1) {
    for (let k = 0; k < 40 && this.busy > 0; k++) await new Promise((r) => setTimeout(r, 25));
    const sel = this.frames.filter((f) => f.t >= t0 && f.t <= t1);
    if (!sel.length) return null;
    return { w: sel[0].w, h: sel[0].h, times: sel.map((f) => f.t), blobs: sel.map((f) => f.b) };
  }
}

/** Plays a saved clip on a canvas, calling `overlay(ctx, clip, time, atEnd)` on every frame. */
export class Player {
  constructor(canvas, overlay) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.overlay = overlay;
    this.cache = new Map(); this.playing = false; this.rate = 0.5; this.token = 0;
  }
  clearCache() { for (const b of this.cache.values()) if (b.close) b.close(); this.cache.clear(); }
  async frame(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const bm = await createImageBitmap(this.clip.blobs[i]);
    this.cache.set(i, bm);
    if (this.cache.size > 8) { const k = this.cache.keys().next().value; const b = this.cache.get(k); if (b.close) b.close(); this.cache.delete(k); }
    return bm;
  }
  async load(clip) {
    this.pause(); this.clearCache();
    this.clip = clip; this.idx = 0; this.pos = clip.times[0];
    this.cv.width = clip.w; this.cv.height = clip.h;
    await this.draw();
  }
  async draw() {
    const bm = await this.frame(this.idx);
    this.ctx.drawImage(bm, 0, 0, this.cv.width, this.cv.height);
    this.overlay(this.ctx, this.clip, this.pos, this.idx === this.clip.times.length - 1);
    if (this.idx + 1 < this.clip.times.length) this.frame(this.idx + 1).catch(() => {});
  }
  play(onEnd) {
    if (!this.clip) return;
    const T = this.clip.times;
    if (this.idx >= T.length - 1) { this.idx = 0; this.pos = T[0]; }
    this.playing = true;
    const token = ++this.token;
    let last = performance.now();
    const step = async (now) => {
      if (!this.playing || token !== this.token) return;
      this.pos += Math.min(0.1, (now - last) / 1000) * this.rate; last = now;
      if (this.pos >= T[T.length - 1]) {
        this.pos = T[T.length - 1]; this.idx = T.length - 1;
        await this.draw();
        this.playing = false;
        if (onEnd) onEnd();
        return;
      }
      let i = this.idx;
      while (i + 1 < T.length && T[i + 1] <= this.pos) i++;
      this.idx = i;
      await this.draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  pause() { this.playing = false; this.token++; }
}
