// Bat contact by sound (experimental, video clips only).
//
// Bat on ball is a short, sharp click. Sound is sampled 48,000 times a second, so the click
// pins the contact far more finely than a 60 fps frame (17 ms). The picture says roughly when
// the ball reached the batter; the click nearest that moment is taken as the contact, less the
// time the sound took to travel back to the phone (about 59 ms over 20 m).
//
// Only for clips: their sound and picture share the clip's clock. A live camera and microphone
// in a phone browser are not reliably in step. Slowed slo-mo clips are skipped: their sound
// is slowed and pitched down or dropped.

export const SPEED_OF_SOUND = 343;   // m/s in air at about 20 C

/** Decodes a clip's sound to one channel: { data: Float32Array, rate } or null if it has none or cannot be read. */
export async function decodeClipAudio(file) {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const buf = await new Promise((resolve, reject) => {
      const p = file.arrayBuffer().then((ab) => ctx.decodeAudioData(ab, resolve, reject));
      if (p && p.catch) p.catch(reject);
    });
    const n = buf.length, data = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < n; i++) data[i] += ch[i] / buf.numberOfChannels; }
    if (ctx.close) ctx.close();
    return { data, rate: buf.sampleRate };
  } catch (e) {
    return null;
  }
}

/**
 * Sharp sound onsets between t0 and t1 (s): [{ t, strength }]. The signal is high-passed
 * (a click is mostly high frequencies, footsteps and voices mostly low), its energy taken in
 * 0.5 ms steps, and an onset is a step much louder than the 40 ms before it. The time is
 * refined to the first sample that reaches half the onset's peak.
 */
export function onsets({ data, rate }, t0, t1, minStrength = 4) {
  const hop = Math.max(8, Math.round(rate * 0.0005)), back = Math.round(0.04 * rate / hop);
  const i0 = Math.max(1, Math.floor(t0 * rate)), i1 = Math.min(data.length - 1, Math.ceil(t1 * rate));
  const startBack = Math.max(1, i0 - (back + 2) * hop);
  const e = [], at = [];
  for (let s = startBack; s + hop <= i1; s += hop) {
    let sum = 0;
    for (let i = s; i < s + hop; i++) { const d = data[i] - data[i - 1]; sum += d * d; }
    e.push(sum / hop); at.push(s);
  }
  const out = [];
  for (let k = back; k < e.length; k++) {
    if (at[k] < i0) continue;
    const prev = e.slice(k - back, k).sort((a, b) => a - b);
    const floor = prev[prev.length >> 1] + 1e-12;
    const s = e[k] / floor;
    if (s < minStrength || e[k] < e[k - 1] * 2) continue;          // a rise, not the tail of one
    if (out.length && at[k] - out[out.length - 1].i < 0.01 * rate) continue;   // one click, not its echo
    // first sample reaching half of this onset's peak, in this step or the next
    let peak = 0;
    for (let i = at[k]; i < Math.min(i1, at[k] + 2 * hop); i++) peak = Math.max(peak, Math.abs(data[i] - data[i - 1]));
    let j = at[k];
    while (j < at[k] + 2 * hop && Math.abs(data[j] - data[j - 1]) < 0.5 * peak) j++;
    out.push({ t: j / rate, strength: s, i: at[k] });
  }
  return out.map(({ t, strength }) => ({ t, strength }));
}

/**
 * The contact time (in the clip's clock) from the click nearest the picture's estimate:
 * `tPicture` is when the picture says the ball reached the bat, `distance` how far the
 * contact was from the phone (m). Looks within `window` s either side. Returns
 * { t, strength } or null if no clear click was there.
 */
export function soundContact(audio, tPicture, distance, window = 0.05) {
  if (!audio) return null;
  const delay = distance / SPEED_OF_SOUND;
  const found = onsets(audio, tPicture + delay - window, tPicture + delay + window);
  if (!found.length) return null;
  // the strongest click; between two of similar strength, the one nearer the picture's estimate
  found.sort((a, b) => b.strength - a.strength);
  let best = found[0];
  for (const o of found.slice(1)) {
    if (o.strength > 0.7 * best.strength && Math.abs(o.t - delay - tPicture) < Math.abs(best.t - delay - tPicture)) best = o;
  }
  return { t: best.t - delay, strength: best.strength };
}
