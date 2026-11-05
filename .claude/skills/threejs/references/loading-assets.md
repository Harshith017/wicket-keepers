# Loading models and textures

## Formats

- **GLB** (binary glTF) for every model: one file, fast to parse. Convert FBX/OBJ/STEP with
  Blender or `gltf-transform` before shipping.
- Optimise with `gltf-transform` (npm `@gltf-transform/cli`):
  `npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2`
  (or `--compress draco`). Typical result: 5–20x smaller.
- Textures: KTX2 (Basis) for big sets; otherwise WebP/AVIF/JPEG for colour, PNG only when
  alpha is needed. Powers of two are not required in WebGL2, but keep sizes ≤ 2048.

## Loader setup (pinned version everywhere)

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const V = '0.186.1'; // same as the import map
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => setProgress(loaded / total);
manager.onError = (url) => console.error('failed to load', url);

const draco = new DRACOLoader(manager)
  .setDecoderPath(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/libs/draco/gltf/`);
const ktx2 = new KTX2Loader(manager)
  .setTranscoderPath(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/libs/basis/`)
  .detectSupport(renderer);

const gltfLoader = new GLTFLoader(manager)
  .setDRACOLoader(draco)
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);

const gltf = await gltfLoader.loadAsync('assets/model.glb');
scene.add(gltf.scene);
```

With a bundler, copy `node_modules/three/examples/jsm/libs/draco/gltf/` and `.../libs/basis/`
into the public folder and point the paths there instead of the CDN.

## Colour space

- Colour textures (base colour, emissive, sprite, video): `tex.colorSpace = THREE.SRGBColorSpace`.
- Data textures (normal, roughness, metalness, AO, displacement): leave as `NoColorSpace`/linear.
- GLTFLoader sets these correctly; set them yourself only for textures you load with
  `TextureLoader`.
- Textures on glTF models use `flipY = false`; `TextureLoader` defaults to `true`. Set
  `tex.flipY = false` when putting a hand-loaded texture on a glTF model's UVs.

## Framing a model

Never hard-code camera positions for an unknown model. Fit from its bounds:

```js
function frame(object, camera, controls, margin = 1.25) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);                       // centre at the origin
  const radius = size.length() / 2;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (radius * margin) / Math.sin(fov / 2);
  camera.position.set(dist * 0.6, dist * 0.35, dist * 0.75);
  camera.near = dist / 100; camera.far = dist * 100;
  camera.updateProjectionMatrix();
  if (controls) { controls.target.set(0, 0, 0); controls.update(); }
}
```

## Environment light

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
```

For a real studio look, load an `.hdr` with `HDRLoader` (`three/addons/loaders/HDRLoader.js`),
set `texture.mapping = THREE.EquirectangularReflectionMapping`, and assign to
`scene.environment` (and `scene.background` only if the backdrop should show it). Keep HDRs at
1k–2k; they are large.

## Animations in a model

```js
const mixer = new THREE.AnimationMixer(gltf.scene);
gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
// in the loop: mixer.update(delta)
```
