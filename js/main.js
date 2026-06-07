import * as THREE from './lib/three.module.js';
import { initScene, resetSceneForGame, render, getScene, getCamera, getRenderer, disposeObject3D } from './scene.js';
import { createIsland } from './island.js';
import { createOcean, updateOcean } from './ocean.js';
import { createPlayer, updatePlayer, resetPlayer, getPlayerPosition } from './player.js';
import { createPursuer, updatePursuer, resetPursuer } from './pursuer.js';
import { createFragments, updateFragments, checkFragmentCollection, resetFragments, onFragmentCollected, getTotalFragments } from './fragments.js';
import { initGyro, updateGyro, resetGyro } from './gyro.js';
import { initJournal, triggerJournal, resetJournal } from './journal.js';
import { initUI, updateUI, endGame, resetUI, onRestart, onStart, isGameRunning, isGameOver, refreshScoreDisplay, isPaused } from './ui.js';
import { updateParticles, clearAllParticles, spawnCollectParticles, spawnSplashParticles, spawnDustParticles } from './particles.js';
import { updateRipples } from './particles.js';
import { playCollect, playSplash, playAlert, playVictory, playGameOver, initAudioOnInteraction } from './audio.js';

let clock;
let gameLoopId = null;
const cameraTargetPos = new THREE.Vector3();
let cameraControlsCleanup = null;
let camYaw = Math.PI / 4;
let camRadius = Math.sqrt(16 * 16 + 16 * 16);
let camHeight = 14;
const camOffset = new THREE.Vector3();
let targetZoom = 1;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.1;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function attachCameraControls() {
  if (cameraControlsCleanup) cameraControlsCleanup();

  const renderer = getRenderer();
  if (!renderer) return;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';

  const camera = getCamera();
  if (camera) targetZoom = clamp(camera.zoom || 1, ZOOM_MIN, ZOOM_MAX);

  const pointers = new Map();
  let active = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastPinchDist = null;

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const id = e.pointerId ?? 'mouse';
    pointers.set(id, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}

    if (pointers.size === 1) {
      active = true;
      pointerId = id;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
      lastPinchDist = null;
    } else if (pointers.size === 2) {
      active = false;
      pointerId = null;
      const pts = Array.from(pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      canvas.style.cursor = 'grabbing';
    }
  };

  const onMove = (e) => {
    const id = e.pointerId ?? 'mouse';
    if (!pointers.has(id)) return;
    pointers.set(id, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist && dist > 0.1) {
        const ratio = dist / lastPinchDist;
        targetZoom = clamp(targetZoom * ratio, ZOOM_MIN, ZOOM_MAX);
      }
      lastPinchDist = dist;
      return;
    }

    if (!active) return;
    if (pointerId !== null && id !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    camYaw -= dx * 0.005;
    camHeight = clamp(camHeight + dy * 0.03, 6, 26);
    camRadius = clamp(camRadius + dy * 0.02, 12, 34);
  };

  const onUp = (e) => {
    const id = e.pointerId ?? 'mouse';
    pointers.delete(id);
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}

    if (pointers.size === 0) {
      active = false;
      pointerId = null;
      lastPinchDist = null;
      canvas.style.cursor = 'grab';
      return;
    }

    if (pointers.size === 1) {
      const remainingId = Array.from(pointers.keys())[0];
      pointerId = remainingId;
      active = true;
      const pt = pointers.get(remainingId);
      lastX = pt.x;
      lastY = pt.y;
      lastPinchDist = null;
      return;
    }

    if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      active = false;
      pointerId = null;
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY;
    targetZoom = clamp(targetZoom * Math.exp(-delta * 0.001), ZOOM_MIN, ZOOM_MAX);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  cameraControlsCleanup = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}

// Clean up old scene objects (DO NOT remove canvas — we reuse the renderer)
function cleanupScene() {
  const scene = getScene();
  ['player', 'pursuer', 'island', 'foliage', 'fragments', 'ripples', 'shallowWater', 'shallowFlow', 'deepFlow'].forEach(name => {
    const obj = scene.getObjectByName(name);
    if (obj) {
      scene.remove(obj);
      disposeObject3D(obj);
    }
  });
  const ocean = scene.getObjectByName('ocean');
  if (ocean) {
    scene.remove(ocean);
    disposeObject3D(ocean);
  }
}

// Build a fresh game world
function buildWorld() {
  createIsland();
  createOcean();
  createFragments();
}

function startGameLoop() {
  if (gameLoopId) cancelAnimationFrame(gameLoopId);

  function animate() {
    gameLoopId = requestAnimationFrame(animate);

    if (!isGameRunning() || isGameOver() || isPaused()) {
      render();
      return;
    }

    const delta = Math.min(clock.getDelta(), 0.1);
    updatePlayer(delta);
    updatePursuer(delta);
    updateFragments(delta);
    updateOcean(delta);
    updateGyro(delta);
    checkFragmentCollection();
    updateUI(delta);
    updateParticles(delta);
    updateRipples(delta);

    const pos = getPlayerPosition();
    const camera = getCamera();
    if (camera) {
      const z = THREE.MathUtils.lerp(camera.zoom, targetZoom, 0.15);
      if (Math.abs(z - camera.zoom) > 0.0005) {
        camera.zoom = z;
        camera.updateProjectionMatrix();
      }
    }
    camOffset.set(Math.sin(camYaw) * camRadius, camHeight, Math.cos(camYaw) * camRadius);
    cameraTargetPos.set(pos.x + camOffset.x, pos.y + camOffset.y, pos.z + camOffset.z);
    camera.position.lerp(cameraTargetPos, 0.05);
    camera.lookAt(pos.x, pos.y, pos.z);

    render();
  }
  animate();
}

// Background render (no game logic, just visuals)
function startBgLoop() {
  function bgAnimate() {
    if (isGameRunning()) return; // Stop when game starts
    const delta = Math.min(clock.getDelta(), 0.1);
    updateFragments(delta);
    updateOcean(delta);
    render();
    requestAnimationFrame(bgAnimate);
  }
  bgAnimate();
}

// === Mobile Error Overlay ===
// Shows JS errors directly on screen so mobile users can see what went wrong
function initErrorOverlay() {
  const el = document.createElement('div');
  el.id = 'error-overlay';
  el.style.cssText = [
    'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999',
    'background:rgba(180,10,10,0.92);color:#fff;display:none',
    'flex-direction:column;align-items:flex-start;justify-content:flex-start',
    'padding:24px 20px;font-family:monospace;font-size:13px;line-height:1.7',
    'white-space:pre-wrap;word-break:break-all;overflow-y:auto;overflow-x:hidden',
    'text-align:left;box-sizing:border-box',
  ].join(';');
  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:16px;color:#ff6666';
  title.textContent = '⚠ JS Error Detected';
  el.appendChild(title);
  const body = document.createElement('div');
  body.id = 'error-overlay-body';
  body.style.cssText = 'flex:1;width:100%';
  el.appendChild(body);
  const dismiss = document.createElement('div');
  dismiss.style.cssText = 'margin-top:16px;font-size:12px;color:#ffaaaa;width:100%;text-align:center';
  dismiss.textContent = '(tap to dismiss)';
  el.appendChild(dismiss);
  el.addEventListener('click', () => { el.style.display = 'none'; });
  document.body.appendChild(el);
  return el;
}

const errorOverlay = initErrorOverlay();

function showErrorOverlay(msg) {
  if (!errorOverlay) return;
  errorOverlay.style.display = 'flex';
  const body = document.getElementById('error-overlay-body');
  if (body) body.textContent = msg;
  // Also log so desktop debug is possible
  console.error('[ErrorOverlay]', msg);
}

// Catch uncaught errors
window.addEventListener('error', function(e) {
  const detail = e.error ? (e.error.stack || e.error.message) : e.message;
  showErrorOverlay(`${e.message}\n\nat ${e.filename}:${e.lineno}:${e.colno}\n\n${detail || ''}`);
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', function(e) {
  showErrorOverlay('Unhandled Promise Rejection:\n\n' + (e.reason?.stack || e.reason?.message || String(e.reason)));
});

// === Bootstrap ===
const container = document.getElementById('game-container');
initScene(container);
attachCameraControls();
initUI();
initAudioOnInteraction(); // Initialize audio on first user interaction
clock = new THREE.Clock();

// Background world
buildWorld();
startBgLoop();

// Start handler
onStart(async () => {
  try {
    console.log('[DEBUG] Game starting...');
    cleanupScene();
    resetSceneForGame();   // Reuse existing renderer — no WebGL context recreation
    clock = new THREE.Clock();
    buildWorld();
    console.log('[DEBUG] World built, creating player...');

    createPlayer();
    console.log('[DEBUG] Player created, creating pursuer...');
    createPursuer();
    console.log('[DEBUG] Pursuer created, initializing gyro...');
    try {
      await initGyro();
    } catch (e) {
      console.warn('陀螺仪不可用，继续游戏', e);
    }
    initJournal();
    console.log('[DEBUG] Game start complete, entering game loop');

    onFragmentCollected((id, count) => {
      // Immediately update score display (don't wait for next updateUI frame)
      refreshScoreDisplay();
      if (count === 1) triggerJournal('first_fragment');
      if (count >= getTotalFragments()) {
        endGame('win');
        playVictory();
        return;
      }

      playCollect();
      const pos = getPlayerPosition();
      spawnCollectParticles(pos.x, pos.y + 1, pos.z);
    });

    startGameLoop();
  } catch (err) {
    console.error('[DEBUG] Game start failed:', err);
    showErrorOverlay('[Game Start] ' + (err.stack || err.message));
  }
});

// Restart handler
onRestart(() => {
  cleanupScene();
  resetSceneForGame();   // Reuse existing renderer
  clearAllParticles();
  clock = new THREE.Clock();
  resetPlayer();
  resetPursuer();
  resetFragments();
  resetJournal();
  resetUI();
  resetGyro();

  // Reset camera to defaults so previous drag/zoom doesn't carry over
  camYaw = Math.PI / 4;
  camRadius = Math.sqrt(16 * 16 + 16 * 16);
  camHeight = 14;
  targetZoom = 1;

  buildWorld();
  startBgLoop();
});

// === Orientation enforcement is handled by initOrientationGuards() in ui.js ===
// CSS rotate-prompt is the primary lock; JS orientation.lock() is best-effort.
