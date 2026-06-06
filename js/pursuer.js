import * as THREE from 'three';
import { getScene, getTileSize, getGridSize } from './scene.js';
import { getPlayerPosition } from './player.js';
import { isLand } from './island.js';

const TILE = getTileSize();
const GRID = getGridSize();
const HALF = (GRID / 2) * TILE;
const PATROL_SPEED = 2.5;
const CHASE_SPEED = 3.6;
const VISION_RANGE = 8;
const VISION_ANGLE = Math.PI * 0.6; // 120° cone
const CHASE_DURATION = 6;

let pursuerMesh;
let velocity = new THREE.Vector3();
let position = new THREE.Vector3(3, 0.5, 3);
let state = 'PATROL'; // PATROL | CHASE | GYRO_CONTROL
let patrolIndex = 0;
let chaseTimer = 0;
let caughtPlayer = false;

// Gyro control state
let gyroTarget = null;
let gyroMoveRemaining = 0;

// Patrol waypoints
const patrolPoints = [
  new THREE.Vector3(3, 0, 3), new THREE.Vector3(3, 0, -3),
  new THREE.Vector3(-3, 0, -3), new THREE.Vector3(-3, 0, 3),
  new THREE.Vector3(0, 0, 5), new THREE.Vector3(5, 0, 0),
  new THREE.Vector3(0, 0, -5), new THREE.Vector3(-5, 0, 0),
];

export function createPursuer() {
  const scene = getScene();
  const group = new THREE.Group();

  // Geometric creature - blocky hound
  const mat = new THREE.MeshToonMaterial({ color: 0xff4444 });
  const eyeMat = new THREE.MeshToonMaterial({ color: 0xffff00 });

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.3, 0.7);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.35;
  group.add(body);

  // Head
  const headGeo = new THREE.BoxGeometry(0.35, 0.25, 0.3);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.set(0, 0.5, 0.45);
  group.add(head);

  // Eyes
  const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.1, 0.55, 0.55);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.1, 0.55, 0.55);
  group.add(eyeR);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.12, 0.25, 0.12);
  for (let lx = -1; lx <= 1; lx += 2) {
    for (let lz = -1; lz <= 1; lz += 2) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx * 0.18, 0.1, lz * 0.25);
      group.add(leg);
    }
  }

  // Vision cone indicator
  const coneGeo = new THREE.ConeGeometry(VISION_RANGE * 0.4, VISION_RANGE * 0.6, 8, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.set(0, 0.3, 0.3);
  cone.name = 'visionCone';
  group.add(cone);

  // Floating warning marker
  const markerGeo = new THREE.RingGeometry(0.4, 0.45, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.0;
  marker.name = 'pursuerMarker';
  group.add(marker);

  group.name = 'pursuer';
  pursuerMesh = group;
  pursuerMesh.scale.set(1.3, 1.3, 1.3);
  position.y = getGroundY(position.x, position.z) + 0.5;
  pursuerMesh.position.copy(position);
  scene.add(pursuerMesh);

  return group;
}

function getGroundY(wx, wz) {
  const gx = Math.round(wx / TILE);
  const gz = Math.round(wz / TILE);
  if (isLand(gx, gz)) {
    // Find terrain height from island blocks
    const scene = getScene();
    const island = scene.getObjectByName('island');
    if (island) {
      let maxY = 0;
      island.children.forEach(c => {
        if (Math.abs(c.position.x - gx * TILE) < 0.5 && Math.abs(c.position.z - gz * TILE) < 0.5) {
          maxY = Math.max(maxY, c.position.y + 0.3);
        }
      });
      return maxY;
    }
  }
  return 0;
}

export function updatePursuer(delta) {
  const playerPos = getPlayerPosition();

  // Check vision
  if (state !== 'GYRO_CONTROL') {
    const toPlayer = playerPos.clone().sub(position);
    const dist = toPlayer.length();
    toPlayer.y = 0;
    toPlayer.normalize();

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pursuerMesh.quaternion);
    forward.y = 0; forward.normalize();
    const dot = forward.dot(toPlayer);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));

    if (dist < VISION_RANGE && angle < VISION_ANGLE / 2) {
      state = 'CHASE';
      chaseTimer = CHASE_DURATION;
    }
  }

  // State behavior
  switch (state) {
    case 'PATROL':
      patrol(delta);
      break;
    case 'CHASE':
      chase(delta, playerPos);
      break;
    case 'GYRO_CONTROL':
      gyroMove(delta);
      break;
  }

  // Ground level
  position.y = getGroundY(position.x, position.z) + 0.5;
  pursuerMesh.position.copy(position);

  // Face movement direction
  if (velocity.length() > 0.01) {
    const angle = Math.atan2(velocity.x, velocity.z);
    pursuerMesh.rotation.y = angle;
  }

  // Check catch
  const distToPlayer = position.distanceTo(playerPos);
  if (distToPlayer < 0.8) {
    caughtPlayer = true;
  }

  // Update vision cone
  const cone = pursuerMesh.getObjectByName('visionCone');
  if (cone && state === 'CHASE') {
    cone.material.opacity = 0.15;
  } else if (cone) {
    cone.material.opacity = 0.08;
  }

  // Animate marker
  const marker = pursuerMesh.getObjectByName('pursuerMarker');
  if (marker) {
    marker.position.y = 1.0 + Math.sin(performance.now() * 0.005) * 0.12;
    marker.rotation.z += delta * 0.3;
  }
}

function patrol(delta) {
  const target = patrolPoints[patrolIndex];
  const dir = target.clone().sub(position);
  dir.y = 0;
  const dist = dir.length();

  if (dist < 0.3) {
    patrolIndex = (patrolIndex + 1) % patrolPoints.length;
  } else {
    dir.normalize();
    velocity.copy(dir.multiplyScalar(PATROL_SPEED * delta));
    position.x += velocity.x;
    position.z += velocity.z;
  }
}

function chase(delta, playerPos) {
  chaseTimer -= delta;
  if (chaseTimer <= 0) {
    state = 'PATROL';
    return;
  }
  const dir = playerPos.clone().sub(position);
  dir.y = 0;
  const dist = dir.length();
  if (dist > 0.2) {
    dir.normalize();
    velocity.copy(dir.multiplyScalar(CHASE_SPEED * delta));
    position.x += velocity.x;
    position.z += velocity.z;
  }
}

function gyroMove(delta) {
  if (!gyroTarget || gyroMoveRemaining <= 0) {
    state = 'PATROL';
    gyroTarget = null;
    return;
  }
  const dir = gyroTarget.clone();
  const moveSpeed = 5 * delta;
  position.x += dir.x * moveSpeed;
  position.z += dir.z * moveSpeed;
  gyroMoveRemaining -= moveSpeed;
}

// Gyro Mode A: move pursuer based on tilt
export function gyroControlPursuer(tiltX, tiltZ, intensity) {
  if (state === 'CHASE') return; // Can't override chase
  state = 'GYRO_CONTROL';
  const maxDist = 3 * TILE;
  gyroMoveRemaining = maxDist * intensity; // intensity from tilt angle
  gyroTarget = new THREE.Vector3(tiltX, 0, tiltZ).normalize();
}

export function getPursuerPosition() { return position.clone(); }
export function getPursuerGridPos() {
  return { x: Math.round(position.x / TILE), z: Math.round(position.z / TILE) };
}
export function wasPlayerCaught() {
  if (caughtPlayer) { caughtPlayer = false; return true; }
  return false;
}
export function isChasing() { return state === 'CHASE'; }
export function resetPursuer() {
  position.set(3, 0.5, 3);
  state = 'PATROL';
  patrolIndex = 0;
  chaseTimer = 0;
  gyroTarget = null;
  gyroMoveRemaining = 0;
  caughtPlayer = false;
  pursuerMesh.position.copy(position);
}
