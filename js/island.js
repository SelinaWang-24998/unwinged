import * as THREE from 'three';
import { getScene } from './scene.js';

const TILE = 1;
const blocks = []; // all island blocks { mesh, gridX, gridZ, baseY }

const LAND_RADIUS = 14;
const foliageCover = new Map();
let foliageGroup = null;

// Colors for island blocks
const grassColors = [0x7ec850, 0x6db840, 0x8ed860, 0x5ea838, 0x9ee870];
const dirtColors = [0xc4a45a, 0xb8944a, 0xd4b46a];
const cliffColors = [0x9e8e6e, 0xae9e7e, 0x8e7e5e];

function hash2D(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function createIsland() {
  const scene = getScene();
  if (foliageGroup) {
    scene.remove(foliageGroup);
    foliageGroup = null;
  }
  const group = new THREE.Group();
  group.name = 'island';

  blocks.length = 0;
  foliageCover.clear();

  const rMax = Math.ceil(LAND_RADIUS + 1);
  for (let gx = -rMax; gx <= rMax; gx++) {
    for (let gz = -rMax; gz <= rMax; gz++) {
      const dist = Math.sqrt(gx * gx + gz * gz);
      const edge = LAND_RADIUS - 0.35 - hash2D(gx, gz) * 0.65;
      if (dist > edge) continue;

      const t = Math.max(0, (LAND_RADIUS - dist) / LAND_RADIUS);
      const n = (hash2D(gx * 2.1, gz * 2.1) - 0.5) * 0.9 + (hash2D(gx * 0.9, gz * 0.9) - 0.5) * 0.6;
      const raw = 1 + t * 5.4 + n * 1.15;
      const h = Math.max(1, Math.min(6, Math.floor(raw)));

      for (let y = 0; y < h; y++) {
        const color = y === 0
          ? dirtColors[Math.floor(hash2D(gx + 10, gz + 20) * dirtColors.length)]
          : y === h - 1
            ? grassColors[Math.floor(hash2D(gx + 30, gz + 40) * grassColors.length)]
            : cliffColors[Math.floor(hash2D(gx + 50, gz + 60) * cliffColors.length)];

        const mat = new THREE.MeshToonMaterial({ color });
        const geo = new THREE.BoxGeometry(TILE * 0.95, TILE * 0.6, TILE * 0.95);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(gx * TILE, y * 0.6, gz * TILE);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        blocks.push({ mesh, gridX: gx, gridZ: gz, baseY: y * 0.6, height: h });
      }
    }
  }

  scene.add(group);
  createFoliage(scene);
  return group;
}

function createFoliage(scene) {
  const group = new THREE.Group();
  group.name = 'foliage';

  const trunkMat = new THREE.MeshToonMaterial({ color: 0x8b6a3e });
  const leafMatA = new THREE.MeshToonMaterial({ color: 0x4ea84a });
  const leafMatB = new THREE.MeshToonMaterial({ color: 0x6db840 });
  const grassMat = new THREE.MeshToonMaterial({ color: 0x78c85a });

  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.14, 0.95, 6);
  const leafGeo = new THREE.DodecahedronGeometry(0.45, 0);
  const bushGeo = new THREE.DodecahedronGeometry(0.22, 0);
  const grassGeo = new THREE.ConeGeometry(0.08, 0.22, 5, 1);

  const heroCandidates = [];
  const rMax = Math.ceil(LAND_RADIUS - 1);
  for (let gx = -rMax; gx <= rMax; gx++) {
    for (let gz = -rMax; gz <= rMax; gz++) {
      if (!isLand(gx, gz)) continue;
      const d = Math.sqrt(gx * gx + gz * gz);
      if (d > LAND_RADIUS - 1.2) continue;
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue;
      if (Math.abs(gx - 3) <= 1 && Math.abs(gz - 3) <= 1) continue;

      const h = getTerrainHeight(gx, gz);
      const y = h;
      const r = hash2D(gx + 100, gz + 200);
      const r2 = hash2D(gx + 300, gz + 400);
      const isBeach = d > LAND_RADIUS - 3.2;
      const isInner = d < LAND_RADIUS - 5.0;
      if (!isBeach && isInner && h >= 1.1) {
        heroCandidates.push({ gx, gz, y, k: hash2D(gx + 900, gz + 1200) });
      }

      if (!isBeach && r < 0.045) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.48;
        tree.add(trunk);

        const leaf = new THREE.Mesh(leafGeo, r2 < 0.5 ? leafMatA : leafMatB);
        leaf.position.y = 1.06;
        leaf.scale.setScalar(1.15 + r2 * 0.55);
        leaf.rotation.set(r2 * 0.6, r2 * 2.0, r2 * 0.6);
        tree.add(leaf);

        tree.position.set(gx * TILE, y + 0.02, gz * TILE);
        tree.rotation.y = r2 * Math.PI * 2;
        group.add(tree);

        foliageCover.set(`${gx},${gz}`, Math.max(foliageCover.get(`${gx},${gz}`) || 0, y + 1.65));
      } else if (!isBeach && r < 0.11) {
        const bush = new THREE.Mesh(bushGeo, r2 < 0.5 ? leafMatA : leafMatB);
        bush.position.set(gx * TILE, y + 0.16, gz * TILE);
        bush.scale.setScalar(0.85 + r2 * 0.35);
        bush.rotation.set(0, r2 * Math.PI * 2, 0);
        group.add(bush);
        foliageCover.set(`${gx},${gz}`, Math.max(foliageCover.get(`${gx},${gz}`) || 0, y + 0.75));
      } else if (r < 0.22) {
        const bladeCount = 1 + Math.floor(r2 * 3);
        for (let i = 0; i < bladeCount; i++) {
          const g = new THREE.Mesh(grassGeo, grassMat);
          const jx = (hash2D(gx * 5 + i, gz * 7 + i) - 0.5) * 0.45;
          const jz = (hash2D(gx * 9 + i, gz * 3 + i) - 0.5) * 0.45;
          const s = 0.6 + hash2D(gx * 11 + i, gz * 13 + i) * 0.8;
          g.position.set(gx * TILE + jx, y + 0.11, gz * TILE + jz);
          g.scale.setScalar(s);
          g.rotation.y = hash2D(gx * 17 + i, gz * 19 + i) * Math.PI * 2;
          group.add(g);
        }
      }
    }
  }

  heroCandidates.sort((a, b) => a.k - b.k);
  const heroCount = Math.min(4, heroCandidates.length);
  for (let i = 0; i < heroCount; i++) {
    const c = heroCandidates[i];
    const r2 = hash2D(c.gx + 1500, c.gz + 1600);
    const heroScale = 1.7 + r2 * 0.45;

    const hero = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.55 * heroScale;
    trunk.scale.setScalar(heroScale);
    hero.add(trunk);

    const leaf = new THREE.Mesh(leafGeo, r2 < 0.5 ? leafMatA : leafMatB);
    leaf.position.y = 1.25 * heroScale;
    leaf.scale.setScalar(heroScale * (1.25 + r2 * 0.25));
    leaf.rotation.set(r2 * 0.6, r2 * 2.0, r2 * 0.6);
    hero.add(leaf);

    hero.position.set(c.gx * TILE, c.y + 0.02, c.gz * TILE);
    hero.rotation.y = r2 * Math.PI * 2;
    group.add(hero);
    foliageCover.set(`${c.gx},${c.gz}`, Math.max(foliageCover.get(`${c.gx},${c.gz}`) || 0, c.y + 2.35 * heroScale));
  }

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  foliageGroup = group;
  scene.add(group);
}

export function getCoverHeight(gx, gz) {
  return foliageCover.get(`${Math.round(gx)},${Math.round(gz)}`) || 0;
}

export function getBlocks() { return blocks; }

// Get the terrain height at a grid position
export function getTerrainHeight(gx, gz) {
  let maxY = 0;
  for (const b of blocks) {
    if (b.gridX === Math.round(gx) && b.gridZ === Math.round(gz)) {
      maxY = Math.max(maxY, b.baseY + 0.3);
    }
  }
  return maxY;
}

// Check if a grid position is land
export function isLand(gx, gz) {
  return blocks.some(b => b.gridX === Math.round(gx) && b.gridZ === Math.round(gz));
}

// Get block at position (for terrain modification)
export function getBlockAt(gx, gz) {
  return blocks.filter(b => b.gridX === Math.round(gx) && b.gridZ === Math.round(gz));
}

// Modify terrain height at position
export function modifyTerrainHeight(gx, gz, deltaY) {
  const blockList = getBlockAt(gx, gz);
  blockList.forEach(b => {
    b.mesh.position.y = Math.max(-1, b.mesh.position.y + deltaY);
  });
}

// === Block Stacking / Building System ===
const STACKABLE_HEIGHT = 6; // Max stack height

// Place a new block on top of existing terrain
export function placeBlock(gx, gz) {
  const scene = getScene();
  const island = scene.getObjectByName('island');
  if (!island) return false;
  
  const blockList = getBlockAt(gx, gz);
  
  // Find the highest existing block
  let highestY = 0;
  blockList.forEach(b => {
    highestY = Math.max(highestY, b.mesh.position.y + 0.3);
  });
  
  // Don't stack too high
  if (highestY > STACKABLE_HEIGHT * 0.6) return false;
  
  // Create new block
  const newY = highestY + 0.3;
  const color = 0x8ed860; // grass color
  const mat = new THREE.MeshToonMaterial({ color });
  const geo = new THREE.BoxGeometry(TILE * 0.95, TILE * 0.6, TILE * 0.95);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(gx * TILE, newY, gz * TILE);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  island.add(mesh);
  
  blocks.push({ mesh, gridX: gx, gridZ: gz, baseY: newY, height: 1 });
  
  return true;
}

// Remove top block at position
export function removeBlock(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  if (blockList.length === 0) return false;
  
  // Find highest block
  let highest = blockList[0];
  blockList.forEach(b => {
    if (b.mesh.position.y > highest.mesh.position.y) {
      highest = b;
    }
  });
  
  // Remove from scene and array
  const scene = getScene();
  const island = scene.getObjectByName('island');
  if (island) {
    island.remove(highest.mesh);
  }
  
  const idx = blocks.indexOf(highest);
  if (idx !== -1) {
    blocks.splice(idx, 1);
  }
  
  // Clean up geometry/material
  highest.mesh.geometry.dispose();
  highest.mesh.material.dispose();
  
  return true;
}

// Check if player can place a block at position
export function canPlaceBlock(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  let highestY = 0;
  blockList.forEach(b => {
    highestY = Math.max(highestY, b.mesh.position.y + 0.3);
  });
  return highestY <= STACKABLE_HEIGHT * 0.6;
}

// Check if player can remove a block at position
export function canRemoveBlock(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  return blockList.length > 0;
}
