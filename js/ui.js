import {
  getCollectedCount,
  getTotalCollectedEver,
  getTotalFragments,
} from "./fragments.js";
import { wasPlayerCaught, isChasing } from "./pursuer.js";
import { toggleGyroMode, getGyroMode } from "./gyro.js";
import { setKey, setJoystick, triggerJump, grabBlock } from "./player.js";
import { triggerJournal } from "./journal.js";
import { showReview, hideReview, isReviewVisible } from "./journal.js";
import { playAlert, playVictory, playGameOver } from "./audio.js";

// === Fullscreen + Landscape Lock ===
// Call this on user gesture (button click). Returns a promise.
export async function requestLandscape() {
  try {
    const el = document.documentElement;
    // Step 1: enter fullscreen (required for orientation lock on mobile)
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        await el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen().catch(() => {});
      }
    }
    // Step 2: lock orientation to landscape
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape-primary').catch(() => {
        return screen.orientation.lock('landscape').catch(() => {});
      });
    }
  } catch (e) {
    // Not supported or denied — CSS rotate prompt will show as fallback
  }
}

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
let countdownOverlay, countdownNumber;
let isMobile = false;

// 3-2-1 countdown before game starts
function startCountdown() {
  let count = 3;
  countdownOverlay.classList.remove("hidden");
  countdownNumber.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      countdownNumber.textContent = count;
      // Re-trigger pop animation
      countdownNumber.style.animation = "none";
      void countdownNumber.offsetHeight; // force reflow
      countdownNumber.style.animation = "countPop 0.6s ease-out";
    } else {
      clearInterval(interval);
      countdownOverlay.classList.add("hidden");
      gameRunning = true;
      if (onStartCallback) onStartCallback();
    }
  }, 1000);
}

export function initUI() {
  scoreEl = document.getElementById("score");
  livesEl = document.getElementById("lives");
  timerEl = document.getElementById("timer");
  modeLabel = document.getElementById("mode-label");
  startScreen = document.getElementById("start-screen");
  endScreen = document.getElementById("end-screen");
  endTitle = document.getElementById("end-title");
  endScore = document.getElementById("end-score");
  endJournalHint = document.getElementById("end-journal-hint");
  restartBtn = document.getElementById("restart-btn");
  startBtn = document.getElementById("start-btn");
  countdownOverlay = document.getElementById("countdown-overlay");
  countdownNumber = document.getElementById("countdown-number");

  // Detect mobile
  isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    "ontouchstart" in window;
  if (isMobile) {
    document.getElementById("mobile-controls")?.classList.remove("hidden");
  }

  // Start button — enter fullscreen + landscape, then countdown
  startBtn.addEventListener("click", async () => {
    startScreen.classList.add("hidden");
    await requestLandscape();
    startCountdown();
  });

  // Restart button
  restartBtn.addEventListener("click", () => {
    endScreen.classList.add("hidden");
    if (onRestartCallback) onRestartCallback();
  });

  // Keyboard input
  document.addEventListener("keydown", (e) => {
    setKey(e.code, true);

    if (e.code === "KeyQ") {
      const mode = toggleGyroMode();
      modeLabel.textContent = mode === "pursuer" ? "追捕者" : "地形";
    }
    if (e.code === "KeyE") {
      grabBlock();
    }
    if (e.code === "Tab") {
      e.preventDefault();
      if (isReviewVisible()) hideReview();
      else showReview();
    }
    if (e.code === "Space") e.preventDefault();

    // PC gyro: Alt+Arrow to simulate gyro tilt (mode B: terrain/wave)
    if (e.altKey) {
      e.preventDefault();
      const dirMap = {
        ArrowUp: { x: 0, z: 1 },
        ArrowDown: { x: 0, z: -1 },
        ArrowLeft: { x: -1, z: 0 },
        ArrowRight: { x: 1, z: 0 },
      };
      if (dirMap[e.code]) {
        import("./gyro.js").then((m) => m.pcGyroPulse(dirMap[e.code]));
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    setKey(e.code, false);
  });

  // Mobile joystick
  if (isMobile) setupJoystick();
  setupMobileButtons();
  initOrientationGuards();
}

function setupJoystick() {
  const base = document.getElementById("joystick-base");
  const thumb = document.getElementById("joystick-thumb");
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
    setJoystick(tx / maxDist, -ty / maxDist);
  };

  const handleEnd = () => {
    active = false;
    thumb.style.transform = "translate(0, 0)";
    setJoystick(0, 0);
  };

  base.addEventListener("touchstart", (e) => {
    active = true;
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  });
  base.addEventListener("touchmove", (e) => {
    if (active) handleMove(e.touches[0].clientX, e.touches[0].clientY);
  });
  base.addEventListener("touchend", handleEnd);
  base.addEventListener("mousedown", (e) => {
    active = true;
    handleMove(e.clientX, e.clientY);
  });
  document.addEventListener("mousemove", (e) => {
    if (active) handleMove(e.clientX, e.clientY);
  });
  document.addEventListener("mouseup", handleEnd);
}

function setupMobileButtons() {
  document
    .getElementById("btn-jump")
    ?.addEventListener("pointerdown", triggerJump);
  document.getElementById("btn-mode")?.addEventListener("pointerdown", () => {
    const mode = toggleGyroMode();
    if (modeLabel)
      modeLabel.textContent = mode === "pursuer" ? "追捕者" : "地形";
  });
  document
    .getElementById("btn-grab")
    ?.addEventListener("pointerdown", grabBlock);
}

// === Fullscreen / Orientation Lock Guards ===
function initOrientationGuards() {
  const promptEl = document.getElementById("fullscreen-prompt");
  const btn = document.getElementById("fullscreen-prompt-btn");

  function showPrompt() {
    if (promptEl) promptEl.classList.remove("hidden");
  }
  function hidePrompt() {
    if (promptEl) promptEl.classList.add("hidden");
  }

  if (btn) {
    btn.addEventListener("click", async () => {
      hidePrompt();
      await requestLandscape();
    });
  }

  // If user exits fullscreen, show prompt
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      showPrompt();
    } else {
      hidePrompt();
    }
  });

  // If orientation flips to portrait while in-game, try to re-lock
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      const isPortrait = window.innerWidth < window.innerHeight;
      if (isPortrait && (document.fullscreenElement || document.webkitFullscreenElement)) {
        requestLandscape().catch(() => showPrompt());
      }
    }, 300);
  });
}

export function updateUI(delta) {
  if (!gameRunning || gameOver) return;

  timeRemaining -= delta;
  if (timeRemaining <= 0) {
    timeRemaining = 0;
    endGame("time");
    return;
  }

  // Timer display
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.floor(timeRemaining % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  if (timeRemaining < 60) {
    timerEl.parentElement?.classList.add("warning");
  }

  // Score / Lives display
  score = getCollectedCount();
  scoreEl.textContent = score;
  livesEl.textContent = lives;

  // Check pursuer catch
  if (wasPlayerCaught()) {
    lives -= 1;
    livesEl.textContent = lives;
    triggerJournal("first_caught");
    if (lives < 1) {
      playGameOver();
      endGame("caught");
      return;
    }
    playAlert();
  }

  // Alert when being chased (every 2 seconds)
  if (isChasing() && Math.floor(timeRemaining * 2) % 4 === 0) {
    // playAlert is called less frequently to avoid spam
  }

  // First move trigger
  if (!firstMoveTriggered) {
    firstMoveTriggered = true;
    setTimeout(() => triggerJournal("first_move"), 2000);
  }
}

export function endGame(reason) {
  gameOver = true;
  gameRunning = false;
  score = getTotalCollectedEver(); // 使用"曾收集到的最大数量"
  endScreen.classList.remove("hidden");

  const line1 =
    reason === "win" ? "恭喜你" : reason === "caught" ? "您被抓住了" : "时间到";
  let line2 = "";

  if (score >= getTotalFragments()) {
    line2 = "你发现了所有秘密";
    endTitle.style.color = "#ffd700";
    triggerJournal("all_fragments");
  } else if (score > 0) {
    line2 = `你发现了${score}个秘密`;
    endTitle.style.color = "#ffaa44";
  } else {
    line2 = "未能收集到碎片";
    endTitle.style.color = "#ff6666";
  }

  endTitle.innerHTML = `${line1}<br>${line2}`;
  endScore.textContent = `收集碎片: ${score}/${getTotalFragments()}`;
  endJournalHint.textContent = "按 Tab 查看你发现的观察日志";
}

export function resetUI() {
  timeRemaining = 360;
  gameRunning = false;
  gameOver = false;
  lives = 1;
  score = 0;
  firstMoveTriggered = false;
  scoreEl.textContent = "0";
  livesEl.textContent = "1";
  timerEl.textContent = "6:00";
  timerEl.parentElement?.classList.remove("warning");
  endScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  if (countdownOverlay) countdownOverlay.classList.add("hidden");
}

export function getTimeRemaining() {
  return timeRemaining;
}
export function isGameRunning() {
  return gameRunning;
}
export function isGameOver() {
  return gameOver;
}
export function onRestart(cb) {
  onRestartCallback = cb;
}
export function onStart(cb) {
  onStartCallback = cb;
}

// Force-refresh score & lives display (call after fragment collect/consume)
export function refreshScoreDisplay() {
  score = getCollectedCount();
  if (scoreEl) scoreEl.textContent = score;
  if (livesEl) livesEl.textContent = lives;
}

export { isMobile };
