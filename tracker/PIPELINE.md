# Training pipeline (automatic)

Frames from the nets reach a retrained cricket-ball detector with nobody exporting or
uploading files. A scheduled Claude task runs these steps every week.

```
Tracker (Setup › Send frames automatically, signed in, approved account)
  → Firestore collection ballFrames            (this site's Firebase project, wicket-keepers)
  → weekly job: move new frames to Roboflow    (project new-ball-tracking-jlgnj, tag "nets")
  → monthly job: fine-tune the model on them   (free credits only)
  → if it beats the current model: pull request swapping it into tracker/vendor
```

## One-time setup

1. Firebase console › Firestore Database › Rules: add the block in
   [firestore-rules.txt](firestore-rules.txt) and Publish.
2. In the tracker, Setup › **Send frames automatically: On**, then **Sign in** with the Google
   account you use in Wicket Keepers (it must be approved there).

## What is sent

Only frames where the detector itself was sure of the ball (score 0.5 or more), at most 8 per
ball, re-encoded small (about 60-100 KB). Frames only the motion tracker placed, or with no
ball, are not sent: nobody checks these labels, and a wrong unchecked label teaches the model
wrong. So the model learns your nets, light and balls, but it improves on its own mistakes
slowly; checking labels in Roboflow by hand, when you feel like it, speeds that up.

## The weekly job (exact instructions)

1. **Read new frames.** Firestore REST, no sign-in (the rules allow reading):
   `GET https://firestore.googleapis.com/v1/projects/wicket-keepers/databases/(default)/documents/ballFrames?pageSize=100`
   and follow `nextPageToken`. Each document has `img` (base64 JPEG, 640x640), `label` (YOLO
   line, class 0 = ball), `score`, `by`, `ball`, `uid`, `createdAt`.
2. **Upload to Roboflow** (Roboflow connector): build a zip with `train/images/<doc>.jpg`,
   `train/labels/<doc>.txt`, and `valid/...` for about one ball in five (by a hash of `ball`, so a
   ball's frames stay together), plus `data.yaml` (`nc: 1`, `names: ['ball']`). Call
   `image_upload` on project `new-ball-tracking-jlgnj` with tags `nets` and `nets-YYYY-MM-DD`, PUT
   the zip to the signed URL, and poll `image_upload_status`. Duplicates are skipped by Roboflow,
   so re-sending a frame is harmless.
3. **Clear old frames.** DELETE (no sign-in) documents with `createdAt` older than 7 days: they
   were moved by this run or an earlier one. Keeps the free database small.
4. **Monthly retrain** (first run of each month), only if at least 150 `nets` images arrived since
   the last training:
   - generate a version keeping only `nets` images (preprocessing `filter-tags: {"nets": true}`,
     the same resize as version 1: 640x640, fit with black edges);
   - `trainings_create` with `rfdetr-nano`, starting from the current model as checkpoint
     (`new-ball-tracking-jlgnj/<its version>`), on free credits only. The workspace is on the free
     plan with no card saved, so it cannot be charged: if credits are out, skip this month.
5. **Swap the model in, only if better.** Download the weights (`models_weights_download_url`),
   export to ONNX at 512, and compare it with the model in `tracker/vendor` on the held-back
   `valid` nets frames (share of balls found within 4 px). If better, open a pull request on
   Harshith017/wicket-keepers adding the model and `tracker/vendor/ball-model.json`
   (`format: "detr"`, `size: 512`, `normalize: "imagenet"`, `classIndex` per the export), with
   the comparison in the description. Never merge it.
6. **Report** in one short note: frames moved, frames cleared, training started or why not, the
   comparison and the pull request, if any.

## Limits

- Roboflow's free plan: 10 credits a month, so about one small fine-tune a month at most.
- If the free plan does not allow downloading trained weights, step 5 stops at reporting the
  model's scores in Roboflow; the tracker keeps its current model.
- The frames are readable by anyone who knows the address until cleared (they go to a public
  Roboflow project anyway). Nobody can change them; only approved accounts can add them.
