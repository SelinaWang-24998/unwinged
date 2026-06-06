import * as THREE from 'three';
import { getScene, getGridSize, getTileSize } from './scene.js';

let waterMesh;
let waveOffset = 0;
const GRID = getGridSize();
const TILE = getTileSize();

export function createOcean() {
  const scene = getScene();
  const half = (GRID / 2) * TILE;

  // Water plane slightly below ground level
  const geo = new THREE.PlaneGeometry(GRID * TILE, GRID * TILE, GRID * 2, GRID * 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x3388cc,
    transparent: true,
    opacity: 0.55,
    specular: 0x88bbff,
    shininess: 60,
    side: THREE.DoubleSide,
  });
  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.15;
  waterMesh.name = 'ocean';
  scene.add(waterMesh);

  // Decorative waves/ripples
  const rippleGroup = new THREE.Group();
  for (let i = 0; i < 60; i++) {
    const rx = (Math.random() - 0.5) * GRID * TILE;
    const rz = (Math.random() - 0.5) * GRID * TILE;
    const s = 0.1 + Math.random() * 0.3;
    const rGeo = new THREE.PlaneGeometry(s, s);
    const rMat = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    const ripple = new THREE.Mesh(rGeo, rMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(rx, -0.1, rz);
    ripple.userData = { baseX: rx, baseZ: rz, speed: 0.5 + Math.random() * 1.5, amp: 0.02 + Math.random() * 0.04 };
    rippleGroup.add(ripple);
  }
  rippleGroup.name = 'ripples';
  scene.add(rippleGroup);
}

export function updateOcean(delta) {
  waveOffset += delta * 0.5;
  const scene = getScene();
  const ripples = scene.getObjectByName('ripples');
  if (ripples) {
    ripples.children.forEach(r => {
      r.position.y = -0.1 + Math.sin(waveOffset * r.userData.speed) * r.userData.amp;
    });
  }
}

// Create wave effect (called by gyro mode B on sea)
export function createWave(direction, intensity) {
  const scene = getScene();
  const ripples = scene.getObjectByName('ripples');
  if (ripples) {
    ripples.children.forEach(r => {
      const dx = r.userData.baseX;
      const dz = r.userData.baseZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      r.position.y += Math.sin(dist * 2 + waveOffset) * intensity * 0.3;
    });
  }
  // Animate water mesh vertices if needed
  if (waterMesh && waterMesh.geometry.attributes.position) {
    const pos = waterMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i); // note: plane is rotated, so Y is actually Z in world
      pos.setZ(i, Math.sin(x * 2 + waveOffset) * intensity * 0.15);
    }
    pos.needsUpdate = true;
  }
}

// Check if position is in water (not on island land)
export function isInWater(gx, gz) {
  return true; // Simplified - water covers everything, island blocks sit on top
}

export function isInShallowWater(gx, gz, isLandFn) {
  const half = (GRID / 2);
  // Within grid bounds
  if (Math.abs(gx) > half || Math.abs(gz) > half) return false;
  // Not on land
  if (isLandFn && isLandFn(gx, gz)) return false;
  // Within 4 tiles of center island area
  const dist = Math.sqrt(gx * gx + gz * gz);
  return dist < 8;
}

export function getWaterMesh() { return waterMesh; }
