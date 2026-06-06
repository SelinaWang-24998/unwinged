import { getCollectedCount, getTotalFragments, hasFragments, consumeFragment } from './fragments.js';
import { wasPlayerCaught, isChasing } from './pursuer.js';
import { toggleGyroMode, getGyroMode } from './gyro.js';
import { setKey, setJoystick, triggerJump, grabBlock } from './player.js';
import { triggerJournal } from './journal.js';
import { showReview, hideReview, isReviewVisible } from './journal.js';
import { playAlert, playVictory, playGameOver } from './audio.js';

let timeRemaining = 360; // 6 minutes in seconds
let gameRunning = false;
let gameOver = false;
let lives = 1;
let score = 0;
let onRestartCallback = null;
let onStartCallback = null;
let firstMoveTriggered = false;

// DOM elements
let scoreEl, livesEl, timerEl, modeLabel, startScreen, endScreen;
let endTitle, endScore, endJournalHint, restartBtn, startBtn;
let isMobile = false;

export function initUI() {
  scoreEl = document.getElementById('score');
  livesEl = document.getElementById('lives');
  timerEl = document.getElementById('timer');
  modeLabel = document.getElementById('mode-label');
  startScreen = document.getElementById('start-screen');
  endScreen = document.getElementById('end-screen');
  endTitle = document.getElementById('end-title');
  endScore = document.getElementById('end-score');
  endJournalHint = document.getElementById('end-journal-hint');
  restartBtn = document.getElementById('restart-btn');
  startBtn = document.getElementById('start-btn');

  // Detect mobile
  isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || 'ontouchstart' in window;
  if (isMobile) {
    document.getElementById('mobile-controls')?.classList.remove('hidden');
  }

  // Start button
  startBtn.addEventListener('click', () => {
    startScreen.classList.add('hidden');
    gameRunning = true;
    if (onStartCallback) onStartCallback();
  });

  // Restart button
  restartBtn.addEventListener('click', () => {
    endScreen.classList.add('hidden');
    if (onRestartCallback) onRestartCallback();
  });

  // Keyboard input
  document.addEventListener('keydown', (e) => {
    setKey(e.code, true);

    if (e.code === 'KeyQ') {
      const mode = toggleGyroMode();
      modeLabel.textContent = mode === 'pursuer' ? '追捕者' : '地形';
    }
    if (e.code === 'KeyE') {
      grabBlock();
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (isReviewVisible()) hideReview(); else showReview();
    }
    if (e.code === 'Space') e.preventDefault();

    // PC gyro: Ctrl+Arrow to simulate tilt
    if (e.ctrlKey) {
      e.preventDefault();
      const dirMap = { ArrowUp: { x: 0, z: 1 }, ArrowDown: { x: 0, z: -1 }, ArrowLeft: { x: -1, z: 0 }, ArrowRight: { x: 1, z: 0 } };
      if (dirMap[e.code]) {
        import('./gyro.js').then(m => m.pcGyroPulse(dirMap[e.code]));
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    setKey(e.code, false);
  });

  // Mobile joystick
  if (isMobile) setupJoystick();
  setupMobileButtons();
}

function setupJoystick() {
  const base = document.getElementById('joystick-base');
  const thumb = document.getElementById('joystick-thumb');
  if (!base || !thumb) return;

  let active = false;
  const center = { x: 50, y: 50 };
  const maxDist = 36;

  const handleMove = (clientX, clientY) => {
    const rect = base.getBoundingClientRect();
    const cx = clientX - rect.left - center.x;
    const cy = clientY - rect.top - center.y;
    const dist = Math.min(maxDist, Math.sqrt(cx * cx + cy * cy));
    const angle = Math.atan2(cy, cx);
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    thumb.style.transform = `translate(${tx}px, ${ty}px)`;
    setJoystick(tx / maxDist, ty / maxDist);
  };

  const handleEnd = () => {
    active = false;
    thumb.style.transform = 'translate(0, 0)';
    setJoystick(0, 0);
  };

  base.addEventListener('touchstart', (e) => { active = true; handleMove(e.touches[0].clientX, e.touches[0].clientY); });
  base.addEventListener('touchmove', (e) => { if (active) handleMove(e.touches[0].clientX, e.touches[0].clientY); });
  base.addEventListener('touchend', handleEnd);
  base.addEventListener('mousedown', (e) => { active = true; handleMove(e.clientX, e.clientY); });
  document.addEventListener('mousemove', (e) => { if (active) handleMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', handleEnd);
}

function setupMobileButtons() {
  document.getElementById('btn-jump')?.addEventListener('pointerdown', triggerJump);
  document.getElementById('btn-mode')?.addEventListener('pointerdown', () => {
    const mode = toggleGyroMode();
    if (modeLabel) modeLabel.textContent = mode === 'pursuer' ? '追捕者' : '地形';
  });
  document.getElementById('btn-grab')?.addEventListener('pointerdown', grabBlock);
}

export function updateUI(delta) {
  if (!gameRunning || gameOver) return;

  timeRemaining -= delta;
  if (timeRemaining <= 0) {
    timeRemaining = 0;
    endGame(false);
    return;
  }

  // Timer display
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.floor(timeRemaining % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  if (timeRemaining < 60) {
    timerEl.parentElement?.classList.add('warning');
  }

  // Score display
  scoreEl.textContent = getCollectedCount();

  // Lives display
  lives = 1 + score;
  livesEl.textContent = lives;

  // Check pursuer catch
  if (wasPlayerCaught()) {
    if (hasFragments()) {
      consumeFragment();
      triggerJournal('first_caught');
      playAlert();
      scoreEl.textContent = getCollectedCount();
      livesEl.textContent = 1 + getCollectedCount();
    } else {
      playGameOver();
      endGame(false);
      return;
    }
  }
  
  // Alert when being chased (every 2 seconds)
  if (isChasing() && Math.floor(timeRemaining * 2) % 4 === 0) {
    // playAlert is called less frequently to avoid spam
  }

  // First move trigger
  if (!firstMoveTriggered) {
    firstMoveTriggered = true;
    setTimeout(() => triggerJournal('first_move'), 2000);
  }
}

export function endGame(won) {
  gameOver = true;
  gameRunning = false;
  score = getCollectedCount();
  endScreen.classList.remove('hidden');

  if (won || score >= 3) {
    endTitle.textContent = '你发现了所有秘密';
    endTitle.style.color = '#ffd700';
    triggerJournal('all_fragments');
  } else if (score > 0) {
    endTitle.textContent = '时间到';
    endTitle.style.color = '#ffaa44';
  } else {
    endTitle.textContent = '未能收集到碎片';
    endTitle.style.color = '#ff6666';
  }
  endScore.textContent = `收集碎片: ${score}/${getTotalFragments()}`;
  endJournalHint.textContent = '按 Tab 查看你发现的观察日志';
}

export function resetUI() {
  timeRemaining = 360;
  gameRunning = false;
  gameOver = false;
  lives = 1;
  score = 0;
  firstMoveTriggered = false;
  scoreEl.textContent = '0';
  livesEl.textContent = '1';
  timerEl.textContent = '6:00';
  timerEl.parentElement?.classList.remove('warning');
  endScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

export function getTimeRemaining() { return timeRemaining; }
export function isGameRunning() { return gameRunning; }
export function isGameOver() { return gameOver; }
export function onRestart(cb) { onRestartCallback = cb; }
export function onStart(cb) { onStartCallback = cb; }
export { isMobile };
