import {
  getCollectedCount,
  getTotalCollectedEver,
  getTotalFragments,
} from "./fragments.js";
import { wasPlayerCaught, isChasing } from "./pursuer.js";
import {
  toggleGyroMode,
  getGyroMode,
  pcGyroPulse,
  requestGyroPermission,
} from "./gyro.js";
import {
  setKey,
  setJoystick,
  triggerJump,
  placeBlockAction,
  grabBlockAction,
  getPlayerPosition,
} from "./player.js";
import { triggerJournal } from "./journal.js";
import { showReview, hideReview, isReviewVisible } from "./journal.js";
import { playAlert, playVictory, playGameOver } from "./audio.js";

// === Fullscreen + Landscape Lock ===
// Multi-path approach: fullscreen first, then orientation lock.
// CSS rotate-prompt acts as fallback enforcement when neither works.
export async function requestLandscape() {
  // Step 1: try fullscreen (precondition for orientation.lock on Chrome/Android)
  let fsOk = false;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        await Promise.race([
          el.requestFullscreen(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("fs-timeout")), 2000),
          ),
        ]).catch(() => {});
        fsOk = true;
      } else if (el.webkitRequestFullscreen) {
        await Promise.race([
          el.webkitRequestFullscreen(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("fs-timeout")), 2000),
          ),
        ]).catch(() => {});
        fsOk = true;
      }
    } else {
      fsOk = true; // already fullscreen
    }
  } catch (e) {
    // iOS Safari, older browsers — no Fullscreen API
  }

  // Step 2: try orientation lock (modern API)
  try {
    if (screen.orientation && screen.orientation.lock) {
      // Try all landscape variants in order
      await screen.orientation
        .lock("landscape-primary")
        .catch(() => screen.orientation.lock("landscape"))
        .catch(() => screen.orientation.lock("landscape-secondary"))
        .catch(() => {});
    }
  } catch (e) {
    // Not supported
  }

  // Step 3: legacy lockOrientation (very old Android browsers)
  try {
    if (screen.lockOrientation) {
      screen.lockOrientation("landscape-primary");
      // Fallback: screen.lockOrientation('landscape');
    }
  } catch (e) {
    // N/A
  }
}

let timeRemaining = 360; // 6 minutes in seconds
let gameRunning = false;
let gameOver = false;
let paused = false;
let countdownActive = false;
let lives = 1;
let score = 0;
let onRestartCallback = null;
let onStartCallback = null;
let firstMoveTriggered = false;

// DOM elements
let scoreEl, livesEl, timerEl, modeLabel, startScreen, endScreen;
let endTitle, endScore, endJournalHint, restartBtn, startBtn;
let endHonorsEl, homeBtn, honorBtn;
let countdownOverlay, countdownNumber;
let pauseBtn, pauseOverlay, resumeBtn, pauseRestartBtn;
let honorPanel, honorList, honorClose;
let isMobile = false;

const PROGRESS_KEY = "unwinged_progress_v1";
const HONORS = [
  {
    id: "speed_gale",
    cat: "极速收集",
    name: "疾风拾荒者",
    desc: "60秒内集齐3个碎片",
    hidden: false,
  },
  {
    id: "speed_dash",
    cat: "极速收集",
    name: "瞬影收藏家",
    desc: "几乎不停顿地集齐所有碎片",
    hidden: false,
  },
  {
    id: "speed_half",
    cat: "极速收集",
    name: "捷足先登",
    desc: "倒计时过半前集齐碎片并通关",
    hidden: false,
  },
  {
    id: "speed_best_time",
    cat: "极速收集",
    name: "搜捕达人",
    desc: "刷新个人最快集齐记录",
    hidden: false,
  },
  {
    id: "speed_best_speed",
    cat: "极速收集",
    name: "掠影行者",
    desc: "刷新个人最快移动效率记录",
    hidden: false,
  },
  {
    id: "survive_zero",
    cat: "躲避生存",
    name: "绝地求生",
    desc: "0碎片坚持到倒计时结束",
    hidden: false,
  },
  {
    id: "survive_timeout_5",
    cat: "躲避生存",
    name: "熬到终局",
    desc: "连续5局坚持到倒计时结束",
    hidden: false,
  },
  {
    id: "survive_hide",
    cat: "躲避生存",
    name: "苟住全场",
    desc: "几乎不移动并坚持到倒计时结束",
    hidden: false,
  },
  {
    id: "streak_3_5",
    cat: "星级连胜",
    name: "三星霸主",
    desc: "连续5局三星评价",
    hidden: false,
  },
  {
    id: "streak_3_4",
    cat: "星级连胜",
    name: "不败先锋",
    desc: "连续4局三星评价",
    hidden: false,
  },
  {
    id: "count_3_20",
    cat: "星级连胜",
    name: "三星常客",
    desc: "累计20次三星评价",
    hidden: false,
  },
  {
    id: "streak_2plus_5",
    cat: "星级连胜",
    name: "稳步连胜",
    desc: "连续5局二星及以上评价",
    hidden: false,
  },
  {
    id: "fun_zero_3",
    cat: "趣味搞怪",
    name: "碎片绝缘体",
    desc: "连续3局0碎片",
    hidden: false,
  },
  {
    id: "fun_time_lost",
    cat: "趣味搞怪",
    name: "迷路探险家",
    desc: "超时未集齐碎片",
    hidden: false,
  },
  {
    id: "fun_mid_caught",
    cat: "趣味搞怪",
    name: "半途而废",
    desc: "收集1-2个碎片后被抓捕",
    hidden: false,
  },
  {
    id: "fun_lastsec",
    cat: "趣味搞怪",
    name: "捡漏能手",
    desc: "最后5秒集齐碎片通关",
    hidden: false,
  },
  {
    id: "hard_perfect",
    cat: "高阶挑战",
    name: "完美通关",
    desc: "0次被追捕且刷新最快记录",
    hidden: false,
  },
  {
    id: "hard_10s",
    cat: "高阶挑战",
    name: "极限突围",
    desc: "最后10秒内通关",
    hidden: false,
  },
  {
    id: "hard_allround",
    cat: "高阶挑战",
    name: "全能行者",
    desc: "同时达成极速收集与躲避生存",
    hidden: false,
  },
  {
    id: "mystery_1000",
    cat: "高阶挑战",
    name: "???",
    desc: "???",
    hidden: true,
  },
];

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    return {
      gamesPlayed: parsed.gamesPlayed ?? 0,
      bestWinTime: parsed.bestWinTime ?? null,
      bestAvgSpeed: parsed.bestAvgSpeed ?? null,
      streakThreeStar: parsed.streakThreeStar ?? 0,
      streakTwoPlus: parsed.streakTwoPlus ?? 0,
      streakTimeout: parsed.streakTimeout ?? 0,
      streakZero: parsed.streakZero ?? 0,
      totalThreeStar: parsed.totalThreeStar ?? 0,
      unlocked: parsed.unlocked ?? {},
    };
  } catch {
    return {
      gamesPlayed: 0,
      bestWinTime: null,
      bestAvgSpeed: null,
      streakThreeStar: 0,
      streakTwoPlus: 0,
      streakTimeout: 0,
      streakZero: 0,
      totalThreeStar: 0,
      unlocked: {},
    };
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {}
}

function hasUnlocked(id) {
  return !!progress.unlocked?.[id];
}

function unlock(id) {
  if (hasUnlocked(id)) return false;
  progress.unlocked[id] = Date.now();
  return true;
}

function getHonorDisplayName(h) {
  if (h.hidden) return "???";
  return h.name;
}

function renderHonorList() {
  if (!honorList) return;
  const byCat = new Map();
  HONORS.forEach((h) => {
    if (!byCat.has(h.cat)) byCat.set(h.cat, []);
    byCat.get(h.cat).push(h);
  });
  honorList.innerHTML = Array.from(byCat.entries())
    .map(([cat, items]) => {
      const head = `<li class="locked">${cat}</li>`;
      const lis = items
        .map((h) => {
          const unlocked = hasUnlocked(h.id);
          const cls = unlocked ? "" : "locked";
          const name = unlocked ? getHonorDisplayName(h) : "???";
          const desc = unlocked ? h.desc : "???";
          return `<li class="${cls}">${name}：${desc}</li>`;
        })
        .join("");
      return head + lis;
    })
    .join("");
}

function openHonorPanel() {
  if (!honorPanel) return;
  renderHonorList();
  honorPanel.classList.remove("hidden");
}

function closeHonorPanel() {
  honorPanel?.classList.add("hidden");
}

let progress = loadProgress();
let runStats = null;

function resetRunStats() {
  runStats = {
    startedAt: performance.now(),
    lastPos: null,
    distance: 0,
    idleTime: 0,
    chaseStarts: 0,
    wasChasing: false,
  };
}

// 3-2-1 countdown before game starts
function startCountdown() {
  if (countdownActive) return;
  countdownActive = true;
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
      countdownActive = false;
      resetRunStats();
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
  endHonorsEl = document.getElementById("end-honors");
  homeBtn = document.getElementById("home-btn");
  restartBtn = document.getElementById("restart-btn");
  honorBtn = document.getElementById("honor-btn");
  startBtn = document.getElementById("start-btn");
  countdownOverlay = document.getElementById("countdown-overlay");
  countdownNumber = document.getElementById("countdown-number");
  pauseBtn = document.getElementById("pause-btn");
  pauseOverlay = document.getElementById("pause-overlay");
  resumeBtn = document.getElementById("resume-btn");
  pauseRestartBtn = document.getElementById("pause-restart-btn");
  honorPanel = document.getElementById("honor-panel");
  honorList = document.getElementById("honor-list");
  honorClose = document.getElementById("honor-close");

  // Detect mobile
  isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    "ontouchstart" in window;
  if (isMobile) {
    document.getElementById("mobile-controls")?.classList.remove("hidden");
  }

  function startFromHome() {
    if (gameRunning || gameOver || paused || countdownActive) return;
    startScreen.classList.add("hidden");
    // 在用户手势中请求陀螺仪权限（iOS 要求在 transient activation 内调用）
    requestGyroPermission(); // 不 await，避免阻塞倒计时
    requestLandscape();
    startCountdown();
  }
  startBtn.addEventListener("pointerdown", startFromHome);
  startBtn.addEventListener("click", startFromHome);

  homeBtn?.addEventListener("click", () => {
    endScreen.classList.add("hidden");
    closeHonorPanel();
    if (onRestartCallback) onRestartCallback();
  });

  honorBtn?.addEventListener("click", () => openHonorPanel());
  honorClose?.addEventListener("click", () => closeHonorPanel());

  // Restart button
  restartBtn.addEventListener("click", () => {
    endScreen.classList.add("hidden");
    if (onRestartCallback) onRestartCallback();
    startScreen?.classList.add("hidden");
    requestLandscape();
    requestGyroPermission();
    startCountdown();
  });

  pauseBtn?.addEventListener("click", () => {
    if (!gameRunning || gameOver) return;
    setPaused(!paused);
  });
  resumeBtn?.addEventListener("click", () => setPaused(false));
  pauseRestartBtn?.addEventListener("click", () => {
    setPaused(false);
    if (onRestartCallback) onRestartCallback();
    startScreen?.classList.add("hidden");
    requestLandscape();
    requestGyroPermission();
    startCountdown();
  });

  // Keyboard input
  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyQ") {
      const mode = toggleGyroMode();
      modeLabel.textContent = mode === "pursuer" ? "追捕者" : "地形";
    }
    if (e.code === "Escape") {
      if (gameRunning && !gameOver) setPaused(!paused);
    }
    if (e.code === "KeyE") {
      placeBlockAction();
    }
    if (e.code === "KeyF") {
      grabBlockAction();
    }
    if (e.code === "Tab") {
      e.preventDefault();
      if (isReviewVisible()) hideReview();
      else showReview();
    }
    if (e.code === "Space") e.preventDefault();

    // PC gyro: Ctrl+Arrow to simulate gyro tilt
    if (e.ctrlKey) {
      const dirMap = {
        ArrowUp: { x: 0, z: 1 },
        ArrowDown: { x: 0, z: -1 },
        ArrowLeft: { x: -1, z: 0 },
        ArrowRight: { x: 1, z: 0 },
      };
      if (dirMap[e.code]) {
        e.preventDefault();
        pcGyroPulse(dirMap[e.code]);
        return;
      }
    }

    setKey(e.code, true);
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
    .getElementById("btn-place")
    ?.addEventListener("pointerdown", placeBlockAction);
  document
    .getElementById("btn-grab")
    ?.addEventListener("pointerdown", grabBlockAction);
}

// === Orientation Lock Guards ===
// Primary enforcement: CSS rotate-prompt overlay blocks game when portrait.
// JS orientation.lock() is best-effort (needs fullscreen, which doesn't work on iOS).
function initOrientationGuards() {
  const rotatePrompt = document.getElementById("rotate-prompt");
  const fullscreenPrompt = document.getElementById("fullscreen-prompt");

  function showRotate() {
    document.body.classList.add("portrait-lock");
    if (rotatePrompt) rotatePrompt.style.display = "flex";
  }
  function hideRotate() {
    document.body.classList.remove("portrait-lock");
    if (rotatePrompt) rotatePrompt.style.display = "none";
  }
  function showFsPrompt() {
    if (fullscreenPrompt) fullscreenPrompt.classList.remove("hidden");
  }
  function hideFsPrompt() {
    if (fullscreenPrompt) fullscreenPrompt.classList.add("hidden");
  }

  // Core handler: check orientation and enforce
  function handleOrientationChange() {
    setTimeout(() => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const isPortrait = W < H;
      const isMobile = W < 768 || H < 768;

      const isStartVisible =
        startScreen && !startScreen.classList.contains("hidden");
      const shouldLock = (gameRunning || countdownActive) && !isStartVisible;

      if (isPortrait && isMobile && shouldLock) {
        showRotate();
        // Best-effort: try to re-lock (works if still in fullscreen)
        requestLandscape();
      } else {
        hideRotate();
      }
    }, 150);
  }

  // Fullscreen exit → show fullscreen-prompt
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      showFsPrompt();
    } else {
      hideFsPrompt();
    }
  });

  // Fullscreen prompt button → retry
  const fsBtn = document.getElementById("fullscreen-prompt-btn");
  if (fsBtn) {
    fsBtn.addEventListener("click", async () => {
      hideFsPrompt();
      await requestLandscape();
      handleOrientationChange();
    });
  }

  // === Multi-layer orientation detection ===
  // Layer 1: screen.orientation.change (fastest, modern)
  if (screen.orientation) {
    screen.orientation.addEventListener("change", handleOrientationChange);
  }
  // Layer 2: window.orientationchange (legacy, widely supported)
  window.addEventListener("orientationchange", handleOrientationChange);
  // Layer 3: window.resize (final fallback)
  window.addEventListener("resize", handleOrientationChange);

  // Initial check
  handleOrientationChange();
}

export function updateUI(delta) {
  if (!gameRunning || gameOver || paused) return;

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

  if (runStats) {
    const pos = getPlayerPosition();
    if (runStats.lastPos) {
      const dist = pos.distanceTo(runStats.lastPos);
      runStats.distance += dist;
      const speed = delta > 0 ? dist / delta : 0;
      if (speed < 0.05) runStats.idleTime += delta;
    }
    runStats.lastPos = pos;
    const chasing = isChasing();
    if (chasing && !runStats.wasChasing) runStats.chaseStarts += 1;
    runStats.wasChasing = chasing;
  }

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
  paused = false;
  pauseOverlay?.classList.add("hidden");
  score = getTotalCollectedEver(); // 使用"曾收集到的最大数量"
  endScreen.classList.remove("hidden");

  const totalFragments = getTotalFragments();
  const starCount = Math.max(0, Math.min(score, totalFragments));
  const centerIdx = Math.floor(totalFragments / 2);
  const starsHtml = Array.from({ length: totalFragments }, (_, i) => {
    const cls = [
      "end-star",
      i < starCount ? "filled" : "empty",
      i === centerIdx ? "center" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<span class="${cls}">★</span>`;
  }).join("");
  const totalTime = 360;
  const fragmentsRatio = totalFragments > 0 ? starCount / totalFragments : 0;
  const timeUsed = Math.max(0, Math.min(totalTime, totalTime - timeRemaining));
  const timeRatio = 1 - timeUsed / totalTime;
  let performance = 0.75 * fragmentsRatio + 0.25 * timeRatio;
  if (reason === "caught") performance *= 0.85;
  if (reason === "time") performance *= 0.7;
  const percentile = Math.max(
    1,
    Math.min(99, Math.round(1 + performance * 98)),
  );

  progress.gamesPlayed += 1;

  if (starCount >= totalFragments && totalFragments > 0) {
    progress.streakThreeStar += 1;
    progress.totalThreeStar += 1;
  } else {
    progress.streakThreeStar = 0;
  }
  if (starCount >= 2) progress.streakTwoPlus += 1;
  else progress.streakTwoPlus = 0;
  if (starCount === 0) progress.streakZero += 1;
  else progress.streakZero = 0;
  if (reason === "time") progress.streakTimeout += 1;
  else progress.streakTimeout = 0;

  const avgSpeed = timeUsed > 0 ? (runStats?.distance ?? 0) / timeUsed : 0;
  const prevBestTime = progress.bestWinTime;
  const prevBestSpeed = progress.bestAvgSpeed;
  const isWin =
    reason === "win" && starCount >= totalFragments && totalFragments > 0;
  const isNewBestTime =
    isWin && (prevBestTime === null || timeUsed < prevBestTime);
  const isNewBestSpeed =
    isWin && (prevBestSpeed === null || avgSpeed > prevBestSpeed);
  if (isNewBestTime) progress.bestWinTime = timeUsed;
  if (isNewBestSpeed) progress.bestAvgSpeed = avgSpeed;

  const newlyUnlocked = [];
  if (isWin && timeUsed <= 60 && unlock("speed_gale"))
    newlyUnlocked.push("speed_gale");
  if (isWin && (runStats?.idleTime ?? 999) <= 2.0 && unlock("speed_dash"))
    newlyUnlocked.push("speed_dash");
  if (isWin && timeRemaining >= 180 && unlock("speed_half"))
    newlyUnlocked.push("speed_half");
  if (isNewBestTime && unlock("speed_best_time"))
    newlyUnlocked.push("speed_best_time");
  if (isNewBestSpeed && unlock("speed_best_speed"))
    newlyUnlocked.push("speed_best_speed");

  if (reason === "time" && starCount === 0 && unlock("survive_zero"))
    newlyUnlocked.push("survive_zero");
  if (
    reason === "time" &&
    (runStats?.distance ?? 999) <= 10 &&
    unlock("survive_hide")
  )
    newlyUnlocked.push("survive_hide");
  if (progress.streakTimeout >= 5 && unlock("survive_timeout_5"))
    newlyUnlocked.push("survive_timeout_5");

  if (progress.streakThreeStar >= 4 && unlock("streak_3_4"))
    newlyUnlocked.push("streak_3_4");
  if (progress.streakThreeStar >= 5 && unlock("streak_3_5"))
    newlyUnlocked.push("streak_3_5");
  if (progress.totalThreeStar >= 20 && unlock("count_3_20"))
    newlyUnlocked.push("count_3_20");
  if (progress.streakTwoPlus >= 5 && unlock("streak_2plus_5"))
    newlyUnlocked.push("streak_2plus_5");

  if (progress.streakZero >= 3 && unlock("fun_zero_3"))
    newlyUnlocked.push("fun_zero_3");
  if (
    reason === "time" &&
    starCount > 0 &&
    starCount < totalFragments &&
    unlock("fun_time_lost")
  )
    newlyUnlocked.push("fun_time_lost");
  if (
    reason === "caught" &&
    starCount >= 1 &&
    starCount <= 2 &&
    unlock("fun_mid_caught")
  )
    newlyUnlocked.push("fun_mid_caught");
  if (isWin && timeRemaining <= 5 && unlock("fun_lastsec"))
    newlyUnlocked.push("fun_lastsec");

  if (
    isWin &&
    (runStats?.chaseStarts ?? 0) === 0 &&
    isNewBestTime &&
    unlock("hard_perfect")
  )
    newlyUnlocked.push("hard_perfect");
  if (isWin && timeRemaining <= 10 && unlock("hard_10s"))
    newlyUnlocked.push("hard_10s");

  const hasSpeedHonor = [
    "speed_gale",
    "speed_dash",
    "speed_half",
    "speed_best_time",
    "speed_best_speed",
  ].some((id) => hasUnlocked(id) || newlyUnlocked.includes(id));
  const hasSurviveHonor = [
    "survive_zero",
    "survive_timeout_5",
    "survive_hide",
  ].some((id) => hasUnlocked(id) || newlyUnlocked.includes(id));
  if (hasSpeedHonor && hasSurviveHonor && unlock("hard_allround"))
    newlyUnlocked.push("hard_allround");

  if (progress.gamesPlayed >= 1000 && unlock("mystery_1000"))
    newlyUnlocked.push("mystery_1000");

  saveProgress();
  renderHonorList();

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
  endScore.innerHTML = `收集碎片: ${score}/${totalFragments}<br><span class="end-stars">${starsHtml}</span>`;
  endJournalHint.textContent = `你打败了全国${percentile}%的玩家！`;
  if (endHonorsEl) {
    if (newlyUnlocked.length) {
      const names = newlyUnlocked
        .map((id) => HONORS.find((h) => h.id === id))
        .filter(Boolean)
        .map((h) => getHonorDisplayName(h))
        .join("、");
      endHonorsEl.innerHTML = newlyUnlocked
        .map((id) => HONORS.find((h) => h.id === id))
        .filter(Boolean)
        .map((h) => `<span class="end-honor">${getHonorDisplayName(h)}</span>`)
        .join("");
    } else {
      endHonorsEl.textContent = "";
    }
  }
}

export function resetUI() {
  timeRemaining = 360;
  gameRunning = false;
  gameOver = false;
  paused = false;
  lives = 1;
  score = 0;
  firstMoveTriggered = false;
  scoreEl.textContent = "0";
  livesEl.textContent = "1";
  timerEl.textContent = "6:00";
  timerEl.parentElement?.classList.remove("warning");
  endScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  endHonorsEl && (endHonorsEl.textContent = "");
  closeHonorPanel();
  if (countdownOverlay) countdownOverlay.classList.add("hidden");
  pauseOverlay?.classList.add("hidden");
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
export function isPaused() {
  return paused;
}

export function setPaused(v) {
  paused = !!v;
  if (pauseOverlay) {
    if (paused) pauseOverlay.classList.remove("hidden");
    else pauseOverlay.classList.add("hidden");
  }
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
