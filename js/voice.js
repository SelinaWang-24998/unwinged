// Pursuer Voice System — 追捕者心声
// The pursuer's consciousness whispers to the player through a separate UI channel.
// Voice entries are recorded in the monster journal (HUD mini panel).

let voicePopupEl, voiceTextEl;
let globalCooldownUntil = 0;
let pendingQueue = [];
const GLOBAL_COOLDOWN = 8; // seconds between any two voices
const CATEGORY_COOLDOWN = 20; // seconds between same category

// Voice history for monster journal — records all shown voice texts in order
const voiceHistory = [];
let voiceShowingUntil = 0; // timestamp until which voice popup is active

// Voice entry categories with texts, priority, and cooldown
const voiceEntries = [
  {
    category: 'opening',
    texts: [
      "\u65b0\u7684\u6c14\u606f\u2026\u2026\u8fd9\u6b21\u4f1a\u6709\u4ec0\u4e48\u4e0d\u540c\uff1f",
      "\u5b83\u53c8\u6765\u4e86\u3002\u5728\u8fd9\u4e2a\u5c9b\u4e0a\uff0c\u4e00\u5207\u7ec8\u5c06\u56de\u5230\u539f\u70b9\u3002",
      "\u5b89\u9759\u3002\u6682\u65f6\u5b89\u9759\u3002",
      "\u6211\u95fb\u5230\u4e86\u2026\u2026\u79fb\u52a8\u7684\u610f\u613f\u3002",
    ],
    priority: 0, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'spot',
    texts: [
      "\u90a3\u91cc\u2014\u2014\u6709\u4ec0\u4e48\u5728\u52a8\u3002",
      "\u4e0d\u5bf9\uff0c\u90a3\u4e0d\u662f\u98ce\u3002",
      "\u2026\u2026\u627e\u5230\u4e86\u3002",
    ],
    priority: 9, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'approach',
    texts: [
      "\u8fd1\u4e86\u3002\u8fd1\u4e86\u3002",
      "\u5b83\u5728\u8dd1\u3002\u4e3a\u4ec0\u4e48\u4e0d\u9762\u5bf9\u6211\uff1f",
      "\u6211\u51e0\u4e4e\u80fd\u2014\u2014",
      "\u592a\u8fd1\u4e86\u3002\u8fd9\u4e00\u6b21\u4e0d\u4f1a\u9519\u8fc7\u3002",
    ],
    priority: 8, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'lost',
    texts: [
      "\u2026\u2026\u6d88\u5931\u4e86\uff1f\u4e0d\uff0c\u53ea\u662f\u770b\u4e0d\u89c1\u3002",
      "\u5b83\u6bd4\u6211\u4ee5\u4e3a\u7684\u5feb\u3002",
      "\u65b9\u5411\u2014\u2014\u54ea\u4e2a\u65b9\u5411\uff1f",
      "\u8fd9\u79cd\u4e8b\u4ee5\u524d\u4e5f\u53d1\u751f\u8fc7\u3002\u6211\u53ea\u9700\u8981\u7b49\u5f85\u3002",
    ],
    priority: 6, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'tilt',
    texts: [
      "\u5730\u53c8\u5728\u52a8\u4e86\u3002\u8fd9\u4e0d\u662f\u81ea\u7136\u7684\u4e8b\u3002",
      "\u8c01\u5728\u6643\u52a8\u8fd9\u5ea7\u5c9b\uff1f",
      "\u5b83\u5728\u6446\u5f04\u4ec0\u4e48\u2026\u2026\u6709\u4e00\u79cd\u6211\u770b\u4e0d\u5230\u7684\u529b\u91cf\u3002",
      "\u5730\u9762\u4e0d\u4f1a\u8bf4\u8c0e\uff0c\u4f46\u4e5f\u4e0d\u4f1a\u542c\u8bdd\u3002",
    ],
    priority: 2, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'terrain_hit',
    texts: [
      "\u8def\u53d8\u4e86\u3002\u8fd9\u4e0d\u662f\u6211\u8d70\u7684\u65b9\u5411\u3002",
      "\u5b83\u5728\u7528\u6709\u4ec0\u4e48\u65b9\u5f0f\u963b\u6321\u6211\u2026\u2026",
      "\u5730\u9762\u5347\u9ad8\u4e86\u3002\u662f\u88ab\u64cd\u63a7\u7684\u5417\uff1f",
      "\u8fd9\u6761\u8def\u4e0d\u5bf9\u3002\u4f46\u6362\u4e00\u6761\u53c8\u600e\u6837\uff1f",
    ],
    priority: 4, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'near_fragment',
    texts: [
      "\u5b83\u603b\u662f\u5728\u671d\u6709\u4ec0\u4e48\u65b9\u5411\u9760\u8fd1\u3002",
      "\u90a3\u4e1c\u897f\u4f3c\u4e4e\u4e5f\u5728\u5438\u5f15\u5b83\u3002",
      "\u53c8\u4e00\u4e2a\uff1f\u5b83\u5230\u5e95\u5728\u627e\u591a\u5c11\uff1f",
      "\u6211\u770b\u4e0d\u5230\u5b83\u8ffd\u6c42\u7684\u4e1c\u897f\uff0c\u4f46\u6211\u611f\u89c9\u5f97\u5230\u3002",
    ],
    priority: 5, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'hidden_reveal',
    texts: [
      "\u8fd9\u91cc\u2026\u2026\u6709\u70b9\u4e0d\u4e00\u6837\u3002",
      "\u7a7a\u6c14\u91cc\u6709\u4ec0\u4e48\u4e1c\u897f\u5728\u53d8\u5f97\u6e05\u6670\u3002",
      "\u6211\u4e0d\u559c\u6b22\u8fd9\u7247\u5730\u3002\u5b83\u85cf\u7740\u4ec0\u4e48\u3002",
    ],
    priority: 2, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'hidden_hint',
    texts: [
      "\u5b83\u4e00\u76f4\u5728\u8fd9\u7247\u533a\u57df\u6253\u8f6c\u3002\u5b83\u611f\u89c9\u5230\u4e86\u4ec0\u4e48\uff0c\u5374\u770b\u4e0d\u5230\u3002",
      "\u6df1\u57cb\u5730\u5e95\u7684\u5b9d\u85cf\u554a\uff0c\u6709\u8c01\u4f1a\u53bb\u53d1\u73b0\u5b83\u5462\u2026\u2026",
    ],
    priority: 1, cooldown: 30, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'raise_terrain',
    texts: [
      "\u5730\u9762\u5728\u5347\u8d77\u3002ta\u5728\u5e72\u4ec0\u4e48\uff1f",
      "\u53ef\u6076\u3002\u5c45\u7136\u88abta\u53d1\u73b0\u4e86\u8fd9\u4e2a\u79d8\u5bc6\u3002",
      "ta\u5c45\u7136\u80fd\u591f\u64cd\u63a7\u5927\u5730\u2014\u2014\u90a3\u5b9d\u85cf\u5c82\u4e0d\u662f\u2026\u2026",
    ],
    priority: 3, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'almost_caught',
    texts: [
      "\u7ed3\u675f\u4e86\u3002",
      "\u4e0d\u9700\u8981\u518d\u8ffd\u4e86\u3002",
      "\u8dd1\u4e0d\u6389\u4e86\u3002",
      "\u7ec8\u4e8e\u3002",
    ],
    priority: 10, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'fragment_taken',
    texts: [
      "\u2026\u2026\u5b83\u62ff\u8d70\u4e86\u4e00\u4e2a\u3002\u8fd9\u4e0d\u597d\u3002",
      "\u90a3\u4e1c\u897f\u4e0d\u8be5\u88ab\u78b0\u3002\u4f46\u5df2\u7ecf\u592a\u665a\u4e86\u3002",
      "\u5c11\u4e86\u4e00\u4e2a\u3002\u8fd8\u5269\u2014\u2014",
    ],
    priority: 7, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
  {
    category: 'near_victory',
    texts: [
      "\u4e0d\u2026\u2026\u4e0d\u80fd\u8ba9\u5b83\u8d70\u3002",
      "\u5dee\u4e00\u4e2a\u3002\u6211\u5fc5\u987b\u2014\u2014",
      "\u8fd9\u5ea7\u5c9b\u4f1a\u5931\u53bb\u5b83\u7684\u79d8\u5bc6\u3002",
      "\u5b83\u4ee5\u4e3a\u53d1\u73b0\u4e86\u51fa\u53e3\u3002\u4f46\u5b83\u53d1\u73b0\u7684\u53ea\u662f\u66f4\u6df1\u7684\u7262\u7b3c\u3002",
    ],
    priority: 8, cooldown: CATEGORY_COOLDOWN, usedIndices: [], lastTriggered: 0,
  },
];

export function initVoice() {
  voicePopupEl = document.getElementById('voice-popup');
  voiceTextEl = document.getElementById('voice-text');
}

export function triggerVoice(category) {
  const now = performance.now() / 1000;
  const entry = voiceEntries.find(e => e.category === category);
  if (!entry) return;

  // Same-category cooldown
  if (now - entry.lastTriggered < entry.cooldown) return;

  // Global cooldown
  if (now < globalCooldownUntil) {
    // Queue if high priority
    pendingQueue.push({ category, priority: entry.priority, time: now });
    // Keep only highest priority in queue
    pendingQueue.sort((a, b) => b.priority - a.priority);
    if (pendingQueue.length > 3) pendingQueue.length = 3;
    return;
  }

  emitVoice(entry, now);
}

function emitVoice(entry, now) {
  // Pick a text that hasn't been used this game
  const availableIndices = [];
  for (let i = 0; i < entry.texts.length; i++) {
    if (!entry.usedIndices.includes(i)) availableIndices.push(i);
  }
  if (availableIndices.length === 0) {
    entry.usedIndices = []; // Reset if all used
    for (let i = 0; i < entry.texts.length; i++) availableIndices.push(i);
  }

  const pick = availableIndices[Math.floor(Math.random() * availableIndices.length)];
  entry.usedIndices.push(pick);
  entry.lastTriggered = now;
  globalCooldownUntil = now + GLOBAL_COOLDOWN;

  const text = entry.texts[pick];

  // Record in monster journal history
  voiceHistory.push(text);
  // Keep last 10 entries
  if (voiceHistory.length > 10) voiceHistory.shift();

  // Dismiss any active world journal popup (pursuer voice takes priority)
  window._dismissJournalPopup?.();
  // Dismiss any active HUD hint
  window._dismissHUDHint?.();

  showVoicePopup(text);

  // Update monster journal mini panel
  updateMonsterJournal();
}

// Export: is voice currently showing? (for priority system)
export function isVoiceShowing() {
  return performance.now() / 1000 < voiceShowingUntil;
}

// Export: get voice history for monster journal
export function getVoiceHistory() {
  return voiceHistory;
}

// Update the HUD monster journal mini panel
function updateMonsterJournal() {
  const el = document.getElementById('journal-mini-lines');
  if (!el) return;
  // Show last 4 entries as separate fixed-height items with dividers
  const recent = voiceHistory.slice(-4);
  el.innerHTML = recent.map(text =>
    '<span class="mj-entry">' + text + '</span>'
  ).join('');
}

function showVoicePopup(text) {
  if (!voicePopupEl || !voiceTextEl) return;
  voiceTextEl.textContent = text;
  voicePopupEl.classList.remove('hidden');
  // Reset animation
  voicePopupEl.classList.remove('active');
  void voicePopupEl.offsetHeight; // reflow
  voicePopupEl.classList.add('active');

  // Track that voice is active
  voiceShowingUntil = performance.now() / 1000 + 5;

  // Auto-hide after animation
  if (voicePopupEl._hideTimer) clearTimeout(voicePopupEl._hideTimer);
  voicePopupEl._hideTimer = setTimeout(() => {
    voicePopupEl.classList.add('hidden');
    voicePopupEl.classList.remove('active');
  }, 5000);
}

// Process queued voices — call each frame from game loop
export function updateVoice() {
  const now = performance.now() / 1000;
  if (pendingQueue.length > 0 && now >= globalCooldownUntil) {
    const next = pendingQueue.shift();
    const entry = voiceEntries.find(e => e.category === next.category);
    if (entry && now - entry.lastTriggered >= entry.cooldown) {
      emitVoice(entry, now);
    }
  }
}

// Dismiss the voice popup immediately (used by high-priority journal and reset)
function dismissVoicePopup() {
  if (voicePopupEl) {
    voicePopupEl.classList.add('hidden');
    voicePopupEl.classList.remove('active');
  }
  voiceShowingUntil = 0;
  if (voicePopupEl?._hideTimer) clearTimeout(voicePopupEl._hideTimer);
}

export function resetVoice() {
  globalCooldownUntil = 0;
  pendingQueue = [];
  voiceHistory.length = 0;
  dismissVoicePopup();
  voiceEntries.forEach(e => {
    e.usedIndices = [];
    e.lastTriggered = 0;
  });
  // Reset monster journal mini panel
  const el = document.getElementById('journal-mini-lines');
  if (el) el.textContent = '';
}

// Expose entries for hint-system integration
export function getVoiceEntries() { return voiceEntries; }

// Bridge: allow high-priority journal entries to dismiss voice popup
export { dismissVoicePopup as dismissVoicePopupForJournal };
