// Hint System - Process-driven hint system
// Design principle: Hints are not tutorials, they are the world speaking.
import { triggerJournal } from "./journal.js";
import { getPlayerPosition } from "./player.js";
import { getGyroMode, isCalibrated } from "./gyro.js";
import { getCollectedCount, getTotalFragments } from "./fragments.js";

const HINTS = [
  {
    id: "T1",
    condition: (state) =>
      state.hasSeenFragment &&
      !state.hasCollectedFragment &&
      state.timeSinceLastMove > 10,
    message: "ta看到了什么，却没有停留。",
    priority: 3,
    cooldown: 20,
    type: "voice", // 追捕者心声
  },
  {
    id: "T9",
    condition: (state) => state.timeSinceStart < 15 && !state.hasMoved,
    message: "身体微倾，世界亦随之偏转。",
    priority: 1,
    cooldown: 15,
    type: "hud", // HUD短句
  },
  {
    id: "T10",
    condition: (state) => state.timeSinceStart < 30 && !state.hasUsedGyro,
    message: "你的意志可以改变脚下的大地。",
    priority: 2,
    cooldown: 15,
    type: "hud",
  },
];

class HintSystem {
  constructor() {
    this.state = {
      timeSinceStart: 0,
      timeSinceLastMove: 0,
      hasMoved: false,
      hasUsedGyro: false,
      hasSeenFragment: false,
      hasCollectedFragment: false,
      lastHintTime: 0,
    };
    this.hintCooldowns = {};
    this.globalCooldown = 12; // 全局冷却12秒
  }

  trackPlayerState(delta) {
    this.state.timeSinceStart += delta;
    const playerPos = getPlayerPosition();
    if (playerPos) {
      if (!this.lastPlayerPos) {
        this.lastPlayerPos = playerPos.clone();
      }
      const dist = playerPos.distanceTo(this.lastPlayerPos);
      if (dist > 0.1) {
        this.state.hasMoved = true;
        this.state.timeSinceLastMove = 0;
      } else {
        this.state.timeSinceLastMove += delta;
      }
      this.lastPlayerPos.copy(playerPos);
    }

    // Check if player has used gyro
    if (isCalibrated()) {
      this.state.hasUsedGyro = true;
    }

    // Check if player has seen/collected fragments
    const collected = getCollectedCount();
    if (collected > 0) {
      this.state.hasCollectedFragment = true;
    }
  }

  checkConditions() {
    const now = performance.now() * 0.001;
    if (now - this.state.lastHintTime < this.globalCooldown) return;
    // Don't show hints while journal or voice popup is active
    if (window._isJournalShowing?.()) return;
    if (window._isVoiceShowing?.()) return;

    for (const hint of HINTS) {
      if (
        this.hintCooldowns[hint.id] &&
        now - this.hintCooldowns[hint.id] < hint.cooldown
      )
        continue;
      if (hint.condition(this.state)) {
        this.emitHint(hint);
        this.state.lastHintTime = now;
        this.hintCooldowns[hint.id] = now;
        break; // Only emit one hint at a time
      }
    }
  }

  emitHint(hint) {
    console.log(`[Hint] ${hint.id}: ${hint.message}`);
    if (hint.type === "voice") {
      triggerJournal("hint_voice", hint.message);
    } else if (hint.type === "hud") {
      // Dismiss any active journal popup before showing HUD hint
      window._dismissJournalPopup?.();
      this.showHUDHint(hint.message);
    } else if (hint.type === "environment") {
      // Environment changes are handled elsewhere
    }
  }

  showHUDHint(message) {
    // Create a temporary HUD hint element
    const existing = document.getElementById("hud-hint");
    if (existing) existing.remove();

    const hintEl = document.createElement("div");
    hintEl.id = "hud-hint";
    hintEl.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: #e8d8a0;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 25;
      pointer-events: none;
      animation: hintFade 3s forwards;
    `;
    hintEl.textContent = message;
    document.body.appendChild(hintEl);

    // Add animation if not already present
    if (!document.getElementById("hud-hint-style")) {
      const style = document.createElement("style");
      style.id = "hud-hint-style";
      style.textContent = `
        @keyframes hintFade {
          0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // Remove after animation
    if (hintEl._removeTimer) clearTimeout(hintEl._removeTimer);
    hintEl._removeTimer = setTimeout(() => {
      if (hintEl.parentNode) hintEl.remove();
    }, 3000);
  }
}

// Dismiss active HUD hint immediately (bridge for journal/voice priority)
export function dismissHUDHint() {
  const existing = document.getElementById("hud-hint");
  if (existing) existing.remove();
}

export const hintSystem = new HintSystem();

export function updateHintSystem(delta) {
  hintSystem.trackPlayerState(delta);
  hintSystem.checkConditions();
}
