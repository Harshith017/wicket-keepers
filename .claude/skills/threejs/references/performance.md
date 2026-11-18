# Performance

Measure first: `renderer.info.render.calls` and `.triangles` after a frame, and the browser's
performance panel. Targets for a mid-range phone at 60 fps: < 100 draw calls, < 500k triangles,
< 64 MB of textures.

## Cheapest wins

- **Pixel ratio:** `Math.min(devicePixelRatio, 2)`; for heavy scenes on phones 1.5, or lower it
  while the user drags and restore it at rest.
- **Render on demand** for still scenes: render on load, resize and `controls` `change`, not
  every frame.
- **Pause off screen:** `IntersectionObserver` → `setAnimationLoop(null)` when hidden, restore
  when visible. Do the same on `visibilitychange`.
- **One canvas.** Several 3D views on one page: one renderer with scissor/viewport per view,
  or render to textures, rather than many WebGL contexts.

## Draw calls

- Many copies of one mesh → `InstancedMesh` (set `instanceMatrix`, optionally `instanceColor`).
- Many different static meshes sharing a material → merge with `BufferGeometryUtils.mergeGeometries`
  (`three/addons/utils/BufferGeometryUtils.js`) or use `BatchedMesh`.
- Share materials and geometries between meshes instead of cloning per object.

## Shadows and lights

- Shadows on one `DirectionalLight` only; `shadow.mapSize` 1024 (2048 max), and tighten
  `shadow.camera` left/right/top/bottom/near/far around the subject.
- A static scene: render the shadow once (`renderer.shadowMap.autoUpdate = false`, then
  `renderer.shadowMap.needsUpdate = true` when something moves).
- A soft contact shadow under a product: a blurred shadow texture on a plane is cheaper than
  real-time shadows.
- Prefer environment light plus one or two direct lights over many point lights.

## Textures and memory

- ≤ 2048px (1024 on phones); KTX2 when there are many.
- `renderer.initTexture(tex)` / `renderer.compile(scene, camera)` after loading avoids a hitch on
  the first frame.
- Dispose what you remove: `geometry.dispose()`, `material.dispose()`, every texture on the
  material, render targets, `controls.dispose()`, and finally `renderer.dispose()`.

```js
function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
```

## Post-processing

Only when it earns its cost. `EffectComposer` (`three/addons/postprocessing/`) adds full-screen
passes; each pass costs a full redraw at the pixel ratio. Bloom and SSAO are the expensive ones.
Add `OutputPass` last so tone mapping and colour space stay correct.

## WebGPU

`three/webgpu` (`WebGPURenderer`, TSL node materials) falls back to WebGL2 automatically. Use it
only when the project needs compute or node materials; the WebGL renderer above remains the
default for ordinary pages.
