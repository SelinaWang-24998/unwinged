// Terrain deformation system - Z-axis height changes
import { getScene, getTileSize, getGridSize } from './scene.js';
import { getBlocks, getBlockAt, getTerrainHeight } from './island.js';

const TILE = getTileSize();

// Store original terrain heights for restoration
const originalHeights = new Map();

// Store original foliage positions so we can track height changes
const foliageOriginalY = new Map(); // key: "gx,gz" → original group.position.y

// Initialize foliage position tracking (call after island is created)
export function initFoliageTracking() {
  foliageOriginalY.clear();
  const scene = getScene();
  const foliageGroup = scene.getObjectByName('foliage');
  if (!foliageGroup) return;
  foliageGroup.children.forEach(child => {
    const gx = Math.round(child.position.x / TILE);
    const gz = Math.round(child.position.z / TILE);
    foliageOriginalY.set(`${gx},${gz}`, child.position.y);
  });
}

// Sync foliage Y position with current terrain height at its grid cell
function syncFoliageAt(gx, gz) {
  const scene = getScene();
  const foliageGroup = scene.getObjectByName('foliage');
  if (!foliageGroup) return;

  const key = `${Math.round(gx)},${Math.round(gz)}`;
  const terrainH = getTerrainHeight(gx, gz);
  const originalY = foliageOriginalY.get(key);
  if (originalY === undefined) return;

  foliageGroup.children.forEach(child => {
    const cx = Math.round(child.position.x / TILE);
    const cz = Math.round(child.position.z / TILE);
    if (cx === Math.round(gx) && cz === Math.round(gz)) {
      child.position.y = terrainH + (originalY - foliageOriginalY.get(key));
      // Also update collision center for hero trees
      if (child.userData.collisionCenter) {
        child.userData.collisionCenter.y = child.position.y;
      }
    }
  });
}

// Deform terrain at grid position with animation
export function deformTerrain(gx, gz, deltaY, radius = 1) {
  const blocks = getBlocks();
  const affectedCells = new Set();

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const nx = Math.round(gx) + dx;
      const nz = Math.round(gz) + dz;

      // Calculate falloff based on distance
      const dist = Math.sqrt(dx * dx + dz * dz);
      const falloff = Math.max(0, 1 - dist / (radius + 0.5));
      const actualDelta = deltaY * falloff;

      // Get blocks at this position
      const blockList = getBlockAt(nx, nz);
      blockList.forEach(b => {
        // Store original if not stored
        const key = `${b.gridX},${b.gridZ}`;
        if (!originalHeights.has(key)) {
          originalHeights.set(key, b.mesh.position.y);
        }

        // Apply deformation
        const newY = Math.max(-1.5, Math.min(4, b.mesh.position.y + actualDelta));
        b.mesh.position.y = newY;
        b.baseY = newY;
      });

      if (falloff > 0) affectedCells.add(`${nx},${nz}`);
    }
  }

  // Sync foliage with deformed terrain
  affectedCells.forEach(key => {
    const [cx, cz] = key.split(',').map(Number);
    syncFoliageAt(cx, cz);
  });
}

export function tiltTerrainDirectional(gx, gz, dirX, dirZ, intensity, radius = 2, amount = 0.9, invert = false) {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return;
  const inv = invert ? -1 : 1;
  const nxDir = (dirX / len) * inv;
  const nzDir = (dirZ / len) * inv;
  const normRadius = Math.max(1, radius);
  const affectedCells = new Set();

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const nx = Math.round(gx) + dx;
      const nz = Math.round(gz) + dz;

      const dist = Math.sqrt(dx * dx + dz * dz);
      const falloff = Math.max(0, 1 - dist / (radius + 0.5));
      if (falloff <= 0) continue;

      const signed = (dx * nxDir + dz * nzDir) / normRadius;
      const actualDelta = amount * intensity * falloff * signed;
      if (Math.abs(actualDelta) < 1e-6) continue;

      const blockList = getBlockAt(nx, nz);
      blockList.forEach(b => {
        const key = `${b.gridX},${b.gridZ}`;
        if (!originalHeights.has(key)) {
          originalHeights.set(key, b.mesh.position.y);
        }

        const newY = Math.max(-1.5, Math.min(4, b.mesh.position.y + actualDelta));
        b.mesh.position.y = newY;
        b.baseY = newY;
      });

      affectedCells.add(`${nx},${nz}`);
    }
  }

  // Sync foliage with deformed terrain
  affectedCells.forEach(key => {
    const [cx, cz] = key.split(',').map(Number);
    syncFoliageAt(cx, cz);
  });
}

// Raise terrain (for building up)
export function raiseTerrain(gx, gz, amount = 0.3) {
  deformTerrain(gx, gz, amount, 1);
}

// Lower terrain (for digging)
export function lowerTerrain(gx, gz, amount = 0.3) {
  deformTerrain(gx, gz, -amount, 1);
}

// Reset terrain to original state
export function resetTerrain() {
  const blocks = getBlocks();
  blocks.forEach(b => {
    const key = `${b.gridX},${b.gridZ}`;
    if (originalHeights.has(key)) {
      const originalY = originalHeights.get(key);
      b.mesh.position.y = originalY;
      b.baseY = originalY;
    }
  });
  originalHeights.clear();
}

// Get current terrain height at position
export function getDeformedHeight(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  if (blockList.length === 0) return 0;
  return Math.max(...blockList.map(b => b.mesh.position.y + 0.3));
}

// Check if terrain can be modified at position
export function canDeform(gx, gz) {
  const blockList = getBlockAt(gx, gz);
  return blockList.length > 0;
}
