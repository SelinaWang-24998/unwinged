import * as THREE from 'three';
import { initScene, render, getScene, getCamera } from './scene.js';
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

// Clean up old scene objects
function cleanupScene() {
  const scene = getScene();
  ['player', 'pursuer', 'island', 'fragments', 'ripples'].forEach(name => {
    const obj = scene.getObjectByName(name);
    if (obj) scene.remove(obj);
  });
  // Remove ocean (water mesh)
  const ocean = scene.getObjectByName('ocean');
  if (ocean) scene.remove(ocean);
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
    camera.position.set(pos.x + 16, pos.y + 14, pos.z + 16);
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
initUI();
initAudioOnInteraction(); // Initialize audio on first user interaction
clock = new THREE.Clock();

// Background world
buildWorld();
startBgLoop();

// Start handler
onStart(() => {
  cleanupScene();
  initScene(container);
  clock = new THREE.Clock();
  buildWorld();

  createPlayer();
  createPursuer();
  initGyro();
  initJournal();

  onFragmentCollected((id, count) => {
    if (count === 1) triggerJournal('first_fragment');
    if (count >= 3) {
      endGame(true);
      playVictory();
    } else {
      playCollect();
      // Spawn collect particles
      const pos = getPlayerPosition();
      spawnCollectParticles(pos.x, pos.y + 1, pos.z);
    }
  });

  startGameLoop();
});

// Restart handler
onRestart(() => {
  cleanupScene();
  clearAllParticles();
  initScene(container);
  clock = new THREE.Clock();
  resetPlayer();
  resetPursuer();
  resetFragments();
  resetJournal();
  resetUI();

  buildWorld();
  startBgLoop();
});
