import * as THREE from "three";
import { getScene, getTileSize, getGridSize } from "./scene.js";
import { getPlayerPosition } from "./player.js";
import { isLand } from "./island.js";
import { isInShallowWater, isInDeepWater, getWaveForce } from "./ocean.js";

const TILE = getTileSize();
const GRID = getGridSize();
const HALF = (GRID / 2) * TILE;
const PATROL_SPEED = 2.5;
const CHASE_SPEED = 4.0;   // was 0.036, now units/sec
const VISION_RANGE = 8;
const VISION_ANGLE = Math.PI * 0.6; // 120° cone
const CHASE_DURATION = 6;
const PATROL_POINTS_COUNT = 6;
const PATROL_POINT_RADIUS_MIN = 2;
const PATROL_POINT_RADIUS_MAX = 6;

let pursuerMesh;
let velocity = new THREE.Vector3();
let position = new THREE.Vector3(3, 0.5, 3);
let state = "PATROL"; // PATROL | CHASE | GYRO_CONTROL
let patrolIndex = 0;
let chaseTimer = 0;
let caughtPlayer = false;

// Gyro control state
let gyroTarget = null;
let gyroMoveRemaining = 0;

let patrolPoints = [];
let gaitPhase = 0;
let legMeshes = [];
let bodyMesh = null;

// Generate random patrol points on land/shallow water each game
function generatePatrolPoints() {
  patrolPoints = [];
  for (let i = 0; i < PATROL_POINTS_COUNT; i++) {
    let attempts = 0;
    while (attempts < 50) {
      const angle = Math.random() * Math.PI * 2;
      const radius = PATROL_POINT_RADIUS_MIN + Math.random() * (PATROL_POINT_RADIUS_MAX - PATROL_POINT_RADIUS_MIN);
      const x = Math.round(Math.cos(angle) * radius / TILE) * TILE;
      const z = Math.round(Math.sin(angle) * radius / TILE) * TILE;
      // Prefer land or shallow water
      if (isLand(Math.round(x / TILE), Math.round(z / TILE)) || !isInDeepWater(Math.round(x / TILE), Math.round(z / TILE))) {
        patrolPoints.push(new THREE.Vector3(x, 0, z));
        break;
      }
      attempts++;
    }
    // Fallback: place anywhere on grid
    if (patrolPoints.length <= i) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 3;
      patrolPoints.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      ));
    }
  }
}

export function createPursuer() {
  const scene = getScene();
  const group = new THREE.Group();
  gaitPhase = 0;
  legMeshes = [];
  bodyMesh = null;

  // Geometric creature - blocky hound
  const mat = new THREE.MeshToonMaterial({ color: 0xff4444 });
  const eyeMat = new THREE.MeshToonMaterial({ color: 0xffff00 });

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.3, 0.7);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.35;
  body.name = "body";
  body.userData.baseY = 0.35;
  bodyMesh = body;
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
  legGeo.translate(0, -0.125, 0);
  for (let lx = -1; lx <= 1; lx += 2) {
    for (let lz = -1; lz <= 1; lz += 2) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx * 0.18, 0.22, lz * 0.25);
      leg.userData.baseY = leg.position.y;
      leg.userData.lx = lx;
      leg.userData.lz = lz;
      legMeshes.push(leg);
      group.add(leg);
    }
  }

  // Vision cone indicator
  const coneGeo = new THREE.ConeGeometry(
    VISION_RANGE * 0.4,
    VISION_RANGE * 0.6,
    8,
    1,
    true,
  );
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xff6666,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.set(0, 0.3, 0.3);
  cone.name = "visionCone";
  group.add(cone);

  // Floating warning marker
  const markerGeo = new THREE.RingGeometry(0.4, 0.45, 16);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.0;
  marker.name = "pursuerMarker";
  group.add(marker);

  group.name = "pursuer";
  pursuerMesh = group;
  pursuerMesh.scale.set(1.3, 1.3, 1.3);
  position.y = getGroundY(position.x, position.z) + 0.5;
  pursuerMesh.position.copy(position);
  scene.add(pursuerMesh);

  generatePatrolPoints();

  return group;
}

function getGroundY(wx, wz) {
  const gx = Math.round(wx / TILE);
  const gz = Math.round(wz / TILE);
  if (isLand(gx, gz)) {
    // Find terrain height from island blocks
    const scene = getScene();
    const island = scene.getObjectByName("island");
    if (island) {
      let maxY = 0;
      island.children.forEach((c) => {
        if (
          Math.abs(c.position.x - gx * TILE) < 0.5 &&
          Math.abs(c.position.z - gz * TILE) < 0.5
        ) {
          maxY = Math.max(maxY, c.position.y + 0.3);
        }
      });
      return maxY;
    }
  }
  // In water: return water surface height
  return -0.15;
}

export function updatePursuer(delta) {
  const prevX = position.x;
  const prevZ = position.z;
  const playerPos = getPlayerPosition();

  // Check vision
  if (state !== "GYRO_CONTROL") {
    const toPlayer = playerPos.clone().sub(position);
    const dist = toPlayer.length();
    toPlayer.y = 0;
    toPlayer.normalize();

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      pursuerMesh.quaternion,
    );
    forward.y = 0;
    forward.normalize();
    const dot = forward.dot(toPlayer);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));

    if (dist < VISION_RANGE && angle < VISION_ANGLE / 2) {
      // Occlusion check: raycast from pursuer to player
      let occluded = false;
      const scene = getScene();
      const island = scene.getObjectByName("island");
      if (island) {
        const rayDir = playerPos.clone().sub(position).normalize();
        const rayLen = dist;
        for (let step = 0.5; step < rayLen; step += 0.5) {
          const sx = Math.round((position.x + rayDir.x * step) / TILE);
          const sz = Math.round((position.z + rayDir.z * step) / TILE);
          if (isLand(sx, sz)) {
            const blockY = getGroundY(position.x + rayDir.x * step, position.z + rayDir.z * step);
            if (blockY > position.y) { occluded = true; break; }
          }
        }
      }
      if (!occluded) {
        state = "CHASE";
        chaseTimer = CHASE_DURATION;
      }
    }
  }

  // State behavior
  switch (state) {
    case "PATROL":
      patrol(delta);
      break;
    case "CHASE":
      chase(delta, playerPos);
      break;
    case "GYRO_CONTROL":
      gyroMove(delta);
      break;
  }

  // Wave push force when pursuer is in shallow water
  const pgx = Math.round(position.x / TILE);
  const pgz = Math.round(position.z / TILE);
  if (!isLand(pgx, pgz) && isInShallowWater(pgx, pgz, isLand)) {
    const waveForce = getWaveForce(position.x, position.z, delta);
    position.x += waveForce.x;
    position.z += waveForce.z;
  }

  // Deep water boundary — push pursuer back toward island (soft boundary)
  if (isInDeepWater(pgx, pgz)) {
    const pushDir = new THREE.Vector3(-position.x, 0, -position.z).normalize();
    position.x += pushDir.x * 2.5 * delta;
    position.z += pushDir.z * 2.5 * delta;
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
  const cone = pursuerMesh.getObjectByName("visionCone");
  if (cone && state === "CHASE") {
    cone.material.opacity = 0.15;
  } else if (cone) {
    cone.material.opacity = 0.08;
  }

  // Animate marker
  const marker = pursuerMesh.getObjectByName("pursuerMarker");
  if (marker) {
    marker.position.y = 1.0 + Math.sin(performance.now() * 0.005) * 0.12;
    marker.rotation.z += delta * 0.3;
  }

  applyGaitAnimation(delta, prevX, prevZ);
}

function applyGaitAnimation(delta, prevX, prevZ) {
  if (!pursuerMesh) return;
  const dt = Math.max(0.000001, delta);
  const movedX = position.x - prevX;
  const movedZ = position.z - prevZ;
  const moveSpeed = Math.sqrt(movedX * movedX + movedZ * movedZ) / dt;
  const moving = moveSpeed > 0.08;

  const lerp = 1 - Math.pow(0.001, delta);
  const chase = state === "CHASE";

  if (moving) {
    const speedNorm = THREE.MathUtils.clamp(moveSpeed / (chase ? CHASE_SPEED : PATROL_SPEED), 0.2, 1.6);
    const stepFreq = (chase ? 20 : 8) * speedNorm;
    gaitPhase += delta * stepFreq;
  } else {
    gaitPhase += delta * 2;
  }

  const s = Math.sin(gaitPhase);
  const swingAmp = chase ? 1.25 : 0.5;
  const liftAmp = chase ? 0.065 : 0.03;
  const lean = chase ? -0.55 : -0.12;

  for (const leg of legMeshes) {
    const pair = leg.userData.lx === leg.userData.lz ? 1 : -1;
    const swing = s * swingAmp * pair;
    const lift = Math.max(0, s * pair) * liftAmp;
    leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, swing, lerp);
    leg.position.y = THREE.MathUtils.lerp(leg.position.y, (leg.userData.baseY ?? 0.22) + lift, lerp);
  }

  if (bodyMesh) {
    const baseY = bodyMesh.userData.baseY ?? 0.35;
    const bob = moving ? Math.abs(s) * (chase ? 0.08 : 0.035) : 0;
    bodyMesh.position.y = THREE.MathUtils.lerp(bodyMesh.position.y, baseY + bob, lerp);
    bodyMesh.rotation.x = THREE.MathUtils.lerp(bodyMesh.rotation.x, moving ? lean : 0, lerp);
    bodyMesh.rotation.z = THREE.MathUtils.lerp(bodyMesh.rotation.z, moving ? s * (chase ? 0.06 : 0.03) : 0, lerp);
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
    state = "PATROL";
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
    state = "PATROL";
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
  if (state === "CHASE") return; // Can't override chase
  state = "GYRO_CONTROL";
  const maxDist = 3 * TILE;
  gyroMoveRemaining = maxDist * intensity; // intensity from tilt angle
  gyroTarget = new THREE.Vector3(tiltX, 0, tiltZ).normalize();
}

export function getPursuerPosition() {
  return position.clone();
}
export function getPursuerGridPos() {
  return { x: Math.round(position.x / TILE), z: Math.round(position.z / TILE) };
}
export function wasPlayerCaught() {
  if (caughtPlayer) {
    caughtPlayer = false;
    return true;
  }
  return false;
}
export function isChasing() {
  return state === "CHASE";
}
export function resetPursuer() {
  position.set(3, 0.5, 3);
  state = "PATROL";
  patrolIndex = 0;
  chaseTimer = 0;
  gyroTarget = null;
  gyroMoveRemaining = 0;
  caughtPlayer = false;
  generatePatrolPoints();
  pursuerMesh.position.copy(position);
}
