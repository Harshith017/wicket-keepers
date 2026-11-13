# Ball Tracker

A single-camera cricket ball tracker that runs entirely in the browser. Point a
phone at the pitch and each delivery is picked up automatically:

- **Ball speed**, **swing** (cm, in/away) and **turn off the pitch** (degrees)
- **Length and line**, and whether the ball was hitting the stumps
- **Shot speed and launch angle**, with an **estimated bat speed**
- The shot is carried out over **the field you set** to call it a six, a four,
  a catch or a fielded ball (with runs)

Open `tracker/` from the site (camera access needs HTTPS or `localhost`). Try
**Demo** first: it renders a synthetic net session through a virtual camera and
runs the real pipeline on it, showing the ground truth beside each result.

## Using it

1. Tripod the phone behind the bowler's stumps, level, at least 150 cm high,
   with the whole pitch in frame. It must not move. Use 60 fps.
2. **Calibrate pitch** (quick setup): drag three markers onto the bottom and
   the top of the batter's stumps and the bottom of your stumps, then enter
   the phone's height from the ground. The batter's stumps (a standard 71 cm)
   give the lens zoom. If the batter hides them, move the phone a little to one
   side. A magnifier shows while you drag. The app assumes the two sets of
   stumps are a full 20.12 m apart; set the real distance in Setup if your net
   is shorter.
   On a fully marked pitch, the four-corner method is still available.
3. Set the field on the **Field** tab, tap **Start session** and bowl. Each
   ball is saved with a short video. **End session** opens the summary, where
   **Play every ball** replays them one after another with the path drawn on.

The camera is opened at 60 fps when the phone and browser allow it (the line
under the video says what rate you actually got).

Recorded clips work too (**Video clip**): the clip waits on its first frame for
calibration, then **Start session** analyses it at quarter speed so no frame is
skipped, and the summary opens when it ends. iPhone clips are HEVC with HDR,
which only Safari can play; elsewhere, record with Settings › Camera › Formats ›
Most Compatible and HDR Video off. For iPhone slo-mo clips set the slow-motion
factor in Setup.

## How it works

| File | Role |
| --- | --- |
| `js/detector.js` | Three-frame differencing to find small moving blobs, then links them into tracks and stitches pieces split at the bat |
| `js/geometry.js` | Camera calibration: quick setup from three stump markers and the camera height, or four pitch corners |
| `js/physics.js` | Rebuilds the 3D path from the 2D track using gravity, drag and the bounce on the calibrated ground; finds the bounce and bat impact; simulates the shot over the field |
| `js/maps.js` | Session pitch map and at-the-stumps map |
| `js/clips.js` | Keeps the last seconds of frames, saves each ball's clip, replays it |
| `js/store.js` | Sessions and clips in the browser's IndexedDB (stays on the phone) |
| `js/field.js` | Field presets, position names, draggable top-down field |
| `js/sim.js` | Demo scene and delivery generator (also used by the tests) |
| `js/app.js` | UI glue |

No build step and no dependencies.

## Tests

```bash
node tracker/test/run.mjs
```

Generates deliveries with true physics, projects them through a virtual camera
with pixel noise, and checks the reconstruction against the truth.

## Limits worth knowing

- One camera cannot see depth; it is inferred from physics. On simulated balls
  the median ball-speed error is about 4% (larger for yorkers and at 30 fps).
  Camera height matters mostly for where the ball pitched: about 40 cm median
  error at 100 cm, 15 cm at 150 cm, under 10 cm at 300 cm and above. Real footage has not been tuned yet and will be rougher.
- At 30 fps roughly a third of shots are missed in simulation (the ball leaves
  the frame too quickly); at 60 fps about one in ten. Use 60 fps.
- Calibrating on the stumps is about half as accurate as on the pitch corners
  for the same tapping error.
- Bat speed is derived from the ball's exit speed with a collision model, not
  measured from the bat.
- Spin is reported as turn off the pitch, not revolutions.
- From behind the bowler, the batter's body often hides the ball before it
  arrives. Such balls are logged as "Ball lost" with their speed, rather than
  guessing the length or the shot.
- Speed depends on the camera height you enter: 20 cm out is about 6 km/h.

## Design

Graphite neutrals, hairline borders, one green accent, Geist and Geist Mono.
Colour is kept for the content (the field, the ball paths, the maps). The
restyle followed the audit and pass order of the
[unslop](https://github.com/heydamir/unslop) skill by Damir Sokolovsky
(CC BY 4.0); none of its code is included.
