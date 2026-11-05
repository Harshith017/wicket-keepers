---
name: threejs
description: Build 3D on the web with three.js (WebGL) — scenes, product viewers, hero backgrounds, data visuals, small games. Use whenever a page needs 3D, a GLTF/GLB model, a WebGL canvas, shaders, or "three.js"/"three" is mentioned, in plain HTML or any framework (React, Next.js, Vue, Svelte, Astro). Covers version pinning, setup, loading models and textures, lighting, responsiveness, performance on phones, cleanup and fallbacks.
---

# three.js

Ship 3D that loads fast, looks right in colour, runs on a mid-range phone, and never leaves an
empty box. Start from `assets/starter.html` (`<skill>` is this folder) unless the project already
has a three.js setup; then follow its version and patterns.

## 1. Pin one version

- Plain HTML: an import map with an **exact** version, `three` and `three/addons/` from the same
  release. The starter pins `0.186.1`. Never `@latest` or an unversioned URL.
  ```html
  <script type="importmap">
  { "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
  } }
  </script>
  ```
- Bundlers: `npm i three@<exact>`; import `three` and `three/addons/...`. Add `@types/three` at the
  matching minor for TypeScript. React: `@react-three/fiber` + `@react-three/drei` only if the
  project uses React; otherwise plain three.
- Addons (loaders, controls, environments) live under `three/addons/` — never `examples/js/` or
  globals like `THREE.OrbitControls`. Check the version's docs before using an API you remember
  from an old release: `Geometry`, `physicallyCorrectLights`, `useLegacyLights`, `outputEncoding`
  and `sRGBEncoding` are gone.

## 2. The setup every scene needs

The starter already does each of these; keep them when adapting it.

1. **Renderer:** `new THREE.WebGLRenderer({ antialias: true, alpha: <transparent page?> })`,
   `setPixelRatio(Math.min(devicePixelRatio, 2))`, `outputColorSpace = SRGBColorSpace` (default),
   a tone mapping (`ACESFilmicToneMapping`, `AgXToneMapping` or `NeutralToneMapping` for true
   product colours).
2. **Size from the container, not the window.** A `ResizeObserver` on the canvas's parent sets
   `renderer.setSize(w, h, false)`, `camera.aspect = w / h`, `camera.updateProjectionMatrix()`.
   The canvas is `display:block; width:100%; height:100%` in a box with a set height or aspect.
3. **Loop:** `renderer.setAnimationLoop(fn)`, time from `THREE.Timer` (`timer.update(t)`,
   `timer.getDelta()`), so motion is frame-rate independent. Stop the loop when the canvas is off
   screen (`IntersectionObserver`) or the tab is hidden. A still scene renders on demand (on
   load, resize and control change) instead of every frame.
4. **Light:** image-based light first — `scene.environment` from `RoomEnvironment` through
   `PMREMGenerator` (no file to load), or an `.hdr` via `HDRLoader` for real reflections. Add one
   `DirectionalLight` for shadow and shape. Materials: `MeshStandardMaterial` /
   `MeshPhysicalMaterial`.
5. **Reduced motion:** when `prefers-reduced-motion: reduce`, no auto-rotation or camera drift;
   render one still frame and keep user controls.
6. **Fallback:** if WebGL is unavailable or the context is lost, show a poster image (a
   screenshot of the scene) in the same box. Never an empty canvas.
7. **Cleanup** when the view unmounts: `setAnimationLoop(null)`, dispose geometries, materials,
   textures, render targets, controls and the renderer, disconnect observers.

## 3. Loading models and textures

Read `references/loading-assets.md` before loading any file. In short: GLB over glTF + bins;
compress with Draco or meshopt and KTX2 textures; `DRACOLoader`/`KTX2Loader` decoders from the
same pinned version; colour textures `SRGBColorSpace`, data maps (normal, roughness, metalness)
linear; a `LoadingManager` drives a progress state; frame the model from its bounding box, never
hard-coded camera numbers.

## 4. Performance budget

Read `references/performance.md` when a scene has more than a few objects, runs on a page with
other content, or targets phones. Defaults: pixel ratio ≤ 2 (≤ 1.5 on phones for heavy
scenes), under ~100 draw calls, `InstancedMesh` for repeats, textures ≤ 2048px (1024 on
phones), shadows on one light with a tight shadow camera, at most one live WebGL canvas per page
unless the page truly needs more (browsers cap contexts around 8–16).

## 5. Fitting it into a page

- 3D supports the content; text stays HTML, never baked into the canvas.
- Give the canvas box an explicit size so the page does not shift when it loads; show the poster
  or a quiet placeholder until the first frame.
- Pointer controls (`OrbitControls`) only where the user is meant to turn the object; set
  `enableDamping`, sensible `minDistance`/`maxDistance`, and disable zoom on scroll
  (`enableZoom = false`) for in-page viewers so the page still scrolls. On touch, avoid trapping
  vertical swipes.
- Accessibility: the canvas gets `role="img"` and an `aria-label` describing what it shows;
  interactive viewers offer keyboard or button alternatives.

## 6. Check before calling it done

- Open the page over http (never `file://`) and look at it at desktop and phone widths.
- Console has no WebGL errors or 404s for models, textures or decoders.
- Colours match the source (no washed-out or overly dark textures = colour space check).
- Resizing the window resizes the canvas without stretching.
- Reduced-motion mode shows a still frame; with WebGL disabled the poster shows.
- If Playwright or headless Chrome is available, screenshot the page after the first frame and
  check the canvas is not blank (sample a few pixels with `readPixels` or the screenshot).
