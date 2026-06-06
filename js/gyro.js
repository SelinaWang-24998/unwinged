// Gyroscope system - dual mode
import { gyroControlPursuer } from "./pursuer.js";
import { deformTerrain } from "./terrain.js";
import { createWave } from "./ocean.js";
import { isLand, getTerrainHeight } from "./island.js";
import { getPlayerGridPos } from "./player.js";
import { getTileSize } from "./scene.js";
import { triggerJournal, hasTriggered } from "./journal.js";
import { playTerrainDeform, playWave } from "./audio.js";

const TILE = getTileSize();

let mode = "terrain"; // 'pursuer' | 'terrain'
let lastTilt = { beta: 0, gamma: 0 };
let tiltTimer = 0;
const TILT_THRESHOLD = 20; // degrees
const TILT_HOLD_TIME = 1.5; // seconds for terrain mode
const PULSE_COOLDOWN = 1.0; // seconds between pursuer nudges
let pulseCooldown = 0;

// PC simulation state
let pcSimActive = false;
let pcSimMode = null;

export async function initGyro() {
  try {
    const DevOrient = window.DeviceOrientationEvent;

    if (!DevOrient) {
      console.warn("[Gyro] 当前环境不支持 DeviceOrientationEvent");
      return false;
    }

    if (typeof DevOrient.requestPermission === "function") {
      const permission = await DevOrient.requestPermission();

      if (permission !== "granted") {
        console.warn("[Gyro] 用户未授权陀螺仪");
        return false;
      }
    }

    window.addEventListener("deviceorientation", handleOrientation, true);
    console.log("[Gyro] 陀螺仪监听已启动");

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
}

export function updateGyro(delta) {
  if (pulseCooldown > 0) pulseCooldown -= delta;
  if (tiltTimer > 0) tiltTimer -= delta;

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
      const dirX = (lastTilt.gamma || 0) / 90; // -1 to 1
      const dirZ = (lastTilt.beta - 45 || 0) / 45; // -1 to 1 (beta 0=flat, 90=vertical)
      gyroControlPursuer(dirX, dirZ, intensity);
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
    createWave(direction, intensity);
  }
}

export function toggleGyroMode() {
  mode = mode === "pursuer" ? "terrain" : "pursuer";
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
