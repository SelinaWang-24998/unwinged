// Gyroscope system - dual mode with calibration & signal processing
import { gyroControlPursuer } from "./pursuer.js";
import { deformTerrain, tiltTerrainDirectional } from "./terrain.js";
import { createWave } from "./ocean.js";
import { isLand } from "./island.js";
import { getPlayerGridPos } from "./player.js";
import { getTileSize, getCamera } from "./scene.js";
import { triggerJournal, hasTriggered } from "./journal.js";
import { playTerrainDeform, playWave } from "./audio.js";

const TILE = getTileSize();

let mode = "pursuer"; // 'pursuer' | 'terrain' — 默认追捕者模式
let lastTilt = { beta: 0, gamma: 0 };
let tiltTimer = 0;
const TILT_HOLD_TIME = 1.0; // terrain mode cooldown (reduced from 1.5 to compensate smoothing delay)
const PULSE_COOLDOWN = 1.0; // seconds between pursuer nudges
let pulseCooldown = 0;
let permissionState = "unknown"; // "unknown" | "granted" | "denied"
let gyroEventCount = 0;

// === Calibration System ===
const CALIBRATION_SAMPLES = 10;
const RECALIBRATION_THRESHOLD = 30; // degrees — trigger recal if drift exceeds this
let calibration = {
  beta: 0,
  gamma: 0,
  calibrated: false,
  sampleCount: 0,
  sampleBeta: 0,
  sampleGamma: 0,
};

// === Signal Processing Pipeline ===
const DEAD_ZONE = 5; // degrees — ignore micro-tremor
const MAX_TILT = 45; // degrees — clamp above this
const SMOOTHING = 0.15; // EMA factor (0=raw, 1=frozen)
const SENSITIVITY_POW = 1.5; // 1=linear, 2=quadratic, 1.5=moderate

let smoothedTilt = { beta: 0, gamma: 0 };

// PC simulation state
let pcSimActive = false;
let pcSimMode = null;

function updateDebug() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  // Keyboard viz gyro params — show processed values
  set("kb-beta", (smoothedTilt.beta ?? 0).toFixed(1) + "\u00b0");
  set("kb-gamma", (smoothedTilt.gamma ?? 0).toFixed(1) + "\u00b0");
  set(
    "kb-tilt",
    Math.max(
      Math.abs(smoothedTilt.beta || 0),
      Math.abs(smoothedTilt.gamma || 0),
    ).toFixed(0) + "\u00b0",
  );
  set("kb-mode", mode === "pursuer" ? "\u8ffd\u6355\u8005" : "\u5730\u5f62");
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

export function requestGyroPermission() {
  try {
    const DevOrient = window.DeviceOrientationEvent;
    if (!DevOrient) {
      permissionState = "denied";
      return;
    }
    if (typeof DevOrient.requestPermission === "function") {
      // 不 await，让ta异步运行，不阻塞
      DevOrient.requestPermission()
        .then((permission) => {
          if (permission === "granted") {
            permissionState = "granted";
          } else {
            permissionState = "denied";
          }
        })
        .catch(() => {
          permissionState = "denied";
        });
    } else {
      permissionState = "granted";
    }
  } catch (e) {
    permissionState = "denied";
  }
}

export function initGyro() {
  try {
    const DevOrient = window.DeviceOrientationEvent;
    if (!DevOrient) {
      return false;
    }
    window.addEventListener("deviceorientation", handleOrientation, true);

    // Auto-recalibrate on orientation change
    try {
      screen.orientation?.addEventListener("change", () => {
        requestRecalibration();
      });
    } catch (e) {}

    updateDebug();
    return true;
  } catch (e) {
    return false;
  }
}

function handleOrientation(e) {
  if (e.beta === null) return;
  const rawBeta = e.beta;
  const rawGamma = e.gamma;

  // === Calibration phase ===
  if (!calibration.calibrated) {
    calibration.sampleCount++;
    calibration.sampleBeta += rawBeta;
    calibration.sampleGamma += rawGamma;
    if (calibration.sampleCount >= CALIBRATION_SAMPLES) {
      calibration.beta = calibration.sampleBeta / calibration.sampleCount;
      calibration.gamma = calibration.sampleGamma / calibration.sampleCount;
      calibration.calibrated = true;
      console.log(
        "[Gyro] \u6821\u51c6\u5b8c\u6210:",
        calibration.beta.toFixed(1),
        calibration.gamma.toFixed(1),
      );
    }
    return; // Don't feed uncalibrated data
  }

  // === Subtract calibration baseline ===
  lastTilt.beta = rawBeta - calibration.beta;
  lastTilt.gamma = rawGamma - calibration.gamma;

  gyroEventCount++;
  updateDebug();
}

// === Signal Processing Pipeline ===
// deadZone -> clamp maxTilt -> sensitivity curve -> EMA smoothing
function processTilt(rawBeta, rawGamma, delta) {
  let b = rawBeta;
  let g = rawGamma;

  // 1. Dead zone
  if (Math.abs(b) < DEAD_ZONE) b = 0;
  else b -= Math.sign(b) * DEAD_ZONE;
  if (Math.abs(g) < DEAD_ZONE) g = 0;
  else g -= Math.sign(g) * DEAD_ZONE;

  // 2. Max tilt clamp
  b = Math.max(-MAX_TILT, Math.min(MAX_TILT, b));
  g = Math.max(-MAX_TILT, Math.min(MAX_TILT, g));

  // 3. Sensitivity curve (pow makes small tilts gentler, large tilts stronger)
  const tiltRange = MAX_TILT - DEAD_ZONE;
  if (tiltRange > 0) {
    b =
      Math.sign(b) *
      Math.pow(Math.abs(b) / tiltRange, SENSITIVITY_POW) *
      tiltRange;
    g =
      Math.sign(g) *
      Math.pow(Math.abs(g) / tiltRange, SENSITIVITY_POW) *
      tiltRange;
  }

  // 4. EMA smoothing
  const alpha = 1 - Math.pow(1 - SMOOTHING, delta * 60);
  smoothedTilt.beta += (b - smoothedTilt.beta) * alpha;
  smoothedTilt.gamma += (g - smoothedTilt.gamma) * alpha;

  return { beta: smoothedTilt.beta, gamma: smoothedTilt.gamma };
}

export function updateGyro(delta) {
  if (pulseCooldown > 0) pulseCooldown -= delta;
  if (tiltTimer > 0) tiltTimer -= delta;

  // 移除了 updateDebug() 调用，提高性能

  if (pcSimActive) return; // PC controls handled separately

  // Process tilt through the signal pipeline
  const processed = processTilt(lastTilt.beta, lastTilt.gamma, delta);

  const absGamma = Math.abs(processed.gamma);
  const absBeta = Math.abs(processed.beta);
  const effectiveMaxTilt = Math.max(absGamma, absBeta);
  const intensity = Math.min(1, effectiveMaxTilt / (MAX_TILT - DEAD_ZONE));

  // Use DEAD_ZONE as threshold (already in processed space)
  if (effectiveMaxTilt < 1) return; // Below meaningful threshold after processing

  if (mode === "pursuer") {
    // Mode A: Tilt moves pursuer
    if (pulseCooldown <= 0) {
      if (!hasTriggered("gyro_pursuer")) {
        triggerJournal("gyro_pursuer");
      }
      const rawX = processed.gamma / 90;
      const rawZ = (processed.beta + 45 - 45) / 45; // beta center = 0 after calibration

      const a = -getScreenAngleRad();
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const tiltX = rawX * cosA - rawZ * sinA;
      const tiltZ = rawX * sinA + rawZ * cosA;

      const camera = getCamera?.();
      if (!camera) {
        gyroControlPursuer(tiltX, tiltZ, intensity);
      } else {
        const e = camera.matrixWorld.elements;
        const rx = e[0];
        const rz = e[2];
        let fx = -e[8];
        let fz = -e[10];
        const fl = Math.hypot(fx, fz);
        if (fl > 1e-8) {
          fx /= fl;
          fz /= fl;
        } else {
          fx = 0;
          fz = 1;
        }
        const rl = Math.hypot(rx, rz);
        const rnx = rl > 1e-8 ? rx / rl : 1;
        const rnz = rl > 1e-8 ? rz / rl : 0;
        let wx = rnx * tiltX + fx * tiltZ;
        let wz = rnz * tiltX + fz * tiltZ;
        const wl = Math.hypot(wx, wz);
        if (wl > 1e-8) {
          wx /= wl;
          wz /= wl;
        }
        gyroControlPursuer(wx, wz, intensity);
      }
      pulseCooldown = PULSE_COOLDOWN;
    }
  } else {
    // Mode B: Change environment
    const pos = getPlayerGridPos();
    if (isLand(pos.x, pos.z)) {
      if (!hasTriggered("gyro_terrain")) {
        triggerJournal("gyro_terrain");
      }
      if (tiltTimer <= 0) {
        const rawX = processed.gamma / 90;
        const rawZ = processed.beta / 45;

        const a = -getScreenAngleRad();
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const tiltX = rawX * cosA - rawZ * sinA;
        const tiltZ = rawX * sinA + rawZ * cosA;

        const camera = getCamera?.();
        let wx = tiltX;
        let wz = tiltZ;
        if (camera) {
          const e = camera.matrixWorld.elements;
          const rx = e[0];
          const rz = e[2];
          let fx = -e[8];
          let fz = -e[10];
          const fl = Math.hypot(fx, fz);
          if (fl > 1e-8) {
            fx /= fl;
            fz /= fl;
          } else {
            fx = 0;
            fz = 1;
          }
          const rl = Math.hypot(rx, rz);
          const rnx = rl > 1e-8 ? rx / rl : 1;
          const rnz = rl > 1e-8 ? rz / rl : 0;
          wx = rnx * tiltX + fx * tiltZ;
          wz = rnz * tiltX + fz * tiltZ;
        }
        const wl = Math.hypot(wx, wz);
        if (wl > 1e-8) {
          wx /= wl;
          wz /= wl;
        }

        tiltTerrainDirectional(pos.x, pos.z, wx, wz, intensity, 3, 1.1, true);
        playTerrainDeform();
        tiltTimer = TILT_HOLD_TIME * 0.25; // short burst mode
      }
    } else {
      // On sea: create waves
      if (!hasTriggered("gyro_wave")) {
        triggerJournal("gyro_wave");
        playWave();
      }
      const rawX = processed.gamma / 90;
      const rawZ = processed.beta / 45;

      const a = -getScreenAngleRad();
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const tiltX = rawX * cosA - rawZ * sinA;
      const tiltZ = rawX * sinA + rawZ * cosA;

      const camera = getCamera?.();
      let wx = tiltX;
      let wz = tiltZ;
      if (camera) {
        const e = camera.matrixWorld.elements;
        const rx = e[0];
        const rz = e[2];
        let fx = -e[8];
        let fz = -e[10];
        const fl = Math.hypot(fx, fz);
        if (fl > 1e-8) {
          fx /= fl;
          fz /= fl;
        } else {
          fx = 0;
          fz = 1;
        }
        const rl = Math.hypot(rx, rz);
        const rnx = rl > 1e-8 ? rx / rl : 1;
        const rnz = rl > 1e-8 ? rz / rl : 0;
        wx = rnx * tiltX + fx * tiltZ;
        wz = rnz * tiltX + fz * tiltZ;
      }
      const wl = Math.hypot(wx, wz);
      if (wl > 1e-8) {
        wx /= wl;
        wz /= wl;
      }

      createWave({ x: wx, z: wz }, intensity);
    }
  }
}

// PC keyboard simulation
export function pcGyroPulse(direction) {
  const intensity = 0.7;
  // Simulate tilt values so they show in the keyboard viz
  lastTilt.beta = (direction.z || 0) * 45;
  lastTilt.gamma = (direction.x || 0) * 45;
  // Skip calibration for PC simulation
  smoothedTilt.beta = lastTilt.beta;
  smoothedTilt.gamma = lastTilt.gamma;
  updateDebug();
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

export function resetGyro() {
  lastTilt = { beta: 0, gamma: 0 };
  smoothedTilt = { beta: 0, gamma: 0 };
  tiltTimer = 0;
  pulseCooldown = 0;
  gyroEventCount = 0;
  // Reset calibration so next game re-calibrates
  calibration.calibrated = false;
  calibration.sampleCount = 0;
  calibration.sampleBeta = 0;
  calibration.sampleGamma = 0;
  updateDebug();
}

export function requestRecalibration() {
  calibration.calibrated = false;
  calibration.sampleCount = 0;
  calibration.sampleBeta = 0;
  calibration.sampleGamma = 0;
  smoothedTilt = { beta: 0, gamma: 0 };
  console.log("[Gyro] \u91cd\u65b0\u6821\u51c6\u4e2d...");
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

export function isCalibrated() {
  return calibration.calibrated;
}
