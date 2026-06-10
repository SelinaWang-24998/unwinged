import * as THREE from './lib/three.module.js';
import { getScene, getTileSize, getGridSize } from "./scene.js";
import { getPlayerPosition } from "./player.js";
import { getTerrainHeight, isLand, getCoverHeight, getBlockAt, getBlocks, protectBlock, unprotectBlock } from "./island.js";
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
    // Skip cells with foliage cover (trees/bushes) — avoid "hidden by tree" problem
    if (getCoverHeight(c.gx, c.gz) > 0.5) continue;
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
        if (h >= 0.5 && h <= 1.8) buildableLand.push({ gx, gz });
      } else if (isInShallowWater(gx, gz, isLand)) {
        shallowWater.push({ gx, gz });
      }
    }
  }
  console.log("[Fragment] Terrain cells — land:", land.length,
    "highLand(h≥1.2):", highLand.length,
    "buildable(0.5≤h≤1.8):", buildableLand.length,
    "shallowWater:", shallowWater.length);

  // Helper: count land neighbors (for safe placement, avoid edges)
  function countLandNeighbors(gx, gz) {
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (isLand(gx + dx, gz + dz)) count++;
      }
    }
    return count;
  }
  // Safe cells: at least 6 of 8 neighbors are land (not on peninsula tip / edge)
  const safeBuildableLand = buildableLand.filter(c => countLandNeighbors(c.gx, c.gz) >= 6);
  const safeLand = land.filter(c => countLandNeighbors(c.gx, c.gz) >= 6);
  console.log("[Fragment] Safe cells — safeBuildable:", safeBuildableLand.length, "safeLand:", safeLand.length);

  // Fragment 0: highland (visible)
  const f0 = FRAGMENT_POSITIONS.find((f) => f.id === 0);
  if (f0) {
    const cell = pickRandomGridCell(highLand.length ? highLand : land, used);
    if (cell) {
      const y = getTerrainHeight(cell.gx, cell.gz) + 0.4;
      f0.pos.set(cell.gx * TILE, Math.max(y, 1.0), cell.gz * TILE);
      console.log("[Fragment] F0 highland at grid", cell.gx, cell.gz, "terrainH:", getTerrainHeight(cell.gx, cell.gz).toFixed(2));
    } else {
      console.warn("[Fragment] No highland cell found for fragment 0, staying at default");
    }
  }

  // Fragment 1: shallow water (visible)
  const f1 = FRAGMENT_POSITIONS.find((f) => f.id === 1);
  if (f1) {
    const cell = pickRandomGridCell(shallowWater, used);
    if (cell) {
      // Place fragment well above water surface (water is at Y≈-0.15)
      f1.pos.set(cell.gx * TILE, 0.8, cell.gz * TILE);
      console.log("[Fragment] F1 shallow water at grid", cell.gx, cell.gz);
    } else {
      console.warn("[Fragment] No shallow water cell found for fragment 1, staying at default");
    }
  }

  // Fragment 2: high altitude — needs building (visible)
  const f2 = FRAGMENT_POSITIONS.find((f) => f.id === 2);
  if (f2) {
    const cell = pickRandomGridCell(
      buildableLand.length ? buildableLand : land,
      used,
    );
    if (cell) {
      f2.pos.set(cell.gx * TILE, 3.8, cell.gz * TILE);
      console.log("[Fragment] F2 high altitude at grid", cell.gx, cell.gz);
    } else {
      console.warn("[Fragment] No buildable land cell found for fragment 2, staying at default");
    }
  }

  // Fragment 3 & 4: hidden underground — buried 1-2 layers under high terrain (h > 3)
  // The block above the fragment is protected (cannot be grabbed).
  // Player must use terrain deformation to change height enough to reveal.
  const HIDDEN_MIN_DIST = 4;
  const HIDDEN_MIN_HEIGHT = 3; // minimum initial block layers for hidden fragment placement
  const f3 = FRAGMENT_POSITIONS.find((f) => f.id === 3);
  const f4 = FRAGMENT_POSITIONS.find((f) => f.id === 4);

  // Build hidden pool: safe land cells where terrain has enough height
  const tallTerrainCells = safeBuildableLand.filter(c => {
    const blockList = getBlockAt(c.gx, c.gz);
    return blockList.length > HIDDEN_MIN_HEIGHT;
  });
  const hiddenBase = tallTerrainCells.length > 2 ? tallTerrainCells :
                (safeBuildableLand.length ? safeBuildableLand :
                 (safeLand.length ? safeLand :
                  (buildableLand.length ? buildableLand : land)));

  function placeHiddenFragment(f, candidates, usedKeys) {
    const cell = pickRandomGridCell(candidates, usedKeys);
    if (!cell) return false;
    const blockList = getBlockAt(cell.gx, cell.gz);
    const blockCount = blockList.length;
    // Bury fragment at layer 2 or 3 from the top (random)
    const depth = Math.random() < 0.5 ? 2 : 3;
    const actualLayer = Math.max(0, blockCount - depth);
    const fragY = actualLayer * 0.6 + 0.4;
    // Record the original surface height (top of highest block) for reveal check
    const surfaceY = (blockCount - 1) * 0.6 + 0.3;
    f.pos.set(cell.gx * TILE, fragY, cell.gz * TILE);
    f.originalHeight = surfaceY;
    console.log("[Fragment]", f.id, "hidden at grid", cell.gx, cell.gz,
      "blocks:", blockCount, "depth:", depth, "layer:", actualLayer,
      "fragY:", fragY.toFixed(2), "surfaceY:", surfaceY.toFixed(2));
    return true;
  }

  if (f3) {
    if (!placeHiddenFragment(f3, hiddenBase, used)) {
      console.warn("[Fragment] Could not find safe cell for hidden fragment 3");
    }
  }
  if (f4) {
    // Find F3 position and enforce minimum distance
    const f3gx = Math.round(f3.pos.x / TILE);
    const f3gz = Math.round(f3.pos.z / TILE);
    const farCandidates = hiddenBase.filter(c => {
      const dx = c.gx - f3gx;
      const dz = c.gz - f3gz;
      return Math.sqrt(dx * dx + dz * dz) >= HIDDEN_MIN_DIST;
    });
    const pool4 = farCandidates.length ? farCandidates : hiddenBase;
    if (!placeHiddenFragment(f4, pool4, used)) {
      console.warn("[Fragment] Could not find safe cell for hidden fragment 4");
    } else {
      const f4gx = Math.round(f4.pos.x / TILE);
      const f4gz = Math.round(f4.pos.z / TILE);
      const dist = Math.sqrt((f4gx - f3gx) ** 2 + (f4gz - f3gz) ** 2);
      console.log("[Fragment] F4 distFromF3:", dist.toFixed(1));
    }
  }
}

// 5 fragments: 3 visible + 2 hidden underground
const FRAGMENT_POSITIONS = [
  {
    pos: new THREE.Vector3(-3 * TILE, 2.2, -3 * TILE),
    collected: false,
    id: 0,
  }, // Island highland — always visible
  { pos: new THREE.Vector3(5 * TILE, 0.4, 3 * TILE), collected: false, id: 1 }, // Shallow water — always visible
  { pos: new THREE.Vector3(3 * TILE, 3.8, 1 * TILE), collected: false, id: 2 }, // High altitude — needs building
  {
    pos: new THREE.Vector3(-1 * TILE, 0.4, -4 * TILE),
    collected: false,
    id: 3,
    hidden: true,
    visible: false,
    revealThreshold: 0.3,
    originalHeight: 0,
  },
  {
    pos: new THREE.Vector3(4 * TILE, 0.4, -2 * TILE),
    collected: false,
    id: 4,
    hidden: true,
    visible: false,
    revealThreshold: 0.3,
    originalHeight: 0,
  },
];

let fragmentMeshes = [];
let collectedCount = 0;
let totalCollectedEver = 0;
let onCollectCallback = null;
const DISAPPEAR_DURATION = 0.35;

// ============================================================
// Hidden Fragment Signal System
// Dormant until all 3 visible fragments are collected.
// Once activated: golden light beams, ground glow, terrain pulse,
// floating particles — impossible to miss.
// ============================================================

let hiddenSignalsActive = false;
const hiddenSignalState = new Map();
const hiddenParticles = [];
const hiddenParticleGeo = new THREE.SphereGeometry(0.05, 4, 4);
const PARTICLE_SPAWN_INTERVAL = 0.12;

function setupHiddenSignals() {
  cleanupHiddenSignals();

  const scene = getScene();

  FRAGMENT_POSITIONS.forEach((f) => {
    if (!f.hidden) return;

    const gx = Math.round(f.pos.x / TILE);
    const gz = Math.round(f.pos.z / TILE);

    // Find terrain blocks (expand search if exact position has none)
    let blockList = getBlockAt(gx, gz);
    if (blockList.length === 0) {
      for (let dx = -2; dx <= 2 && blockList.length === 0; dx++) {
        for (let dz = -2; dz <= 2 && blockList.length === 0; dz++) {
          if (dx === 0 && dz === 0) continue;
          blockList = getBlockAt(gx + dx, gz + dz);
        }
      }
    }

    // Record terrain height at creation for reveal check (only if not already set)
    if (f.originalHeight <= 0) {
      f.originalHeight = getTerrainHeight(gx, gz);
      if (f.originalHeight <= 0 && isLand(gx, gz)) {
        const direct = blockList.reduce((max, b) => Math.max(max, b.baseY + 0.3), 0);
        if (direct > 0) f.originalHeight = direct;
      }
    }
    console.log("[Fragment] Hidden", f.id, "at grid", gx, gz,
      "pos", f.pos.x.toFixed(1), f.pos.z.toFixed(1),
      "originalHeight:", f.originalHeight.toFixed(3),
      "blocks:", blockList.length);

    // Protect the block above the fragment from being grabbed
    protectBlock(gx, gz);

    // Create ground glow circle (invisible until activated)
    const circleGeo = new THREE.RingGeometry(0.3, 0.6, 32);
    const circleMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    const circle = new THREE.Mesh(circleGeo, circleMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(f.pos.x, f.originalHeight + 0.35, f.pos.z);
    circle.renderOrder = 999;
    circle.name = `hidden-signal-${f.id}`;
    circle.visible = false; // Dormant
    scene.add(circle);

    hiddenSignalState.set(f.id, {
      blocks: blockList,
      signalCircle: circle,
      lightBeam: null,
      phase: Math.random() * Math.PI * 2,
      lastParticleTime: 0,
    });
  });
}

// Called when all 3 visible fragments are collected
export function activateHiddenSignals() {
  if (hiddenSignalsActive) return;
  hiddenSignalsActive = true;
  console.log("[Fragment] Hidden signals ACTIVATED!");

  hiddenSignalState.forEach((state, fragId) => {
    const f = FRAGMENT_POSITIONS.find(fp => fp.id === fragId);
    if (!f || f.collected || f.visible) return;

    // Make ground circle visible
    state.signalCircle.visible = true;
  });
}

function updateHiddenSignals(delta) {
  const time = performance.now() * 0.001;

  if (!hiddenSignalsActive) {
    // Everything dormant — ensure nothing visible
    hiddenSignalState.forEach((state) => {
      state.signalCircle.visible = false;
      if (state.blocks.length > 0) {
        state.blocks.forEach(b => {
          if (b.mesh.material.emissive) {
            b.mesh.material.emissive.setHex(0x000000);
            b.mesh.material.emissiveIntensity = 0;
          }
          b.mesh.position.y = b.baseY;
        });
      }
    });
    updateHiddenParticles(delta);
    return;
  }

  // Active — dramatic effects for each unrevealed hidden fragment
  hiddenSignalState.forEach((state, fragId) => {
    const f = FRAGMENT_POSITIONS.find(fp => fp.id === fragId);

    // If already revealed or collected, turn off signals
    if (!f || f.collected || f.visible) {
      state.signalCircle.visible = false;
      if (state.blocks.length > 0) {
        state.blocks.forEach(b => {
          if (b.mesh.material.emissive) {
            b.mesh.material.emissive.setHex(0x000000);
            b.mesh.material.emissiveIntensity = 0;
          }
          b.mesh.position.y = b.baseY;
        });
      }
      return;
    }

    const gx = Math.round(f.pos.x / TILE);
    const gz = Math.round(f.pos.z / TILE);
    const terrainY = getTerrainHeight(gx, gz);
    const pulse = Math.sin(time * 3 + state.phase) * 0.5 + 0.5;
    const fastPulse = Math.sin(time * 6 + state.phase + 1.0) * 0.5 + 0.5;

    // Ground glow circle — always visible and pulsing
    state.signalCircle.visible = true;
    state.signalCircle.material.opacity = 0.5 + pulse * 0.35;
    state.signalCircle.position.y = terrainY + 0.35;
    const breathe = 1.0 + Math.sin(time * 2.5 + state.phase) * 0.2;
    state.signalCircle.scale.set(breathe, breathe, 1);

    // Terrain blocks vibrate (no color change)
    if (state.blocks.length > 0) {
      state.blocks.forEach(b => {
        const v = Math.sin(time * 5 + state.phase + fragId * 1.7) * 0.02;
        b.mesh.position.y = b.baseY + v;
      });
    }

    // Spawn floating golden particles
    if (time - state.lastParticleTime > PARTICLE_SPAWN_INTERVAL) {
      state.lastParticleTime = time;
      spawnHiddenParticle(f.pos.x, terrainY + 0.5, f.pos.z);
    }
  });

  updateHiddenParticles(delta);
}

function spawnHiddenParticle(x, y, z) {
  const scene = getScene();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffdd00,
    transparent: true,
    opacity: 0.8,
  });
  const mesh = new THREE.Mesh(hiddenParticleGeo, mat);
  const angle = Math.random() * Math.PI * 2;
  const r = 0.15 + Math.random() * 0.3;
  mesh.position.set(
    x + Math.cos(angle) * r,
    y + Math.random() * 0.3,
    z + Math.sin(angle) * r
  );
  mesh.userData = {
    life: 1.5 + Math.random() * 0.5,
    maxLife: 2.0,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.4,
      0.8 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.4
    ),
  };
  mesh.renderOrder = 997;
  scene.add(mesh);
  hiddenParticles.push(mesh);
}

function updateHiddenParticles(delta) {
  const scene = getScene();
  for (let i = hiddenParticles.length - 1; i >= 0; i--) {
    const p = hiddenParticles[i];
    p.userData.life -= delta;
    if (p.userData.life <= 0) {
      scene.remove(p);
      p.material.dispose();
      hiddenParticles.splice(i, 1);
      continue;
    }
    const ratio = p.userData.life / p.userData.maxLife;
    p.position.addScaledVector(p.userData.velocity, delta);
    p.userData.velocity.y *= 0.97;
    p.material.opacity = Math.min(1, ratio) * 0.7;
    p.scale.setScalar(Math.max(0.1, ratio));
  }
}

function cleanupHiddenSignals() {
  const scene = getScene();

  // Clean up all floating particles
  hiddenParticles.forEach(p => {
    scene.remove(p);
    p.material.dispose();
  });
  hiddenParticles.length = 0;

  hiddenSignalState.forEach((state, fragId) => {
    // Unprotect the block
    const f = FRAGMENT_POSITIONS.find(fp => fp.id === fragId);
    if (f) {
      const gx = Math.round(f.pos.x / TILE);
      const gz = Math.round(f.pos.z / TILE);
      unprotectBlock(gx, gz);
    }

    // Reset terrain blocks
    if (state.blocks.length > 0) {
      state.blocks.forEach(b => {
        if (b.mesh.material.emissive) {
          b.mesh.material.emissive.setHex(0x000000);
          b.mesh.material.emissiveIntensity = 0;
        }
        b.mesh.position.y = b.baseY;
      });
    }
    // Remove signal circle
    if (state.signalCircle.parent) {
      state.signalCircle.parent.remove(state.signalCircle);
    }
    state.signalCircle.geometry.dispose();
    state.signalCircle.material.dispose();
    // Remove light beam
    if (state.lightBeam) {
      if (state.lightBeam.parent) {
        state.lightBeam.parent.remove(state.lightBeam);
      }
      state.lightBeam.geometry.dispose();
      state.lightBeam.material.dispose();
    }
  });

  hiddenSignalState.clear();
  hiddenSignalsActive = false;
}

// Export cleanup for use in main.js cleanupScene
export { cleanupHiddenSignals };

// ============================================================
// Fragment Creation & Management
// ============================================================

export function createFragments() {
  const scene = getScene();
  const existing = scene.getObjectByName("fragments");
  if (existing) scene.remove(existing);

  fragmentMeshes = [];
  FRAGMENT_POSITIONS.forEach((f) => {
    f.collected = false;
    if (f.hidden) {
      f.visible = false;
      f.originalHeight = 0;
    }
  });
  collectedCount = 0;

  randomizeFragmentPositions();

  const group = new THREE.Group();
  group.name = "fragments";

  FRAGMENT_POSITIONS.forEach((f) => {
    const geo = new THREE.OctahedronGeometry(0.3, 0);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffdd44,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
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

    // Glow ring (torus) — only for visible fragments
    if (!f.hidden) {
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
    }

    // Hidden fragments: mesh invisible, set up terrain signals
    if (f.hidden) {
      mesh.visible = false;
      f.visible = false;
    }

    group.add(mesh);
    fragmentMeshes.push(mesh);
  });

  scene.add(group);

  // Set up hidden fragment terrain signals (A+C approach)
  setupHiddenSignals();

  // Post-creation verification: ensure exactly 3 visible fragment meshes
  const visibleCount = fragmentMeshes.filter(m => m.visible).length;
  const hiddenCount = fragmentMeshes.filter(m => !m.visible).length;
  console.log("[Fragment] Created:", fragmentMeshes.length, "total |",
    visibleCount, "visible |", hiddenCount, "hidden |",
    "signals:", hiddenSignalState.size);

  // Log all visible fragment positions for debugging
  FRAGMENT_POSITIONS.forEach((f) => {
    if (!f.hidden) {
      const onLand = isLand(Math.round(f.pos.x / TILE), Math.round(f.pos.z / TILE));
      const inWater = isInShallowWater(Math.round(f.pos.x / TILE), Math.round(f.pos.z / TILE), isLand);
      console.log("[Fragment] Visible", f.id, "pos=(",
        f.pos.x.toFixed(1), f.pos.y.toFixed(1), f.pos.z.toFixed(1), ")",
        "land:", onLand, "shallow:", inWater);
    }
  });

  if (visibleCount !== 3) {
    console.error("[Fragment] BUG: Expected 3 visible, got", visibleCount,
      "Force-fixing hidden fragments...");
    FRAGMENT_POSITIONS.forEach((f) => {
      if (f.hidden) {
        f.visible = false;
        const mesh = fragmentMeshes.find((m) => m.userData.fragmentId === f.id);
        if (mesh) mesh.visible = false;
      }
    });
  }

  return group;
}

export function checkFragmentCollection() {
  const playerPos = getPlayerPosition();
  for (const f of FRAGMENT_POSITIONS) {
    if (f.collected) continue;
    // Hidden fragments can only be collected once revealed
    // Double-check both data flag AND mesh visibility for safety
    if (f.hidden && !f.visible) continue;
    if (f.hidden) {
      const mesh = fragmentMeshes.find((m) => m.userData.fragmentId === f.id);
      if (!mesh || !mesh.visible) continue;
    }
    const dist = playerPos.distanceTo(f.pos);
    if (dist < 1.0) {
      f.collected = true;
      collectedCount++;
      totalCollectedEver++;
      // Start disappear animation
      const mesh = fragmentMeshes.find((m) => m.userData.fragmentId === f.id);
      if (mesh) {
        mesh.userData.disappearing = true;
        mesh.userData.disappearTimer = DISAPPEAR_DURATION;
      }
      // Clean up hidden signal for this fragment
      const signalState = hiddenSignalState.get(f.id);
      if (signalState) {
        if (signalState.blocks.length > 0) {
          signalState.blocks.forEach((b) => {
            if (b.mesh.material.emissive) {
              b.mesh.material.emissive.setHex(0x000000);
              b.mesh.material.emissiveIntensity = 0;
            }
            b.mesh.position.y = b.baseY;
          });
        }
        if (signalState.signalCircle.parent) {
          signalState.signalCircle.parent.remove(signalState.signalCircle);
        }
        signalState.signalCircle.geometry.dispose();
        signalState.signalCircle.material.dispose();
        hiddenSignalState.delete(f.id);
      }
      // Unprotect the block — fragment is collected, no need to keep it locked
      const fGx = Math.round(f.pos.x / TILE);
      const fGz = Math.round(f.pos.z / TILE);
      unprotectBlock(fGx, fGz);
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
  FRAGMENT_POSITIONS.forEach((f) => {
    f.collected = false;
    if (f.hidden) {
      f.visible = false;
      f.originalHeight = 0;
    }
  });
  collectedCount = 0;
  totalCollectedEver = 0;
  fragmentMeshes.forEach((m) => {
    const fData = FRAGMENT_POSITIONS.find((f) => f.id === m.userData.fragmentId);
    if (fData && fData.hidden) {
      m.visible = false;
      return;
    }
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

// ============================================================
// Hidden Fragment Reveal Check
// ============================================================

function checkHiddenFragmentReveal() {
  // Only check reveals after signals are activated (all visible collected)
  if (!hiddenSignalsActive) return;

  FRAGMENT_POSITIONS.forEach((f) => {
    if (!f.hidden || f.visible || f.collected) return;

    // Safety: originalHeight must be properly set before any reveal check
    if (f.originalHeight <= 0.01) {
      console.warn("[Fragment] Hidden", f.id, "originalHeight not set, skipping reveal check");
      return;
    }

    const gx = Math.round(f.pos.x / TILE);
    const gz = Math.round(f.pos.z / TILE);
    const currentHeight = getTerrainHeight(gx, gz);
    const heightDiff = currentHeight - f.originalHeight;

    // Reveal when terrain is altered (raised OR lowered) by threshold amount
    if (Math.abs(heightDiff) >= f.revealThreshold) {
      console.log("[Fragment] Hidden fragment", f.id, "revealed! heightDiff:", heightDiff.toFixed(2));
      f.visible = true;
      f.pos.y = currentHeight + 0.25;

      // Show the fragment mesh
      const mesh = fragmentMeshes.find((m) => m.userData.fragmentId === f.id);
      if (mesh) {
        mesh.visible = true;
        mesh.position.copy(f.pos);
        // Add glow ring now that it's revealed
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
      }

      // Remove terrain signal
      const sigState = hiddenSignalState.get(f.id);
      if (sigState) {
        if (sigState.blocks.length > 0) {
          sigState.blocks.forEach((b) => {
            if (b.mesh.material.emissive) {
              b.mesh.material.emissive.setHex(0x000000);
              b.mesh.material.emissiveIntensity = 0;
            }
            b.mesh.position.y = b.baseY;
          });
        }
        if (sigState.signalCircle.parent) {
          sigState.signalCircle.parent.remove(sigState.signalCircle);
        }
        sigState.signalCircle.geometry.dispose();
        sigState.signalCircle.material.dispose();
        hiddenSignalState.delete(f.id);
      }
      // Fragment is now visible — unprotect so player can interact normally
      const rGx = Math.round(f.pos.x / TILE);
      const rGz = Math.round(f.pos.z / TILE);
      unprotectBlock(rGx, rGz);

      console.log("[Fragment] Hidden fragment", f.id, "revealed!");
    }
  });
}

// ============================================================
// Main Update Loop
// ============================================================

export function updateFragments(delta) {
  const time = performance.now() * 0.001;

  // Update hidden fragment terrain signals (A+C approach)
  updateHiddenSignals(delta);

  // Check if terrain raised enough to reveal hidden fragments
  checkHiddenFragmentReveal();

  // Update visible fragment animations
  fragmentMeshes.forEach((m) => {
    if (!m.visible) return;

    // Handle disappearing animation
    if (m.userData.disappearing) {
      m.userData.disappearTimer -= delta;
      const t = Math.max(0, m.userData.disappearTimer / DISAPPEAR_DURATION);
      m.scale.setScalar(t);
      m.material.opacity = t;
      m.material.emissiveIntensity = 0.6 * t;
      const ring = m.getObjectByName("glow");
      if (ring) {
        ring.material.opacity = t * 0.5;
        ring.scale.setScalar(1 + (1 - t) * 2);
      }
      if (m.userData.disappearTimer <= 0) {
        m.visible = false;
        m.userData.disappearing = false;
      }
      return;
    }

    // Normal floating animation
    const fData = FRAGMENT_POSITIONS.find(
      (f) => f.id === m.userData.fragmentId,
    );
    if (fData && !fData.collected) {
      m.position.y = fData.pos.y + Math.sin(time * 2 + fData.id) * 0.2;
      m.rotation.y += delta * 1.5;
      const ring = m.getObjectByName("glow");
      if (ring) {
        ring.scale.setScalar(1 + Math.sin(time * 3) * 0.15);
        ring.material.opacity = 0.3 + Math.sin(time * 3) * 0.2;
      }
    }
  });
}
