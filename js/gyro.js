// Gyroscope system - dual mode
import * as THREE from "three";
import { gyroControlPursuer } from "./pursuer.js";
import { deformTerrain } from "./terrain.js";
import { createWave } from "./ocean.js";
import { isLand, getTerrainHeight } from "./island.js";
import { getPlayerGridPos } from "./player.js";
import { getTileSize, getCamera } from "./scene.js";
import { triggerJournal, hasTriggered } from "./journal.js";
import { playTerrainDeform, playWave } from "./audio.js";

const TILE = getTileSize();

let mode = "terrain"; // 'pursuer' | 'terrain'
let lastTilt = { beta: 0, gamma: 0 };
let tiltTimer = 0;
const TILT_THRESHOLD = 8; // degrees
const TILT_HOLD_TIME = 1.5; // seconds for terrain mode
const PULSE_COOLDOWN = 1.0; // seconds between pursuer nudges
let pulseCooldown = 0;
let permissionState = "unknown"; // "unknown" | "granted" | "denied"
let gyroEventCount = 0;

// PC simulation state
let pcSimActive = false;
let pcSimMode = null;

function updateDebug() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set("db-perm", permissionState);
  set("db-evt", gyroEventCount);
  set("db-beta", (lastTilt.beta ?? 0).toFixed(1));
  set("db-gamma", (lastTilt.gamma ?? 0).toFixed(1));
  set("db-alpha", "-");
  set(
    "db-tilt",
    Math.max(
      Math.abs(lastTilt.beta || 0),
      Math.abs(lastTilt.gamma || 0),
    ).toFixed(1),
  );
  set("db-mode", mode);
  set("db-cd", pulseCooldown.toFixed(2));
}

function getScreenAngleRad() {
  const angleDeg =
    (screen.orientation && typeof screen.orientation.angle === "number"
      ? screen.orientation.angle
      : typeof window.orientation === "number"
        ? window.orientation
        : 0) || 0;
  return (angleDeg * Math.PI) / 180;
}

export async function requestGyroPermission() {
  try {
    const DevOrient = window.DeviceOrientationEvent;
    if (!DevOrient) {
      permissionState = "denied";
      return false;
    }
    if (typeof DevOrient.requestPermission === "function") {
      const permission = await DevOrient.requestPermission();
      if (permission !== "granted") {
        permissionState = "denied";
        console.warn("[Gyro] 用户未授权陀螺仪");
        return false;
      }
    }
    permissionState = "granted";
    console.log("[Gyro] 陀螺仪权限已获取");
    updateDebug();
    return true;
  } catch (e) {
    permissionState = "denied";
    console.warn("[Gyro] 权限请求失败", e);
    return false;
  }
}

export function initGyro() {
  try {
    const DevOrient = window.DeviceOrientationEvent;
    if (!DevOrient) {
      console.warn("[Gyro] 当前环境不支持 DeviceOrientationEvent");
      return false;
    }
    // Always attach listener — on Android events fire without permission,
    // on iOS the listener waits until requestGyroPermission() grants it in a user gesture.
    window.addEventListener("deviceorientation", handleOrientation, true);
    console.log("[Gyro] 陀螺仪监听已启动");
    updateDebug();
    return true;
  } catch (e) {
    console.warn("[Gyro] 初始化失败，降级为普通控制", e);
    return false;
  }
}

function handleOrientation(e) {
  if (e.beta === null) return;
  lastTilt.beta = e.beta;
  lastTilt.gamma = e.gamma;
  gyroEventCount++;
  updateDebug();
}

export function updateGyro(delta) {
  if (pulseCooldown > 0) pulseCooldown -= delta;
  if (tiltTimer > 0) tiltTimer -= delta;

  updateDebug();

  if (pcSimActive) return; // PC controls handled separately

  const absGamma = Math.abs(lastTilt.gamma || 0);
  const absBeta = Math.abs(lastTilt.beta || 0);
  const maxTilt = Math.max(absGamma, absBeta);
  const intensity = Math.min(1, maxTilt / 60); // 0-1 based on tilt

  if (mode === "pursuer") {
    // Mode A: Tilt moves pursuer
    if (maxTilt > TILT_THRESHOLD && pulseCooldown <= 0) {
      if (!hasTriggered("gyro_pursuer")) {
        triggerJournal("gyro_pursuer");
      }
      const rawX = (lastTilt.gamma || 0) / 90;
      const rawZ = ((lastTilt.beta ?? 0) - 45) / 45;

      const a = -getScreenAngleRad();
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const tiltX = rawX * cosA - rawZ * sinA;
      const tiltZ = rawX * sinA + rawZ * cosA;

      const camera = getCamera?.();
      if (!camera) {
        gyroControlPursuer(tiltX, tiltZ, intensity);
      } else {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) {
          gyroControlPursuer(tiltX, tiltZ, intensity);
        } else {
          forward.normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const right = new THREE.Vector3().crossVectors(forward, up).normalize();
          const worldDir = new THREE.Vector3()
            .addScaledVector(right, tiltX)
            .addScaledVector(forward, tiltZ);
          if (worldDir.lengthSq() > 1e-8) worldDir.normalize();
          gyroControlPursuer(worldDir.x, worldDir.z, intensity);
        }
      }
      pulseCooldown = PULSE_COOLDOWN;
    }
  } else {
    // Mode B: Change environment
    if (maxTilt > TILT_THRESHOLD) {
      const pos = getPlayerGridPos();
      if (isLand(pos.x, pos.z)) {
        // On land: modify terrain Z-axis
        if (!hasTriggered("gyro_terrain")) {
          triggerJournal("gyro_terrain");
        }
        const dir = lastTilt.gamma > 0 ? 1 : -1;
        if (tiltTimer <= 0) {
          deformTerrain(pos.x, pos.z, dir * intensity * 0.3, 2);
          playTerrainDeform();
          tiltTimer = 0.3;
        }
      } else {
        // On sea: create waves
        if (!hasTriggered("gyro_wave")) {
          triggerJournal("gyro_wave");
          playWave();
        }
        const dirX = (lastTilt.gamma || 0) / 90;
        const dirZ = (lastTilt.beta - 45 || 0) / 45;
        createWave({ x: dirX, z: dirZ }, intensity);
      }
    }
  }
}

// PC keyboard simulation
export function pcGyroPulse(direction) {
  const intensity = 0.7;
  if (mode === "pursuer") {
    gyroControlPursuer(direction.x || 0, direction.z || 0, intensity);
  } else {
    const pos = getPlayerGridPos();
    if (isLand(pos.x, pos.z)) {
      const dir =
        direction.x !== 0
          ? Math.sign(direction.x)
          : Math.sign(direction.z || 0);
      deformTerrain(pos.x, pos.z, dir * intensity * 0.3, 2);
      playTerrainDeform();
    } else {
      createWave(direction, intensity);
    }
  }
}

export function toggleGyroMode() {
  mode = mode === "pursuer" ? "terrain" : "pursuer";
  updateDebug();
  return mode;
}

export function getGyroMode() {
  return mode;
}

// PC simulation via keyboard
export function setPCSim(active, simMode) {
  pcSimActive = active;
  pcSimMode = simMode;
}
