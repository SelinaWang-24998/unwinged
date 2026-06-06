import * as THREE from 'three';
import { getScene, getTileSize, getGridSize } from './scene.js';
import { isLand, getTerrainHeight, canPlaceBlock, canRemoveBlock, placeBlock, removeBlock } from './island.js';
import { isInShallowWater } from './ocean.js';
import { spawnDustParticles, spawnSplashParticles } from './particles.js';
import { playTerrainDeform, playSplash, playJump } from './audio.js';
import { triggerJournal, hasTriggered } from './journal.js';

const TILE = getTileSize();
const GRID = getGridSize();
const HALF = (GRID / 2) * TILE;

let playerMesh;
let position = new THREE.Vector3(0, 0.5, 0);
let velocity = new THREE.Vector3();
let isJumping = false;
let jumpVelocity = 0;
const SPEED_LAND = 6;   // tiles/sec
const SPEED_WATER = 3;  // tiles/sec
const JUMP_FORCE = 5;
const GRAVITY = 12;

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
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.85;
  group.add(head);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6);
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.set(-0.08, 0.05, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, bodyMat);
  legR.position.set(0.08, 0.05, 0);
  group.add(legR);

  // Floating marker above head
  const markerGeo = new THREE.RingGeometry(0.3, 0.35, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.2;
  marker.name = 'playerMarker';
  group.add(marker);

  // Shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.3, 8);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.name = 'playerShadow';
  group.add(shadow);

  group.name = 'player';
  playerMesh = group;
  playerMesh.scale.set(1.5, 1.5, 1.5); // Larger for visibility
  playerMesh.position.copy(position);
  scene.add(playerMesh);

  return group;
}

export function updatePlayer(delta) {
  let speed = SPEED_LAND;
  const gx = Math.round(position.x / TILE);
  const gz = Math.round(position.z / TILE);

  if (!isLand(gx, gz) && isInShallowWater(gx, gz, isLand)) {
    speed = SPEED_WATER;
  }

  // Movement from keyboard
  let moveX = 0, moveZ = 0;
  if (keys['KeyW'] || keys['ArrowUp']) moveZ = 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveZ = -1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveX = -1;
  if (keys['KeyD'] || keys['ArrowRight']) moveX = 1;

  // Joystick input
  moveX += joystickInput.x;
  moveZ += joystickInput.z;

  // Normalize
  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }

  position.x += moveX * speed * delta;
  position.z += moveZ * speed * delta;

  // Clamp to grid
  position.x = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, position.x));
  position.z = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, position.z));

  // Jump
  if ((keys['Space'] || keys['KeyJ']) && !isJumping) {
    isJumping = true;
    jumpVelocity = JUMP_FORCE;
    playJump();
  }

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

  // Animate marker
  const marker = playerMesh.getObjectByName('playerMarker');
  if (marker) {
    marker.position.y = 1.2 + Math.sin(performance.now() * 0.004) * 0.15;
    marker.rotation.z += delta * 0.5;
  }

  // Shadow stays on ground
  const shadow = playerMesh.getObjectByName('playerShadow');
  if (shadow) {
    shadow.position.y = getTerrainHeight(gx, gz) + 0.03 - position.y;
  }
}

export function getPlayerPosition() { return position.clone(); }
export function getPlayerGridPos() {
  return { x: Math.round(position.x / TILE), z: Math.round(position.z / TILE) };
}
export function setKey(code, pressed) { keys[code] = pressed; }
export function setJoystick(x, z) { joystickInput.x = x; joystickInput.z = z; }
export function triggerJump() { if (!isJumping) { isJumping = true; jumpVelocity = JUMP_FORCE; } }
export function grabBlock() {
  const gp = getPlayerGridPos();
  const gx = gp.x;
  const gz = gp.z;
  
  if (isLand(gx, gz)) {
    // On land: try to place or remove block
    if (canPlaceBlock(gx, gz)) {
      if (placeBlock(gx, gz)) {
        if (!hasTriggered('first_stack')) {
          triggerJournal('first_stack');
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
  playerMesh.position.copy(position);
}
export function getPlayerMesh() { return playerMesh; }
