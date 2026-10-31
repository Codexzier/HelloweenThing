import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Kenney "Animated Characters Survivors" ist in Zentimetern modelliert
export const FBX_SCALE = 1.78 / 376;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// Dreht einen Knochen so, dass die Richtung (bone -> child) zur Zielrichtung (Welt) zeigt.
export function pointBone(bone, child, targetDir, weight = 1) {
  bone.updateWorldMatrix(true, true);
  const a = bone.getWorldPosition(_v1);
  const b = child.getWorldPosition(_v2);
  const cur = _v3.subVectors(b, a).normalize();
  _q.setFromUnitVectors(cur, targetDir);
  if (weight < 1) _q.slerp(_q2.identity(), 1 - weight);
  // Weltrotation -> lokale Rotation
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const newWorld = _q.multiply(boneWorldQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateWorldMatrix(false, true);
}

// Kopie des animierten Survivor-Modells mit eigenem Skin
export function createSurvivor(assets, skin, glow = 0.22) {
  const model = SkeletonUtils.clone(assets.character);
  model.scale.setScalar(FBX_SCALE);
  const tex = assets.textures[skin];
  model.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(glow, glow * 1.1, glow * 1.35) });
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false;
    }
  });
  const root = new THREE.Group();
  root.add(model);
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [k, clip] of Object.entries(assets.clips)) {
    // Wurzelbewegung entfernen, damit die Figur auf der Stelle animiert
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => !(t.name.startsWith('HipsCtrl.position') || t.name.startsWith('Root.position')));
    actions[k] = mixer.clipAction(c);
  }
  return { root, model, bones, mixer, actions, materials: [] };
}

// Kopie eines Graveyard-Kit-Charakters (Knoten-Animationen)
export function createBlocky(assets, key, scale) {
  const g = assets.get(key);
  const model = SkeletonUtils.clone(g.scene);
  model.scale.setScalar(scale);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      const m = o.material.clone();
      if (m.map) { m.emissiveMap = m.map; m.emissive = new THREE.Color(0.1, 0.11, 0.14); }
      o.material = m;
    }
  });
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
  return { root, model, mixer, actions };
}

export function fadeTo(entity, name, dur = 0.2, timeScale = 1) {
  const next = entity.actions[name];
  if (!next) return;
  next.timeScale = timeScale;
  if (entity.current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(dur).play();
  if (entity.current) entity.current.fadeOut(dur);
  entity.current = next;
}
