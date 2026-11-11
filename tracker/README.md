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

1. Tripod the phone behind the bowler's arm (or behind the keeper), as high as
   possible, with the whole pitch in frame. It must not move.
2. **Calibrate pitch**: drag the four handles onto the pitch corners (stump
   line at each end). The drawn stumps should land on the real ones.
3. Set the field on the **Field** tab (presets, drag fielders, boundary size,
   left/right-hander) and bowl.

Recorded clips work too (**Video clip**); for slow-motion footage set the
slow-motion factor in Setup so times are scaled back to real time.

## How it works

| File | Role |
| --- | --- |
| `js/detector.js` | Three-frame differencing to find small moving blobs, then links them into tracks and stitches pieces split at the bat |
| `js/geometry.js` | Camera calibration from four pitch corners (homography → focal length and pose) |
| `js/physics.js` | Rebuilds the 3D path from the 2D track using gravity, drag and the bounce on the calibrated ground; finds the bounce and bat impact; simulates the shot over the field |
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
  the median ball-speed error is about 4% (larger for yorkers, at 30 fps, and
  with a low camera). Real footage has not been tuned yet and will be rougher.
- Bat speed is derived from the ball's exit speed with a collision model, not
  measured from the bat.
- Spin is reported as turn off the pitch, not revolutions.
- If the ball is hidden by the batter at impact the ball is logged as
  "Shot not seen" rather than guessed.
