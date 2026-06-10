import * as THREE from './lib/three.module.js';
import { getScene } from './scene.js';

const TILE = 1;
const blocks = []; // all island blocks { mesh, gridX, gridZ, baseY }

const LAND_RADIUS = 17;
const foliageCover = new Map();
let foliageGroup = null;

// Colors for island blocks
const grassColors = [0x7ec850, 0x6db840, 0x8ed860, 0x5ea838, 0x9ee870];
const sandColors = [0xe8d5a3, 0xf0ddb0, 0xdcc890, 0xebd59e];
const dirtColors = [0xc4a45a, 0xb8944a, 0xd4b46a];
const cliffColors = [0x9e8e6e, 0xae9e7e, 0x8e7e5e];

let gameSeed = 0;

function hash2D(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7 + gameSeed) * 43758.5453123;
  return s - Math.floor(s);
}

export function newGameSeed() {
  gameSeed = Math.random() * 9999;
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

  const rMax = Math.ceil(LAND_RADIUS + 5);
  for (let gx = -rMax; gx <= rMax; gx++) {
    for (let gz = -rMax; gz <= rMax; gz++) {
      const dist = Math.sqrt(gx * gx + gz * gz);

      // Multi-octave edge noise — irregular coastline with peninsulas/bays
      const edgeNoise =
        hash2D(gx * 0.4, gz * 0.4) * 3.5 +
        hash2D(gx * 1.1, gz * 1.1) * 2.5 +
        hash2D(gx * 2.5, gz * 2.5) * 1.0;
      const edge = LAND_RADIUS - 2.0 - edgeNoise;
      if (dist > edge) continue;

      // Distance falloff — uses edge distance for more natural taper
      const t = Math.max(0, (edge - dist) / edge);

      // Multi-octave height noise — varied terrain relief
      const n =
        (hash2D(gx * 1.7, gz * 1.7) - 0.5) * 1.0 +
        (hash2D(gx * 0.7, gz * 0.7) - 0.5) * 1.2 +
        (hash2D(gx * 3.5, gz * 3.5) - 0.5) * 0.4;
      const raw = 1 + t * 5.5 + n * 1.5;
      const h = Math.max(1, Math.min(7, Math.floor(raw)));

      // Beach zone: t < 0.22 → all sand
      const isBeach = t < 0.22;
      // Grass only appears well inland (t >= 0.30), one ring inward from beach
      const isGrass = t >= 0.30;

      for (let y = 0; y < h; y++) {
        let color;
        if (isBeach) {
          color = sandColors[Math.floor(hash2D(gx + 60, gz + 70) * sandColors.length)];
        } else if (y === 0) {
          color = dirtColors[Math.floor(hash2D(gx + 10, gz + 20) * dirtColors.length)];
        } else if (y === h - 1) {
          color = isGrass
            ? grassColors[Math.floor(hash2D(gx + 30, gz + 40) * grassColors.length)]
            : sandColors[Math.floor(hash2D(gx + 60, gz + 70) * sandColors.length)];
        } else {
          color = cliffColors[Math.floor(hash2D(gx + 50, gz + 60) * cliffColors.length)];
        }

        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
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

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b6a3e, roughness: 0.9 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: 0x4ea84a, roughness: 0.85, flatShading: true });
  const leafMatB = new THREE.MeshStandardMaterial({ color: 0x6db840, roughness: 0.85, flatShading: true });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x78c85a, roughness: 0.9, flatShading: true });

  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.95, 6);
  const leafGeo = new THREE.ConeGeometry(0.45, 0.8, 6);
  const bushGeo = new THREE.DodecahedronGeometry(0.22, 0);
  const grassGeo = new THREE.ConeGeometry(0.08, 0.22, 5, 1);

  const heroCandidates = [];
  const rMax = Math.ceil(LAND_RADIUS + 5);
  for (let gx = -rMax; gx <= rMax; gx++) {
    for (let gz = -rMax; gz <= rMax; gz++) {
      if (!isLand(gx, gz)) continue;
      const d = Math.sqrt(gx * gx + gz * gz);
      if (d > LAND_RADIUS - 4.0) continue; // no foliage on beach
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue;
      if (Math.abs(gx - 3) <= 1 && Math.abs(gz - 3) <= 1) continue;

      const h = getTerrainHeight(gx, gz);
      const y = h;
      const r = hash2D(gx + 100, gz + 200);
      const r2 = hash2D(gx + 300, gz + 400);
      const isBeach = d > LAND_RADIUS - 6.0;
      const isInner = d < LAND_RADIUS - 7.0;
      if (!isBeach && isInner && h >= 1.1) {
        heroCandidates.push({ gx, gz, y, k: hash2D(gx + 900, gz + 1200) });
      }

      if (!isBeach && r < 0.045) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.48;
        tree.add(trunk);

        // Double cone stack — DuangDuang tree
        const leafMat = r2 < 0.5 ? leafMatA : leafMatB;
        const s = 1.15 + r2 * 0.55;
        const leaf1 = new THREE.Mesh(leafGeo, leafMat);
        leaf1.position.y = 0.9;
        leaf1.scale.set(s * 1.1, s * 0.85, s * 1.1);
        tree.add(leaf1);
        const leaf2 = new THREE.Mesh(leafGeo, leafMat);
        leaf2.position.y = 1.25;
        leaf2.scale.set(s * 0.7, s * 0.7, s * 0.7);
        tree.add(leaf2);

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
    trunk.scale.set(heroScale, heroScale * 1.3, heroScale);
    hero.add(trunk);

    // 3-tier cone stacking — DuangDuang Christmas tree style
    const leafMat = r2 < 0.5 ? leafMatA : leafMatB;
    const coneScaleBase = heroScale * (1.25 + r2 * 0.25);
    // Bottom cone
    const cone1 = new THREE.Mesh(leafGeo, leafMat);
    cone1.position.y = 0.95 * heroScale;
    cone1.scale.set(coneScaleBase * 1.2, coneScaleBase * 0.9, coneScaleBase * 1.2);
    hero.add(cone1);
    // Middle cone
    const cone2 = new THREE.Mesh(leafGeo, leafMat);
    cone2.position.y = 1.35 * heroScale;
    cone2.scale.set(coneScaleBase * 0.9, coneScaleBase * 0.85, coneScaleBase * 0.9);
    hero.add(cone2);
    // Top cone
    const cone3 = new THREE.Mesh(leafGeo, leafMat);
    cone3.position.y = 1.7 * heroScale;
    cone3.scale.set(coneScaleBase * 0.6, coneScaleBase * 0.7, coneScaleBase * 0.6);
    hero.add(cone3);

    hero.position.set(c.gx * TILE, c.y + 0.02, c.gz * TILE);
    hero.rotation.y = r2 * Math.PI * 2;
    // Mark hero trees as solid obstacles
    hero.userData.isSolid = true;
    hero.userData.collisionRadius = 0.6 * heroScale;
    hero.userData.collisionCenter = new THREE.Vector3(c.gx * TILE, 0, c.gz * TILE);
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
const STACKABLE_HEIGHT = 5;
const MIN_STACK_HEIGHT = 1;

// Place a new block on top of existing terrain
export function placeBlock(gx, gz) {
  const scene = getScene();
  const island = scene.getObjectByName('island');
  if (!island) return false;
  
  const blockList = getBlockAt(gx, gz);
  if (blockList.length >= STACKABLE_HEIGHT) return false;
  
  // Find the highest existing block
  let highestY = 0;
  blockList.forEach(b => {
    highestY = Math.max(highestY, b.mesh.position.y + 0.3);
  });
  
  // Create new block
  const newY = highestY + 0.3;
  const color = 0x8ed860; // grass color
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
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
  if (blockList.length <= MIN_STACK_HEIGHT) return false;
  
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
  return blockList.length < STACKABLE_HEIGHT;
}

// Check if player can remove a block at position
export function canRemoveBlock(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  return blockList.length > MIN_STACK_HEIGHT;
}
