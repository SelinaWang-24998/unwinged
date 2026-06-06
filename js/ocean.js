import * as THREE from 'three';
import { getScene, getGridSize, getTileSize, getMapRadius } from './scene.js';
import { isLand } from './island.js';

let waterMesh;
let waveOffset = 0;
const GRID = getGridSize();
const TILE = getTileSize();
const MAP_RADIUS = getMapRadius();
const LAND_RADIUS = 14;
const SHALLOW_INNER = LAND_RADIUS;
const SHALLOW_OUTER = 17;

// Wave force state — continuous sinusoidal push
let waveForceDir = new THREE.Vector3(1, 0, 0.5).normalize(); // wave propagation direction
let waveForcePhase = 0;
const WAVE_FORCE_STRENGTH = 1.2; // base push strength (units/sec)
const WAVE_FORCE_PERIOD = 4.0;   // seconds per full wave cycle
let shallowWaveTex = null;
let deepWaveTex = null;
let shallowFlowMesh = null;
let deepFlowMesh = null;

function createWaveDirectionTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const arrowStep = 48;
  for (let y = -arrowStep; y <= size + arrowStep; y += arrowStep) {
    for (let x = -arrowStep; x <= size + arrowStep; x += arrowStep) {
      const jx = (Math.random() - 0.5) * 10;
      const jy = (Math.random() - 0.5) * 10;
      const cx = x + jx;
      const cy = y + jy;
      const len = 20 + Math.random() * 14;
      const head = 6 + Math.random() * 4;
      const a = 0.12 + Math.random() * 0.16;

      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - len * 0.4);
      ctx.lineTo(cx, cy + len * 0.4);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - head, cy + len * 0.4 - head);
      ctx.lineTo(cx, cy + len * 0.4);
      ctx.lineTo(cx + head, cy + len * 0.4 - head);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.center.set(0.5, 0.5);
  tex.offset.set(0, 0);
  tex.rotation = 0;
  tex.needsUpdate = true;
  return tex;
}

function updateWaveDirectionVisuals(delta) {
  const speedShallow = 0.12;
  const speedDeep = 0.08;
  if (shallowWaveTex) {
    shallowWaveTex.offset.x = (shallowWaveTex.offset.x + waveForceDir.x * delta * speedShallow) % 1;
    shallowWaveTex.offset.y = (shallowWaveTex.offset.y + waveForceDir.z * delta * speedShallow) % 1;
  }
  if (deepWaveTex) {
    deepWaveTex.offset.x = (deepWaveTex.offset.x + waveForceDir.x * delta * speedDeep) % 1;
    deepWaveTex.offset.y = (deepWaveTex.offset.y + waveForceDir.z * delta * speedDeep) % 1;
  }
}

export function createOcean() {
  const scene = getScene();
  const half = (GRID / 2) * TILE;

  // Shallow water ring (radius ~8 from center)
  const shallowGeo = new THREE.RingGeometry(SHALLOW_INNER * TILE, SHALLOW_OUTER * TILE, 128);
  const shallowMat = new THREE.MeshPhongMaterial({
    color: 0x1a3d6e,
    transparent: true,
    opacity: 0.45,
    specular: 0x88bbff,
    shininess: 60,
    side: THREE.DoubleSide,
  });
  shallowWaveTex = createWaveDirectionTexture(256);
  shallowWaveTex.repeat.set(16, 16);
  const shallowRing = new THREE.Mesh(shallowGeo, shallowMat);
  shallowRing.rotation.x = -Math.PI / 2;
  shallowRing.position.y = -0.14;
  shallowRing.name = 'shallowWater';
  scene.add(shallowRing);

  const shallowFlowMat = new THREE.MeshBasicMaterial({
    color: 0xbbe9ff,
    transparent: true,
    opacity: 0.32,
    map: shallowWaveTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shallowFlowMesh = new THREE.Mesh(shallowGeo, shallowFlowMat);
  shallowFlowMesh.rotation.x = -Math.PI / 2;
  shallowFlowMesh.position.y = -0.135;
  shallowFlowMesh.name = 'shallowFlow';
  scene.add(shallowFlowMesh);

  // Full water plane (deep color base)
  const geo = new THREE.PlaneGeometry(GRID * TILE, GRID * TILE, GRID * 2, GRID * 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x3388cc,
    transparent: true,
    opacity: 0.65,
    specular: 0x4477aa,
    shininess: 40,
    side: THREE.DoubleSide,
  });
  deepWaveTex = createWaveDirectionTexture(256);
  deepWaveTex.repeat.set(12, 12);
  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.15;
  waterMesh.name = 'ocean';
  scene.add(waterMesh);

  const deepFlowMat = new THREE.MeshBasicMaterial({
    color: 0xa8ddff,
    transparent: true,
    opacity: 0.16,
    map: deepWaveTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  deepFlowMesh = new THREE.Mesh(geo, deepFlowMat);
  deepFlowMesh.rotation.x = -Math.PI / 2;
  deepFlowMesh.position.y = -0.145;
  deepFlowMesh.name = 'deepFlow';
  scene.add(deepFlowMesh);

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
  // Animate shallow water ring gentle bob
  const shallow = scene.getObjectByName('shallowWater');
  if (shallow) {
    shallow.position.y = -0.14 + Math.sin(waveOffset * 0.8) * 0.02;
  }
  // Rotate wave direction slowly
  updateWaveDirection(delta);
  updateWaveDirectionVisuals(delta);
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
  const dist = Math.sqrt(gx * gx + gz * gz);
  if (dist >= MAP_RADIUS) return false;
  return dist >= SHALLOW_INNER && dist < SHALLOW_OUTER;
}

// Deep water: beyond shallow ring OR beyond map radius
export function isInDeepWater(gx, gz) {
  const half = (GRID / 2);
  if (Math.abs(gx) > half || Math.abs(gz) > half) return true;
  if (isLand(gx, gz)) return false;
  const dist = Math.sqrt(gx * gx + gz * gz);
  if (dist >= MAP_RADIUS) return true;
  return dist >= SHALLOW_OUTER;
}

// Get wave force at a world position (returns THREE.Vector3)
// This creates a continuous sinusoidal push that oscillates direction
export function getWaveForce(wx, wz, delta) {
  waveForcePhase += delta * (2 * Math.PI / WAVE_FORCE_PERIOD);

  // Position-dependent phase: waves travel across the water surface
  const spatialPhase = (wx * waveForceDir.x + wz * waveForceDir.z) * 0.3;
  const forceMagnitude = Math.sin(waveForcePhase + spatialPhase) * WAVE_FORCE_STRENGTH;

  const force = new THREE.Vector3(
    waveForceDir.x * forceMagnitude * delta,
    0,
    waveForceDir.z * forceMagnitude * delta
  );
  return force;
}

// Slowly rotate wave direction over time for variety
export function updateWaveDirection(delta) {
  const angle = Math.sin(waveForcePhase * 0.1) * 0.5; // gentle oscillation
  waveForceDir.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
}

export function getWaterMesh() { return waterMesh; }
