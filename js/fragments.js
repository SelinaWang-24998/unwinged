import * as THREE from "three";
import { getScene, getTileSize, getGridSize } from "./scene.js";
import { getPlayerPosition } from "./player.js";
import { getTerrainHeight, isLand } from "./island.js";
import { isInShallowWater } from "./ocean.js";

const TILE = getTileSize();
const GRID = getGridSize();

function pickRandomGridCell(candidates, usedKeys) {
  if (!candidates.length) return null;
  const start = Math.floor(Math.random() * candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const idx = (start + i) % candidates.length;
    const c = candidates[idx];
    const key = `${c.gx},${c.gz}`;
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return c;
    }
  }
  return null;
}

function randomizeFragmentPositions() {
  const used = new Set();
  const half = Math.floor(GRID / 2);

  const land = [];
  const highLand = [];
  const buildableLand = [];
  const shallowWater = [];

  for (let gx = -half + 1; gx <= half - 1; gx++) {
    for (let gz = -half + 1; gz <= half - 1; gz++) {
      if (isLand(gx, gz)) {
        land.push({ gx, gz });
        const h = getTerrainHeight(gx, gz);
        if (h >= 1.2) highLand.push({ gx, gz });
        if (h <= 1.8) buildableLand.push({ gx, gz });
      } else if (isInShallowWater(gx, gz, isLand)) {
        shallowWater.push({ gx, gz });
      }
    }
  }

  const f0 = FRAGMENT_POSITIONS.find((f) => f.id === 0);
  const f1 = FRAGMENT_POSITIONS.find((f) => f.id === 1);
  const f2 = FRAGMENT_POSITIONS.find((f) => f.id === 2);

  if (f0) {
    const cell = pickRandomGridCell(highLand.length ? highLand : land, used);
    if (cell) {
      const y = getTerrainHeight(cell.gx, cell.gz) + 0.25;
      f0.pos.set(cell.gx * TILE, y, cell.gz * TILE);
    }
  }

  if (f1) {
    const cell = pickRandomGridCell(shallowWater, used);
    if (cell) {
      f1.pos.set(cell.gx * TILE, 0.4, cell.gz * TILE);
    }
  }

  if (f2) {
    const cell = pickRandomGridCell(
      buildableLand.length ? buildableLand : land,
      used,
    );
    if (cell) {
      f2.pos.set(cell.gx * TILE, 3.8, cell.gz * TILE);
    }
  }
}

// 3 fragments: [worldX, worldY, worldZ]
const FRAGMENT_POSITIONS = [
  {
    pos: new THREE.Vector3(-3 * TILE, 2.2, -3 * TILE),
    collected: false,
    id: 0,
  }, // Island highland
  { pos: new THREE.Vector3(5 * TILE, 0.4, 3 * TILE), collected: false, id: 1 }, // Shallow water
  { pos: new THREE.Vector3(3 * TILE, 3.8, 1 * TILE), collected: false, id: 2 }, // High platform - needs stacking
];

let fragmentMeshes = [];
let collectedCount = 0;
let totalCollectedEver = 0; // 从未减少，记录游戏过程中总共收集到的数量
let onCollectCallback = null;
const DISAPPEAR_DURATION = 0.35; // seconds for shrink+fade animation

export function createFragments() {
  const scene = getScene();
  const existing = scene.getObjectByName("fragments");
  if (existing) scene.remove(existing);

  fragmentMeshes = [];
  FRAGMENT_POSITIONS.forEach((f) => (f.collected = false));
  collectedCount = 0;

  randomizeFragmentPositions();

  const group = new THREE.Group();
  group.name = "fragments";

  FRAGMENT_POSITIONS.forEach((f) => {
    const geo = new THREE.OctahedronGeometry(0.25, 0);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffdd44,
      emissive: 0xffaa00,
      emissiveIntensity: 0.6,
      specular: 0xffffff,
      shininess: 80,
      transparent: true,
      opacity: 1.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(f.pos);
    mesh.userData = {
      fragmentId: f.id,
      disappearing: false,
      disappearTimer: 0,
    };
    mesh.name = `fragment-${f.id}`;

    // Glow ring
    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.name = "glow";
    mesh.add(ring);

    group.add(mesh);
    fragmentMeshes.push(mesh);
  });

  scene.add(group);
  return group;
}

export function updateFragments(delta) {
  const time = performance.now() * 0.001;
  fragmentMeshes.forEach((m) => {
    if (!m.visible) return;

    // Handle disappearing animation
    if (m.userData.disappearing) {
      m.userData.disappearTimer -= delta;
      const t = Math.max(0, m.userData.disappearTimer / DISAPPEAR_DURATION);
      // Shrink scale
      m.scale.setScalar(t);
      // Fade out material opacity
      m.material.opacity = t;
      // Fade out emissive
      m.material.emissiveIntensity = 0.6 * t;
      // Fade out glow ring
      const ring = m.getObjectByName("glow");
      if (ring) {
        ring.material.opacity = t * 0.5;
        ring.scale.setScalar(1 + (1 - t) * 2); // ring expands as it fades
      }
      // Animation done
      if (m.userData.disappearTimer <= 0) {
        m.visible = false;
        m.userData.disappearing = false;
      }
      return;
    }

    // Normal floating animation (only when not collected)
    const fData = FRAGMENT_POSITIONS.find(
      (f) => f.id === m.userData.fragmentId,
    );
    if (fData && !fData.collected) {
      m.position.y = fData.pos.y + Math.sin(time * 2 + fData.id) * 0.2;
      m.rotation.y += delta * 1.5;
      // Glow ring animation
      const ring = m.getObjectByName("glow");
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
      totalCollectedEver++;
      // Start disappear animation instead of hiding immediately
      const mesh = fragmentMeshes.find((m) => m.userData.fragmentId === f.id);
      if (mesh) {
        mesh.userData.disappearing = true;
        mesh.userData.disappearTimer = DISAPPEAR_DURATION;
      }
      if (onCollectCallback) onCollectCallback(f.id, collectedCount);
      return f.id;
    }
  }
  return -1;
}

export function onFragmentCollected(cb) {
  onCollectCallback = cb;
}
export function getCollectedCount() {
  return collectedCount;
}
// 游戏过程中总共收集到的数量（只增不减，用于结束画面）
export function getTotalCollectedEver() {
  return totalCollectedEver;
}
export function getTotalFragments() {
  return FRAGMENT_POSITIONS.length;
}
export function getAllCollected() {
  return collectedCount >= FRAGMENT_POSITIONS.length;
}
export function hasFragments() {
  return collectedCount > 0;
}
export function consumeFragment() {
  if (collectedCount > 0) {
    collectedCount--;
    return true;
  }
  return false;
}
export function resetFragments() {
  FRAGMENT_POSITIONS.forEach((f) => (f.collected = false));
  collectedCount = 0;
  totalCollectedEver = 0;
  fragmentMeshes.forEach((m) => {
    m.visible = true;
    m.scale.setScalar(1);
    m.material.opacity = 1.0;
    m.material.emissiveIntensity = 0.6;
    m.userData.disappearing = false;
    m.userData.disappearTimer = 0;
    const ring = m.getObjectByName("glow");
    if (ring) {
      ring.material.opacity = 0.5;
      ring.scale.setScalar(1);
    }
  });
}
