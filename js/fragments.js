import * as THREE from 'three';
import { getScene, getTileSize, getMapRadius } from './scene.js';
import { getPlayerPosition } from './player.js';
import { isLand, getTerrainHeight } from './island.js';
import { isInShallowWater } from './ocean.js';

const TILE = getTileSize();
const MAP_RADIUS = getMapRadius();
const FRAGMENT_COUNT = 3;
const LAND_RADIUS = 14;

let fragmentMeshes = [];
let collectedCount = 0;
let onCollectCallback = null;
let fragments = [];

function pickGridPoint(predicate) {
  const max = Math.floor(MAP_RADIUS / TILE);
  for (let i = 0; i < 800; i++) {
    const gx = Math.round((Math.random() * 2 - 1) * max);
    const gz = Math.round((Math.random() * 2 - 1) * max);
    const dist = Math.sqrt(gx * gx + gz * gz);
    if (dist >= max) continue;
    const p = { x: gx, z: gz };
    if (predicate(p)) return p;
  }
  return { x: 0, z: 0 };
}

function createFragmentData() {
  const landPick = pickGridPoint((p) => {
    if (!isLand(p.x, p.z)) return false;
    const dist = Math.sqrt(p.x * p.x + p.z * p.z);
    if (dist > LAND_RADIUS - 2) return false;
    return getTerrainHeight(p.x, p.z) >= 0.9;
  });

  const shallowPick = pickGridPoint((p) => {
    if (isLand(p.x, p.z)) return false;
    return isInShallowWater(p.x, p.z, isLand);
  });

  const buildPick = pickGridPoint((p) => {
    if (!isLand(p.x, p.z)) return false;
    const dist = Math.sqrt(p.x * p.x + p.z * p.z);
    if (dist > LAND_RADIUS - 2) return false;
    return getTerrainHeight(p.x, p.z) <= 0.9;
  });

  return [
    { id: 0, basePos: new THREE.Vector3(landPick.x * TILE, getTerrainHeight(landPick.x, landPick.z) + 1.0, landPick.z * TILE), collected: false },
    { id: 1, basePos: new THREE.Vector3(shallowPick.x * TILE, -0.05, shallowPick.z * TILE), collected: false },
    { id: 2, basePos: new THREE.Vector3(buildPick.x * TILE, getTerrainHeight(buildPick.x, buildPick.z) + 2.2, buildPick.z * TILE), collected: false },
  ];
}

export function createFragments() {
  const scene = getScene();
  const group = new THREE.Group();
  group.name = 'fragments';

  fragmentMeshes = [];
  collectedCount = 0;
  fragments = createFragmentData();

  fragments.forEach(f => {
    const geo = new THREE.OctahedronGeometry(0.25, 0);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffdd44,
      emissive: 0xffaa00,
      emissiveIntensity: 0.6,
      specular: 0xffffff,
      shininess: 80,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(f.basePos);
    mesh.userData = { fragmentId: f.id, baseY: mesh.position.y };
    mesh.name = `fragment-${f.id}`;

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
    const fData = fragments.find(f => f.id === m.userData.fragmentId);
    if (fData && !fData.collected) {
      const baseY = m.userData.baseY ?? m.position.y;
      m.position.y = baseY + Math.sin(time * 2 + fData.id) * 0.2;
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
  for (const f of fragments) {
    if (f.collected) continue;
    const mesh = fragmentMeshes.find(m => m.userData.fragmentId === f.id);
    if (!mesh || !mesh.visible) continue;
    const dist = playerPos.distanceTo(mesh.position);
    if (dist < 1.0) {
      f.collected = true;
      collectedCount++;
      // Hide mesh
      if (mesh) mesh.visible = false;
      if (onCollectCallback) onCollectCallback(f.id, collectedCount);
      return f.id;
    }
  }
  return -1;
}

export function onFragmentCollected(cb) { onCollectCallback = cb; }
export function getCollectedCount() { return collectedCount; }
export function getTotalFragments() { return FRAGMENT_COUNT; }
export function getAllCollected() { return collectedCount >= FRAGMENT_COUNT; }
export function hasFragments() { return collectedCount > 0; }
export function consumeFragment() {
  if (collectedCount > 0) {
    collectedCount--;
    return true;
  }
  return false;
}
export function resetFragments() {
  collectedCount = 0;
  fragments = [];
  fragmentMeshes = [];
}
