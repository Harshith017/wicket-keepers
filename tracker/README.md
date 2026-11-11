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

1. Tripod the phone behind the bowler's arm (or behind the keeper), at least
   150 cm high (higher is fine), with the whole pitch in frame. It must not
   move. The height is worked out from calibration, and the app warns if the
   camera is below 150 cm.
2. **Calibrate pitch**: drag the four handles onto the pitch corners (stump
   line at each end), or switch to **Calibrate on the stumps** and mark the
   base and top of the middle stump at each end. A magnifier shows while you
   drag. Corners are more accurate; stumps work where the pitch edges are not
   marked. Either way the drawn stumps should land on the real ones.
3. Set the field on the **Field** tab (presets, drag fielders, boundary size,
   left/right-hander) and bowl.

The camera is opened at 60 fps when the phone and browser allow it (the line
under the video says what rate you actually got).

Recorded clips work too (**Video clip**); for slow-motion footage set the
slow-motion factor in Setup so times are scaled back to real time.

## How it works

| File | Role |
| --- | --- |
| `js/detector.js` | Three-frame differencing to find small moving blobs, then links them into tracks and stitches pieces split at the bat |
| `js/geometry.js` | Camera calibration from four pitch corners (homography → focal length and pose) or from the two middle stumps |
| `js/physics.js` | Rebuilds the 3D path from the 2D track using gravity, drag and the bounce on the calibrated ground; finds the bounce and bat impact; simulates the shot over the field |
| `js/maps.js` | Session pitch map and at-the-stumps map |
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
- If the ball is hidden by the batter at impact the ball is logged as
  "Shot not seen" rather than guessed.

## Design

Graphite neutrals, hairline borders, one green accent, Geist and Geist Mono.
Colour is kept for the content (the field, the ball paths, the maps). The
restyle followed the audit and pass order of the
[unslop](https://github.com/heydamir/unslop) skill by Damir Sokolovsky
(CC BY 4.0); none of its code is included.
