// Bat contact by sound: synthetic net audio (noise, hum, a footstep, a bat click) with the
// click at a known moment; the contact found from it is checked against the truth.
import { onsets, soundContact, SPEED_OF_SOUND } from '../js/sound.js';

export function soundChecks(check, rnd) {
  const rate = 48000, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const errs = [];
  let missed = 0, wrong = 0;
  for (let n = 0; n < 40; n++) {
    const data = new Float32Array(rate * 2);
    for (let i = 0; i < data.length; i++) data[i] = 0.01 * gauss() + 0.05 * Math.sin(2 * Math.PI * 50 * i / rate);
    // a footstep: a soft, low thud 150 ms before the contact
    const tContact = 0.6 + rnd() * 0.5, dist = 18 + rnd() * 2, delay = dist / SPEED_OF_SOUND;
    const thud = Math.round((tContact + delay - 0.15) * rate);
    for (let i = 0; i < 0.03 * rate; i++) data[thud + i] += 0.1 * Math.exp(-i / (0.008 * rate)) * Math.sin(2 * Math.PI * 120 * i / rate);
    // the bat: a sharp click, mostly 2-5 kHz, dying away in a few ms, heard `delay` after the contact
    const click = (tContact + delay) * rate, c0 = Math.ceil(click);
    const amp = 0.08 + rnd() * 0.3;
    for (let i = 0; i < 0.008 * rate; i++) {
      const s = (c0 + i - click) / rate;
      data[c0 + i] += amp * Math.exp(-s / 0.0015) * (Math.sin(2 * Math.PI * 2800 * s) + 0.6 * Math.sin(2 * Math.PI * 4600 * s));
    }
    // the picture's estimate is a frame or so out
    const tPicture = tContact + (rnd() - 0.5) * 0.03;
    const r = soundContact({ data, rate }, tPicture, dist);
    if (!r) { missed++; continue; }
    const err = Math.abs(r.t - tContact) * 1000;
    if (err > 5) wrong++; else errs.push(err);
  }
  errs.sort((a, b) => a - b);
  const med = errs.length ? errs[errs.length >> 1] : Infinity;
  console.log(`   sound contact: median error ${med.toFixed(2)} ms, missed ${missed}/40, wrong click ${wrong}/40`);
  check('sound finds the bat click', missed <= 2 && wrong === 0);
  check('sound contact within 0.5 ms', med < 0.5);

  // quiet, no click: nothing is claimed
  const quiet = new Float32Array(rate);
  for (let i = 0; i < quiet.length; i++) quiet[i] = 0.01 * gauss();
  check('no click, no sound contact', soundContact({ data: quiet, rate }, 0.4, 19) === null);
  check('onsets on silence are none', onsets({ data: new Float32Array(rate), rate }, 0.1, 0.9).length === 0);
}
