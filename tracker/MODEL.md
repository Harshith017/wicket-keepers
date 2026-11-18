# A cricket-ball detector

The tracker follows the ball into the batter with a small detector. By default that is
YOLO11n and its COCO "sports ball" class: a general model that was never trained on a small,
blurred cricket ball against a batter's whites, and licensed AGPL-3.0. A model trained on
frames from your own nets fixes both. This is how to make one and drop it in.

## 1. Collect frames from your nets

1. In **Setup**, set **Collect training frames** to **On**.
2. Run sessions as usual: live, or from clips. For every ball the tracker keeps the 640x640
   crops of the batter's end that the detector looks at, from the frame motion tracking lost
   the ball to just after it reached the bat (up to 600 frames per visit; they are not saved
   when the page closes).
3. **Setup › Training frames › Export** downloads a zip in YOLO format:
   `images/train/*.jpg`, `labels/train/*.txt` (class 0 = ball) and `data.yaml`.

The labels are where the tracker placed the ball: a head start, not the truth. Some will be
off, and an empty label file only means the tracker did not place the ball there.

Get variety: different light (sun, cloud, floodlights), both ends of the day, red, white and
pink balls, fast bowlers and spinners, a few nets. A few hundred frames from your own setup
are worth more than thousands of broadcast frames, because the detector sees exactly this view.

## 2. Check the labels

Any tool that reads YOLO format works. Two that Claude can drive:

- **Roboflow.** Upload the zip as a YOLO dataset, fix each box, and mark frames without a
  ball as null. In Claude Code, `claude plugin marketplace add roboflow/computer-vision-skills`
  then `claude plugin install roboflow` gives Claude the Roboflow tools (in the Claude app,
  the Roboflow connector). Roboflow Universe also has public cricket-ball datasets, for example
  [this one](https://universe.roboflow.com/pitchcoordinatesprediction/ball-detection-s60hy)
  (about 6,900 images, CC BY 4.0, credit the authors). They are mostly broadcast views, so use them
  to add variety, not instead of your own frames. Check each dataset's licence.
- **Label Studio or CVAT**, free and self-hosted, if the frames must stay on your machine.

Keep whole sessions apart for testing: if frames from the same ball land in both training
and test sets, the test score is flattering.

## 3. Train a model with a permissive licence

Pick one that exports to ONNX and is small enough for a phone (aim for under 30 MB):

| Model | Licence | Format for the tracker |
| --- | --- | --- |
| [RF-DETR](https://github.com/roboflow/rf-detr) Nano or Small | Apache-2.0 | `detr`, `imagenet` normalisation |
| RT-DETRv2 (Hugging Face Transformers) | Apache-2.0 | `detr` |
| [D-FINE](https://github.com/Peterande/D-FINE) N or S | Apache-2.0 | `detr` |
| YOLOX or YOLOv9 via [LibreYOLO](https://pypi.org/project/libreyolo/) | MIT code (check the weights) | check its export |

Ways to train without your own GPU:

- **Roboflow** trains RF-DETR from the labelled dataset and exports ONNX.
- **Hugging Face Jobs**: the `huggingface-vision-trainer` skill (`/plugin marketplace add
  huggingface/skills` in Claude Code) fine-tunes RT-DETRv2 and pushes it to the Hub.
- **RF-DETR in Python** (Colab or any GPU):
  ```python
  from rfdetr import RFDETRNano
  model = RFDETRNano()
  model.train(dataset_dir="ball-frames", epochs=50, batch_size=8)   # COCO or YOLO layout, see the RF-DETR docs
  model.export(format="onnx")
  ```

Train at the size you will run (512 is a good start: the ball is small in the crop), and
check the docs of the version you install for its dataset layout and allowed input sizes.

## 4. Drop it in

Copy the `.onnx` file into `tracker/vendor/` and add `tracker/vendor/ball-model.json`:

```json
{
  "name": "Cricket ball, RF-DETR Nano, our nets 2026-11",
  "file": "ball-rfdetr-nano.onnx",
  "format": "detr",
  "size": 512,
  "classIndex": 0,
  "normalize": "imagenet",
  "minScore": 0.3
}
```

- `format`: `yolo` for an Ultralytics-style output `[1, 4 + classes, N]`; `detr` for boxes
  `[1, N, 4]` (centre x, y, width, height in 0..1) with class logits `[1, N, classes]`.
- `size`: the model's square input size in pixels.
- `classIndex`: the ball's class in the model's output. For a one-class model, usually 0. Some
  DETR exports put a "background" class first: if no balls are found, try 1.
- `normalize`: `unit` (pixels / 255) or `imagenet` (pixels / 255, then the ImageNet mean and
  standard deviation). Use whatever the model was trained with.
- `minScore`: the lowest confidence that counts as a ball.

Without the file, the tracker uses YOLO11n as before. The model loads the first time a
session starts and the browser caches it.

## 5. Check it is better

Run the same clips with the old and the new model (move `ball-model.json` aside to get the
old one) and compare, ball by ball, the **reached bat** frame each one finds against the frame
you pick by eye in the replay. Also watch for false pickups: balls in the next net, the
bowler's marker, a white helmet badge. Keep the model only if it is closer more often and
misses less.

Then remove `yolo11n.onnx` from `vendor/` and the AGPL note in the README.

## Later: a tracker that reads several frames at once

Single-frame detectors struggle most with exactly this ball: a few pixels, smeared by motion,
crossing white clothing. Heatmap trackers built for small, fast balls look at three or more
consecutive frames together, so the movement itself gives the ball away:
[TrackNetV3](https://people.cs.nycu.edu.tw/~yushuen/data/TrackNetV3.pdf) (MIT),
[TrackNetV4](https://time.anu.edu.au/paper-sites/tracknetv4/) and
[WASB](https://github.com/nttcom/WASB-SBDT) (MIT, 8-17% better than earlier trackers in its
authors' tests across five sports). None has been trained on cricket, and each takes a
different input (TrackNetV3 also feeds a background frame), so the tracker does not run one yet.

The export already holds what they train on: `sequences/*.csv` lists each ball's frames in
order with the ball's position (Frame, Visibility, X, Y), the layout TrackNet's tools use, next
to the images. Once there are a few thousand checked frames, fine-tune one of these on them,
export it to ONNX, and the tracker can be taught its input and output, the way `detections.js`
reads YOLO and DETR models today.
