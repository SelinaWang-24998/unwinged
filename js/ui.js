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
  requestRecalibration,
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
import { isVoiceShowing, getVoiceHistory } from "./voice.js";
import { playAlert, playVictory, playGameOver } from "./audio.js";

const isByteDanceWebView = /aweme|ttwebview|toutiao|bytedance/i.test(
  navigator.userAgent || "",
);
function canFullscreen() {
  const el = document.documentElement;
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

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
let countdownIntervalId = null;
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
let pauseBtn, pauseOverlay, resumeBtn, pauseRestartBtn, pauseEndBtn;
let honorPanel, honorList, honorClose;
let leaderboardPanel,
  leaderboardList,
  leaderboardClose,
  leaderboardShare,
  leaderboardTabs;
let fullscreenPrompt;
let isMobile = false;
let lastGameStats = null; // stored after each game for leaderboard

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
  } catch (e) {
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

let progress = loadProgress();

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {}
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

// === Leaderboard ===
const FAKE_NAMES = [
  "海岛探险家",
  "追风者",
  "碎片猎人",
  "无畏行者",
  "星语者",
  "影之舞者",
  "深海旅人",
  "林间漫步",
  "风暴之子",
  "孤岛守望",
  "逐光者",
  "风语者",
  "夜航船",
  "潮汐之力",
  "星轨",
];

function buildLeaderboardData(tab) {
  const p = progress;
  const entries = [];
  // Player entry
  const me = { name: "我", isMe: true };
  if (tab === "time") {
    me.score =
      p.bestWinTime != null ? `${p.bestWinTime.toFixed(1)}s` : "无记录";
    me.val = p.bestWinTime ?? Infinity;
  } else if (tab === "stars") {
    me.score = `${p.totalThreeStar} 次三星`;
    me.val = p.totalThreeStar;
  } else {
    const unlocked = p.unlocked ? Object.keys(p.unlocked).length : 0;
    me.score = `${unlocked} 个荣誉`;
    me.val = unlocked;
  }

  // Generate fake entries around player's level
  const seed = p.gamesPlayed || 1;
  for (let i = 0; i < 9; i++) {
    const nameIdx = Math.floor(((seed + i * 7) * 0.618) % FAKE_NAMES.length);
    let val;
    if (tab === "time") {
      val =
        p.bestWinTime != null
          ? p.bestWinTime * (0.65 + ((seed + i * 13) % 100) / 200)
          : 120 + ((seed + i * 11) % 200);
    } else if (tab === "stars") {
      val = Math.max(
        0,
        p.totalThreeStar + Math.floor(((seed + i * 5) % 9) - 4),
      );
    } else {
      const unlocked = p.unlocked ? Object.keys(p.unlocked).length : 0;
      val = Math.max(0, unlocked + Math.floor(((seed + i * 3) % 7) - 3));
    }
    entries.push({ name: FAKE_NAMES[nameIdx], score: "", val, isMe: false });
  }
  entries.push(me);
  // Sort: lower time better, higher stars/honors better
  if (tab === "time") entries.sort((a, b) => a.val - b.val);
  else entries.sort((a, b) => b.val - a.val);
  // Format scores after sort
  entries.forEach((e, i) => {
    if (!e.score) {
      e.score = tab === "time" ? `${e.val.toFixed(1)}s` : `${e.val}`;
    }
    e.rank = i + 1;
  });
  return entries;
}

function renderLeaderboard(tab) {
  if (!leaderboardList) return;
  const entries = buildLeaderboardData(tab);
  leaderboardList.innerHTML = entries
    .map((e) => {
      const rankCls = e.rank <= 3 ? " top" : "";
      const youCls = e.isMe ? " lb-you" : "";
      return `<li class="${youCls}">
      <span class="lb-rank${rankCls}">${e.rank}</span>
      <span class="lb-name">${e.name}</span>
      <span class="lb-score">${e.score}</span>
    </li>`;
    })
    .join("");
  // Update tab active state
  if (leaderboardTabs) {
    leaderboardTabs.querySelectorAll(".lb-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
  }
}

function openLeaderboard() {
  if (!leaderboardPanel) return;
  renderLeaderboard("time");
  leaderboardPanel.classList.remove("hidden");
}

function closeLeaderboard() {
  leaderboardPanel?.classList.add("hidden");
}

async function shareLeaderboard() {
  const p = progress;
  const honors = p.unlocked ? Object.keys(p.unlocked).length : 0;
  const text = [
    "🏝️ 插翅难飞 — 我的游戏记录",
    `⭐ 三星通关: ${p.totalThreeStar} 次`,
    `🏆 荣誉: ${honors} 个`,
    `🎮 游戏局数: ${p.gamesPlayed}`,
    p.bestWinTime ? `⚡ 最快通关: ${p.bestWinTime.toFixed(1)}s` : "",
    "",
    "你能超越我吗？",
  ]
    .filter(Boolean)
    .join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: "插翅难飞", text });
    } catch (e) {
      /* user cancelled */
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      alert("已复制到剪贴板！");
    } catch (e) {
      prompt("复制以下内容分享:", text);
    }
  }
}
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

  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }

  countdownIntervalId = setInterval(() => {
    count--;
    if (count > 0) {
      countdownNumber.textContent = count;
      // Re-trigger pop animation
      countdownNumber.style.animation = "none";
      void countdownNumber.offsetHeight; // force reflow
      countdownNumber.style.animation = "countPop 0.6s ease-out";
    } else {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
      countdownOverlay.classList.add("hidden");
      gameRunning = true;
      countdownActive = false;
      resetRunStats();
      if (onStartCallback) onStartCallback();
    }
  }, 1000);
}

export function initUI() {
  try {
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
  pauseEndBtn = document.getElementById("pause-end-btn");
  honorPanel = document.getElementById("honor-panel");
  honorList = document.getElementById("honor-list");
  honorClose = document.getElementById("honor-close");
  leaderboardPanel = document.getElementById("leaderboard-panel");
  leaderboardList = document.getElementById("leaderboard-list");
  leaderboardClose = document.getElementById("leaderboard-close");
  leaderboardShare = document.getElementById("leaderboard-share");
  leaderboardTabs = document.getElementById("leaderboard-tabs");
  fullscreenPrompt = document.getElementById("fullscreen-prompt");
  const leaderboardBtn = document.getElementById("leaderboard-btn");

  let lastPointerActionAt = 0;

  // Detect mobile
  isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    "ontouchstart" in window;
  if (isMobile) {
    document.getElementById("mobile-controls")?.classList.remove("hidden");
    document.getElementById("keyboard-viz")?.classList.add("hidden");
  }

  function shouldAcceptPointerAction() {
    const now = performance.now();
    if (now - lastPointerActionAt < 300) return false;
    lastPointerActionAt = now;
    return true;
  }

  async function ensureMobileFullscreenLandscape() {
    if (!isMobile) return;
    await requestLandscape();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const isPortrait = W < H;
    const rotatePrompt = document.getElementById("rotate-prompt");
    if (isPortrait) {
      document.body.classList.add("portrait-lock");
      if (rotatePrompt) rotatePrompt.style.display = "flex";
    } else {
      document.body.classList.remove("portrait-lock");
      if (rotatePrompt) rotatePrompt.style.display = "none";
    }
    const isFs =
      !!document.fullscreenElement || !!document.webkitFullscreenElement;
    if (isByteDanceWebView || !canFullscreen()) {
      if (fullscreenPrompt) fullscreenPrompt.classList.add("hidden");
    } else if (!isFs) {
      if (fullscreenPrompt) fullscreenPrompt.classList.remove("hidden");
    }
  }

  async function startFromHome() {
    if (gameRunning || gameOver || paused || countdownActive) return;
    console.log("点击进入岛屿，startFromHome 运行");
    try {
      // 在用户手势中请求陀螺仪权限（iOS 要求在 transient activation 内调用）
      requestGyroPermission(); // 不 await，避免阻塞倒计时
      ensureMobileFullscreenLandscape(); // 不阻塞倒计时，尽力争就好
      startScreen.classList.add("hidden");
      console.log("准备 startCountdown");
      startCountdown();
    } catch (err) {
      console.error("startFromHome 出错:", err);
      alert("启动失败: " + err.message);
    }
  }
  startBtn.addEventListener("click", (e) => {
    e.preventDefault();
    startFromHome();
  });

  function goHome() {
    endScreen.classList.add("hidden");
  closeHonorPanel();
  closeLeaderboard();
  hideJournalReview();
    if (onRestartCallback) onRestartCallback();
  }

  homeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    goHome();
  });

  honorBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    openHonorPanel();
  });
  honorClose?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    closeHonorPanel();
  });

  leaderboardBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    openLeaderboard();
  });
  leaderboardClose?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    closeLeaderboard();
  });
  leaderboardShare?.addEventListener("click", () => shareLeaderboard());
  leaderboardTabs?.addEventListener("click", (e) => {
    const tab = e.target.closest(".lb-tab")?.dataset.tab;
    if (tab) renderLeaderboard(tab);
  });

  // Restart button
  async function restartRun() {
    if (onRestartCallback) onRestartCallback();
    requestGyroPermission();
    await ensureMobileFullscreenLandscape();
    endScreen.classList.add("hidden");
    startScreen?.classList.add("hidden");
    startCountdown();
  }
  restartBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    restartRun();
  });

  pauseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    if (!gameRunning || gameOver) return;
    setPaused(!paused);
  });
  resumeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    setPaused(false);
  });
  pauseRestartBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    (async () => {
      setPaused(false);
      if (onRestartCallback) onRestartCallback();
      requestGyroPermission();
      await ensureMobileFullscreenLandscape();
      startScreen?.classList.add("hidden");
      startCountdown();
    })();
  });

  function endRunFromPause() {
    if (!gameRunning || gameOver) return;
    endGame("quit");
  }
  pauseEndBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    endRunFromPause();
  });

  // Recalibrate gyro button in pause menu
  const recalibrateBtn = document.getElementById("recalibrate-btn");
  recalibrateBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!shouldAcceptPointerAction()) return;
    requestRecalibration();
  });

  // Keyboard visualizer helper
  function updateKeyViz(code, pressed) {
    const el = document.querySelector(`#keyboard-viz [data-key="${code}"]`);
    if (el) el.classList.toggle("active", pressed);
    if (code === "ControlLeft" || code === "ControlRight") {
      const ctrl = document.querySelector("#keyboard-viz .mod-key");
      if (ctrl) ctrl.classList.toggle("active", pressed);
    }
  }

  // Keyboard input
  document.addEventListener("keydown", (e) => {
    updateKeyViz(e.code, true);
    if (e.code === "KeyQ") {
      const mode = toggleGyroMode();
      modeLabel.textContent = mode === "pursuer" ? "追捕者" : "地形";
    }
    if (e.code === "Escape") {
      if (isJournalReviewVisible()) {
        hideJournalReview();
      } else if (gameRunning && !gameOver) setPaused(!paused);
    }
    if (e.code === "KeyE") {
      placeBlockAction();
    }
    if (e.code === "KeyF") {
      grabBlockAction();
    }
    if (e.code === "Tab") {
      e.preventDefault();
      toggleJournalReview();
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
    updateKeyViz(e.code, false);
    setKey(e.code, false);
  });

  // Mobile joystick
  if (isMobile) setupJoystick();
  setupMobileButtons();
  initOrientationGuards();

  // Monster journal review close button
  const journalReviewPanel = document.getElementById('journal-review');
  const journalReviewClose = document.getElementById('journal-close');
  journalReviewClose?.addEventListener('click', (e) => {
    e.preventDefault();
    hideJournalReview();
  });
  } catch(err) {
    console.error("initUI() 失败:", err);
    alert("initUI() 失败: " + err.message);
  }
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
      if (isPortrait && isMobile) showRotate();
      else hideRotate();

      const isFs =
        !!document.fullscreenElement || !!document.webkitFullscreenElement;
      if (!isMobile || isByteDanceWebView || !canFullscreen()) {
        hideFsPrompt();
        return;
      }
      if (!isFs) showFsPrompt();
      else hideFsPrompt();
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
    fsBtn.addEventListener("click", async (e) => {
      e.preventDefault();
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
  countdownActive = false;
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  pauseOverlay?.classList.add("hidden");
  countdownOverlay?.classList.add("hidden");
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
  const earnedThisRun = []; // All honors whose conditions were met this run (for display)

  if (isWin && timeUsed <= 60) {
    earnedThisRun.push("speed_gale");
    if (unlock("speed_gale")) newlyUnlocked.push("speed_gale");
  }
  if (isWin && (runStats?.idleTime ?? 999) <= 2.0) {
    earnedThisRun.push("speed_dash");
    if (unlock("speed_dash")) newlyUnlocked.push("speed_dash");
  }
  if (isWin && timeRemaining >= 180) {
    earnedThisRun.push("speed_half");
    if (unlock("speed_half")) newlyUnlocked.push("speed_half");
  }
  if (isNewBestTime) {
    earnedThisRun.push("speed_best_time");
    if (unlock("speed_best_time")) newlyUnlocked.push("speed_best_time");
  }
  if (isNewBestSpeed) {
    earnedThisRun.push("speed_best_speed");
    if (unlock("speed_best_speed")) newlyUnlocked.push("speed_best_speed");
  }

  if (reason === "time" && starCount === 0) {
    earnedThisRun.push("survive_zero");
    if (unlock("survive_zero")) newlyUnlocked.push("survive_zero");
  }
  if (reason === "time" && (runStats?.distance ?? 999) <= 10) {
    earnedThisRun.push("survive_hide");
    if (unlock("survive_hide")) newlyUnlocked.push("survive_hide");
  }
  if (progress.streakTimeout >= 5) {
    earnedThisRun.push("survive_timeout_5");
    if (unlock("survive_timeout_5")) newlyUnlocked.push("survive_timeout_5");
  }

  if (progress.streakThreeStar >= 4) {
    earnedThisRun.push("streak_3_4");
    if (unlock("streak_3_4")) newlyUnlocked.push("streak_3_4");
  }
  if (progress.streakThreeStar >= 5) {
    earnedThisRun.push("streak_3_5");
    if (unlock("streak_3_5")) newlyUnlocked.push("streak_3_5");
  }
  if (progress.totalThreeStar >= 20) {
    earnedThisRun.push("count_3_20");
    if (unlock("count_3_20")) newlyUnlocked.push("count_3_20");
  }
  if (progress.streakTwoPlus >= 5) {
    earnedThisRun.push("streak_2plus_5");
    if (unlock("streak_2plus_5")) newlyUnlocked.push("streak_2plus_5");
  }

  if (progress.streakZero >= 3) {
    earnedThisRun.push("fun_zero_3");
    if (unlock("fun_zero_3")) newlyUnlocked.push("fun_zero_3");
  }
  if (reason === "time" && starCount > 0 && starCount < totalFragments) {
    earnedThisRun.push("fun_time_lost");
    if (unlock("fun_time_lost")) newlyUnlocked.push("fun_time_lost");
  }
  if (reason === "caught" && starCount >= 1 && starCount <= 2) {
    earnedThisRun.push("fun_mid_caught");
    if (unlock("fun_mid_caught")) newlyUnlocked.push("fun_mid_caught");
  }
  if (isWin && timeRemaining <= 5) {
    earnedThisRun.push("fun_lastsec");
    if (unlock("fun_lastsec")) newlyUnlocked.push("fun_lastsec");
  }

  if (isWin && (runStats?.chaseStarts ?? 0) === 0 && isNewBestTime) {
    earnedThisRun.push("hard_perfect");
    if (unlock("hard_perfect")) newlyUnlocked.push("hard_perfect");
  }
  if (isWin && timeRemaining <= 10) {
    earnedThisRun.push("hard_10s");
    if (unlock("hard_10s")) newlyUnlocked.push("hard_10s");
  }

  const hasSpeedHonor = [
    "speed_gale", "speed_dash", "speed_half",
    "speed_best_time", "speed_best_speed",
  ].some((id) => hasUnlocked(id) || newlyUnlocked.includes(id));
  const hasSurviveHonor = [
    "survive_zero", "survive_timeout_5", "survive_hide",
  ].some((id) => hasUnlocked(id) || newlyUnlocked.includes(id));
  if (hasSpeedHonor && hasSurviveHonor) {
    earnedThisRun.push("hard_allround");
    if (unlock("hard_allround")) newlyUnlocked.push("hard_allround");
  }

  if (progress.gamesPlayed >= 1000) {
    earnedThisRun.push("mystery_1000");
    if (unlock("mystery_1000")) newlyUnlocked.push("mystery_1000");
  }

  saveProgress();
  renderHonorList();

  const line1 =
    reason === "win"
      ? "恭喜你"
      : reason === "caught"
        ? "您被抓住了"
        : reason === "quit"
          ? "已结束"
          : "时间到";
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
    if (earnedThisRun.length) {
      endHonorsEl.innerHTML = earnedThisRun
        .map((id) => {
          const h = HONORS.find((hh) => hh.id === id);
          if (!h) return "";
          const isNew = newlyUnlocked.includes(id);
          const cls = isNew ? "end-honor" : "end-honor owned";
          return `<span class="${cls}">${getHonorDisplayName(h)}</span>`;
        })
        .filter(Boolean)
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
  countdownActive = false;
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
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

// Show a dramatic fullscreen message (e.g. "深埋地底的宝藏啊，听从我的召唤吧")
export function showGameMessage(text, duration = 3000) {
  let el = document.getElementById("game-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "game-message";
    el.style.cssText = [
      "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000",
      "display:flex;align-items:center;justify-content:center;pointer-events:none",
    ].join(";");
    const inner = document.createElement("div");
    inner.id = "game-message-text";
    inner.style.cssText = [
      "color:#ffd700;font-size:22px;font-weight:700;text-align:center",
      "text-shadow:0 0 20px rgba(255,200,0,0.8),0 0 40px rgba(255,150,0,0.4)",
      "padding:20px 30px;max-width:80%;line-height:1.6",
      "opacity:0;transform:scale(0.8);transition:opacity 0.5s,transform 0.5s",
    ].join(";");
    el.appendChild(inner);
    document.body.appendChild(el);
  }
  const inner = document.getElementById("game-message-text");
  if (inner) {
    inner.textContent = text;
    inner.style.opacity = "1";
    inner.style.transform = "scale(1)";
  }
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    if (inner) {
      inner.style.opacity = "0";
      inner.style.transform = "scale(0.8)";
    }
  }, duration - 500);
}

export { isMobile };

// === Monster Journal Review Panel ===
function showJournalReview() {
  const panel = document.getElementById('journal-review');
  const list = document.getElementById('journal-review-list');
  if (!panel || !list) return;

  const history = getVoiceHistory();
  if (history.length === 0) {
    list.innerHTML = '<li style="color:#666;font-style:normal;">暂无记录</li>';
  } else {
    list.innerHTML = history.map((text, i) =>
      `<li>${i + 1}. ${text}</li>`
    ).join('');
  }
  panel.classList.remove('hidden');
}

function hideJournalReview() {
  const panel = document.getElementById('journal-review');
  if (panel) panel.classList.add('hidden');
}

export function toggleJournalReview() {
  const panel = document.getElementById('journal-review');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    showJournalReview();
  } else {
    hideJournalReview();
  }
}

export function isJournalReviewVisible() {
  const panel = document.getElementById('journal-review');
  return panel ? !panel.classList.contains('hidden') : false;
}
