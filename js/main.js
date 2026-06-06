import * as THREE from 'three';
import { initScene, render, getScene, getCamera, getRenderer } from './scene.js';
import { createIsland } from './island.js';
import { createOcean, updateOcean } from './ocean.js';
import { createPlayer, updatePlayer, resetPlayer, getPlayerPosition } from './player.js';
import { createPursuer, updatePursuer, resetPursuer } from './pursuer.js';
import { createFragments, updateFragments, checkFragmentCollection, resetFragments, onFragmentCollected } from './fragments.js';
import { initGyro, updateGyro } from './gyro.js';
import { initJournal, triggerJournal, resetJournal } from './journal.js';
import { initUI, updateUI, endGame, resetUI, onRestart, onStart, isGameRunning, isGameOver } from './ui.js';
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

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function attachCameraControls() {
  if (cameraControlsCleanup) cameraControlsCleanup();

  const renderer = getRenderer();
  if (!renderer) return;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';

  let active = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    active = true;
    pointerId = e.pointerId ?? null;
    lastX = e.clientX;
    lastY = e.clientY;
    if (pointerId !== null) canvas.setPointerCapture(pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onMove = (e) => {
    if (!active) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    camYaw -= dx * 0.005;
    camHeight = clamp(camHeight + dy * 0.03, 6, 26);
    camRadius = clamp(camRadius + dy * 0.02, 12, 34);
  };

  const onUp = (e) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    active = false;
    if (pointerId !== null) {
      try { canvas.releasePointerCapture(pointerId); } catch (err) {}
    }
    pointerId = null;
    canvas.style.cursor = 'grab';
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  cameraControlsCleanup = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  };
}

// Clean up old scene objects AND old canvas
function cleanupScene() {
  const scene = getScene();
  ['player', 'pursuer', 'island', 'fragments', 'ripples', 'shallowWater'].forEach(name => {
    const obj = scene.getObjectByName(name);
    if (obj) scene.remove(obj);
  });
  const ocean = scene.getObjectByName('ocean');
  if (ocean) scene.remove(ocean);

  // Remove old canvas to avoid duplicates
  const oldCanvas = document.querySelector('#game-container canvas');
  if (oldCanvas) oldCanvas.remove();
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

    if (!isGameRunning() || isGameOver()) {
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
onStart(() => {
  try {
    console.log('[DEBUG] Game starting...');
    cleanupScene();
    initScene(container);
    attachCameraControls();
    clock = new THREE.Clock();
    buildWorld();
    console.log('[DEBUG] World built, creating player...');

    createPlayer();
    console.log('[DEBUG] Player created, creating pursuer...');
    createPursuer();
    console.log('[DEBUG] Pursuer created, initializing gyro...');
    initGyro();
    initJournal();
    console.log('[DEBUG] Game start complete, entering game loop');

    onFragmentCollected((id, count) => {
      if (count === 1) triggerJournal('first_fragment');
      if (count >= 3) {
        endGame(true);
        playVictory();
      } else {
        playCollect();
        const pos = getPlayerPosition();
        spawnCollectParticles(pos.x, pos.y + 1, pos.z);
      }
    });

    startGameLoop();
  } catch (err) {
    console.error('[DEBUG] Game start failed:', err);
  }
});

// Restart handler
onRestart(() => {
  cleanupScene();
  clearAllParticles();
  initScene(container);
  attachCameraControls();
  clock = new THREE.Clock();
  resetPlayer();
  resetPursuer();
  resetFragments();
  resetJournal();
  resetUI();

  buildWorld();
  startBgLoop();
});
