import * as THREE from 'three';
import { getScene, getTileSize } from './scene.js';
import { getPlayerPosition } from './player.js';

const TILE = getTileSize();

// 3 fragments: [worldX, worldY, worldZ]
const FRAGMENT_POSITIONS = [
  { pos: new THREE.Vector3(-3 * TILE, 2.2, -3 * TILE), collected: false, id: 0 }, // Island highland
  { pos: new THREE.Vector3(5 * TILE, 0.4, 3 * TILE), collected: false, id: 1 },   // Shallow water
  { pos: new THREE.Vector3(3 * TILE, 3.8, 1 * TILE), collected: false, id: 2 },   // High platform - needs stacking
];

let fragmentMeshes = [];
let collectedCount = 0;
let onCollectCallback = null;

export function createFragments() {
  const scene = getScene();
  const group = new THREE.Group();
  group.name = 'fragments';

  FRAGMENT_POSITIONS.forEach(f => {
    const geo = new THREE.OctahedronGeometry(0.25, 0);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffdd44,
      emissive: 0xffaa00,
      emissiveIntensity: 0.6,
      specular: 0xffffff,
      shininess: 80,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(f.pos);
    mesh.userData = { fragmentId: f.id };
    mesh.name = `fragment-${f.id}`;

    // Glow ring
    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'glow';
    mesh.add(ring);

    group.add(mesh);
    fragmentMeshes.push(mesh);
  });

  scene.add(group);
  return group;
}

export function updateFragments(delta) {
  const time = performance.now() * 0.001;
  fragmentMeshes.forEach(m => {
    if (!m.visible) return;
    // Bob up and down
    const fData = FRAGMENT_POSITIONS.find(f => f.id === m.userData.fragmentId);
    if (fData && !fData.collected) {
      m.position.y = fData.pos.y + Math.sin(time * 2 + fData.id) * 0.2;
      m.rotation.y += delta * 1.5;
      // Glow ring animation
      const ring = m.getObjectByName('glow');
      if (ring) {
        ring.scale.setScalar(1 + Math.sin(time * 3) * 0.15);
        ring.material.opacity = 0.3 + Math.sin(time * 3) * 0.2;
      }
    }
  });
}

export function checkFragmentCollection() {
  const playerPos = getPlayerPosition();
  for (const f of FRAGMENT_POSITIONS) {
    if (f.collected) continue;
    const dist = playerPos.distanceTo(f.pos);
    if (dist < 1.0) {
      f.collected = true;
      collectedCount++;
      // Hide mesh
      const mesh = fragmentMeshes.find(m => m.userData.fragmentId === f.id);
      if (mesh) mesh.visible = false;
      if (onCollectCallback) onCollectCallback(f.id, collectedCount);
      return f.id;
    }
  }
  return -1;
}

export function onFragmentCollected(cb) { onCollectCallback = cb; }
export function getCollectedCount() { return collectedCount; }
export function getTotalFragments() { return FRAGMENT_POSITIONS.length; }
export function getAllCollected() { return collectedCount >= FRAGMENT_POSITIONS.length; }
export function hasFragments() { return collectedCount > 0; }
export function consumeFragment() {
  if (collectedCount > 0) {
    collectedCount--;
    return true;
  }
  return false;
}
export function resetFragments() {
  FRAGMENT_POSITIONS.forEach(f => f.collected = false);
  collectedCount = 0;
  fragmentMeshes.forEach(m => m.visible = true);
}
