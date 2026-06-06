import * as THREE from "three";
import { getScene, getTileSize, getGridSize, getCamera } from "./scene.js";
import {
  isLand,
  getTerrainHeight,
  canPlaceBlock,
  canRemoveBlock,
  placeBlock,
  removeBlock,
} from "./island.js";
import { isInShallowWater, isInDeepWater, getWaveForce } from "./ocean.js";
import { spawnDustParticles, spawnSplashParticles } from "./particles.js";
import { playTerrainDeform, playSplash, playJump } from "./audio.js";
import { triggerJournal, hasTriggered } from "./journal.js";

const TILE = getTileSize();
const GRID = getGridSize();
const HALF = (GRID / 2) * TILE;

let playerMesh;
let position = new THREE.Vector3(0, 0.5, 0);
let velocity = new THREE.Vector3();
let isJumping = false;
let jumpVelocity = 0;
const SPEED_LAND = 6; // tiles/sec
const SPEED_WATER = 3; // tiles/sec
const JUMP_FORCE = 2;
const GRAVITY = 20;
let walkPhase = 0;
let lastFacing = 0;
const AUTO_STEP_UP = 0.7;
const JUMP_STEP_UP = 1.3;

// Input state
const keys = {};
let joystickInput = { x: 0, z: 0 };

export function createPlayer() {
  const scene = getScene();
  const group = new THREE.Group();

  // Stick figure body - bright visible colors
  const bodyMat = new THREE.MeshToonMaterial({ color: 0xffffff });
  const headMat = new THREE.MeshToonMaterial({ color: 0xffcc66 });

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 6);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.4;
  body.name = "body";
  body.userData.baseY = 0.4;
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.85;
  head.name = "head";
  head.userData.baseY = 0.85;
  group.add(head);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6);
  const legLRoot = new THREE.Group();
  legLRoot.position.set(-0.08, 0.25, 0);
  legLRoot.name = "legL";
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.y = -0.2;
  legLRoot.add(legL);
  group.add(legLRoot);

  const legRRoot = new THREE.Group();
  legRRoot.position.set(0.08, 0.25, 0);
  legRRoot.name = "legR";
  const legR = new THREE.Mesh(legGeo, bodyMat);
  legR.position.y = -0.2;
  legRRoot.add(legR);
  group.add(legRRoot);

  // Floating marker above head
  const markerGeo = new THREE.RingGeometry(0.3, 0.35, 16);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.2;
  marker.name = "playerMarker";
  group.add(marker);

  // Shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.3, 8);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.name = "playerShadow";
  group.add(shadow);

  group.name = "player";
  playerMesh = group;
  playerMesh.scale.set(1.5, 1.5, 1.5); // Larger for visibility
  playerMesh.position.copy(position);
  playerMesh.rotation.y = lastFacing;
  scene.add(playerMesh);

  return group;
}

export function updatePlayer(delta) {
  let speed = SPEED_LAND;
  const startGX = Math.round(position.x / TILE);
  const startGZ = Math.round(position.z / TILE);

  if (!isLand(startGX, startGZ) && isInShallowWater(startGX, startGZ, isLand)) {
    speed = SPEED_WATER;
  }

  // Movement from keyboard
  let moveX = 0,
    moveZ = 0;
  if (keys["KeyW"] || keys["ArrowUp"]) moveZ = 1;
  if (keys["KeyS"] || keys["ArrowDown"]) moveZ = -1;
  if (keys["KeyA"] || keys["ArrowLeft"]) moveX = -1;
  if (keys["KeyD"] || keys["ArrowRight"]) moveX = 1;

  // Joystick input
  moveX += joystickInput.x;
  moveZ += joystickInput.z;

  const wantsJump = (keys["Space"] || keys["KeyJ"]) && !isJumping;
  if (wantsJump) {
    isJumping = true;
    jumpVelocity = JUMP_FORCE;
    playJump();
  }

  // Normalize
  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }

  const camera = getCamera();
  if (camera && (moveX !== 0 || moveZ !== 0)) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    const fLen = forward.length();
    if (fLen > 0.0001) {
      forward.multiplyScalar(1 / fLen);
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const worldX = right.x * moveX + forward.x * moveZ;
      const worldZ = right.z * moveX + forward.z * moveZ;
      moveX = worldX;
      moveZ = worldZ;
    }
  }

  const prevX = position.x;
  const prevZ = position.z;

  const attemptMove = (fromX, fromZ, toX, toZ, allowJumpStep) => {
    const fromGX = Math.round(fromX / TILE);
    const fromGZ = Math.round(fromZ / TILE);
    const toGX = Math.round(toX / TILE);
    const toGZ = Math.round(toZ / TILE);
    const fromH = getTerrainHeight(fromGX, fromGZ);
    const toH = getTerrainHeight(toGX, toGZ);
    const dh = toH - fromH;
    if (dh <= AUTO_STEP_UP) return { x: toX, z: toZ };
    if (allowJumpStep && dh <= JUMP_STEP_UP) return { x: toX, z: toZ };
    if (dh > 0) return { x: fromX, z: fromZ };
    return { x: toX, z: toZ };
  };

  const allowJumpStep = isJumping || wantsJump;
  const nextX = position.x + moveX * speed * delta;
  const nextZ = position.z + moveZ * speed * delta;
  const r1 = attemptMove(position.x, position.z, nextX, position.z, allowJumpStep);
  position.x = r1.x;
  position.z = r1.z;
  const r2 = attemptMove(position.x, position.z, position.x, nextZ, allowJumpStep);
  position.x = r2.x;
  position.z = r2.z;

  // Wave push force when in water
  const gx = Math.round(position.x / TILE);
  const gz = Math.round(position.z / TILE);
  if (!isLand(gx, gz) && isInShallowWater(gx, gz, isLand)) {
    const waveForce = getWaveForce(position.x, position.z, delta);
    position.x += waveForce.x;
    position.z += waveForce.z;
  }

  // Deep water boundary — push player back toward island (soft boundary)
  if (
    isInDeepWater(Math.round(position.x / TILE), Math.round(position.z / TILE))
  ) {
    const pushDir = new THREE.Vector3(-position.x, 0, -position.z).normalize();
    position.x += pushDir.x * SPEED_WATER * delta * 1.0;
    position.z += pushDir.z * SPEED_WATER * delta * 1.0;
  }

  // Clamp to grid
  position.x = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, position.x));
  position.z = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, position.z));

  // Jump physics
  if (isJumping) {
    position.y += jumpVelocity * delta;
    jumpVelocity -= GRAVITY * delta;
    const terrainY = getTerrainHeight(gx, gz) + 0.5;
    if (position.y <= terrainY) {
      position.y = terrainY;
      isJumping = false;
      jumpVelocity = 0;
    }
  } else {
    // Ground level
    const terrainY = getTerrainHeight(gx, gz) + 0.5;
    position.y = terrainY;
  }

  playerMesh.position.copy(position);

  const body = playerMesh.getObjectByName("body");
  const head = playerMesh.getObjectByName("head");
  const legL = playerMesh.getObjectByName("legL");
  const legR = playerMesh.getObjectByName("legR");

  const dt = Math.max(0.000001, delta);
  const movedX = position.x - prevX;
  const movedZ = position.z - prevZ;
  const moveSpeed = Math.sqrt(movedX * movedX + movedZ * movedZ) / dt;
  const moving = moveSpeed > 0.15;

  if (moving) {
    lastFacing = Math.atan2(movedX, movedZ);
  }

  const lerp = 1 - Math.pow(0.001, delta);
  playerMesh.rotation.y = THREE.MathUtils.lerp(playerMesh.rotation.y, lastFacing, lerp);

  if (moving && !isJumping) {
    const stepRate = THREE.MathUtils.clamp(moveSpeed / SPEED_LAND, 0.2, 1.2) * 11;
    walkPhase += delta * stepRate;
    const swing = Math.sin(walkPhase) * 1.05;
    const bob = Math.abs(Math.sin(walkPhase)) * 0.12;
    const sway = Math.sin(walkPhase * 0.5) * 0.09;

    if (legL) legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, swing, lerp);
    if (legR) legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, -swing, lerp);

    if (body) {
      body.position.y = THREE.MathUtils.lerp(body.position.y, (body.userData.baseY ?? 0.4) + bob, lerp);
      body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, sway, lerp);
    }
    if (head) {
      head.position.y = THREE.MathUtils.lerp(head.position.y, (head.userData.baseY ?? 0.85) + bob * 0.6, lerp);
      head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, -sway * 0.5, lerp);
    }
  } else {
    if (legL) legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, lerp);
    if (legR) legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, lerp);
    if (body) {
      body.position.y = THREE.MathUtils.lerp(body.position.y, body.userData.baseY ?? 0.4, lerp);
      body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, 0, lerp);
    }
    if (head) {
      head.position.y = THREE.MathUtils.lerp(head.position.y, head.userData.baseY ?? 0.85, lerp);
      head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, 0, lerp);
    }
  }

  // Animate marker
  const marker = playerMesh.getObjectByName("playerMarker");
  if (marker) {
    marker.position.y = 1.2 + Math.sin(performance.now() * 0.004) * 0.15;
    marker.rotation.z += delta * 0.5;
  }

  // Shadow stays on ground
  const shadow = playerMesh.getObjectByName("playerShadow");
  if (shadow) {
    shadow.position.y = getTerrainHeight(gx, gz) + 0.03 - position.y;
  }
}

export function getPlayerPosition() {
  return position.clone();
}
export function getPlayerGridPos() {
  return { x: Math.round(position.x / TILE), z: Math.round(position.z / TILE) };
}
export function setKey(code, pressed) {
  keys[code] = pressed;
}
export function setJoystick(x, z) {
  joystickInput.x = x;
  joystickInput.z = z;
}
export function triggerJump() {
  if (!isJumping) {
    isJumping = true;
    jumpVelocity = JUMP_FORCE;
  }
}
export function grabBlock() {
  const gp = getPlayerGridPos();
  const gx = gp.x;
  const gz = gp.z;

  if (isLand(gx, gz)) {
    // On land: try to place or remove block
    if (canPlaceBlock(gx, gz)) {
      if (placeBlock(gx, gz)) {
        if (!hasTriggered("first_stack")) {
          triggerJournal("first_stack");
        }
        playTerrainDeform();
        spawnDustParticles(position.x, position.y + 0.5, position.z, 6);
        return true;
      }
    } else if (canRemoveBlock(gx, gz)) {
      if (removeBlock(gx, gz)) {
        playTerrainDeform();
        spawnDustParticles(position.x, position.y + 0.5, position.z, 6);
        return true;
      }
    }
  } else if (isInShallowWater(gx, gz, isLand)) {
    // In shallow water: splash effect
    playSplash();
    spawnSplashParticles(position.x, position.y + 0.3, position.z, 8);
    return false;
  }
  return false;
}
export function resetPlayer() {
  position.set(0, 0.5, 0);
  isJumping = false;
  jumpVelocity = 0;
  walkPhase = 0;
  playerMesh.position.copy(position);
}
export function getPlayerMesh() {
  return playerMesh;
}
