import * as THREE from 'three';
import { getScene } from './scene.js';

const TILE = 1;
const blocks = []; // all island blocks { mesh, gridX, gridZ, baseY }

const LAND_RADIUS = 14;

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
  const group = new THREE.Group();
  group.name = 'island';

  blocks.length = 0;

  const rMax = Math.ceil(LAND_RADIUS + 1);
  for (let gx = -rMax; gx <= rMax; gx++) {
    for (let gz = -rMax; gz <= rMax; gz++) {
      const dist = Math.sqrt(gx * gx + gz * gz);
      const edge = LAND_RADIUS - 0.35 - hash2D(gx, gz) * 0.65;
      if (dist > edge) continue;

      const t = Math.max(0, (LAND_RADIUS - dist) / LAND_RADIUS);
      const n = (hash2D(gx * 2.1, gz * 2.1) - 0.5) * 0.9 + (hash2D(gx * 0.9, gz * 0.9) - 0.5) * 0.6;
      const raw = 1 + t * 3.2 + n;
      const h = Math.max(1, Math.min(4, Math.floor(raw)));

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
  return group;
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
const STACKABLE_HEIGHT = 3; // Max stack height

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
