// World journal — one-shot poetic observations
// Shows briefly then disappears. NOT recorded in monster journal.
// Suppressed when pursuer voice is active (voice has higher priority),
// UNLESS the entry is marked as `highPriority` (e.g. hidden_awaken).

const journalEntries = [
  { id: 'first_move', text: '你踏上了这座岛，它似乎在等待什么。', triggered: false },
  { id: 'first_caught', text: '它并不愤怒，只是在执行某种规则。', triggered: false },
  { id: 'first_fragment', text: '碎片在发光，像是某种记忆。', triggered: false },
  { id: 'hidden_awaken', text: '深埋地底的宝藏啊，听从我的召唤吧', triggered: false, highPriority: true },
  { id: 'gyro_pursuer', text: '原来它也会听从大地的指令。', triggered: false },
  { id: 'gyro_terrain', text: '岛屿似乎感受到了你的手势...', triggered: false },
  { id: 'gyro_wave', text: '海水在回应你。', triggered: false },
  { id: 'first_stack', text: '重力似乎比想象中温柔。', triggered: false },
  { id: 'all_fragments', text: '你发现了这个世界的秘密，但它远不止于此。', triggered: false },
];

let journalPopupEl, journalTextEl;
let popupTimeout = null;
let journalShowing = false; // Track whether journal popup is currently visible

export function initJournal() {
  journalPopupEl = document.getElementById('journal-popup');
  journalTextEl = document.getElementById('journal-text');
  // Expose dismiss function for voice.js priority system (via window to avoid circular deps)
  window._dismissJournalPopup = dismissJournalPopup;
  window._isJournalShowing = () => journalShowing;
}

function dismissJournalPopup() {
  if (journalPopupEl) {
    journalPopupEl.classList.add('hidden');
    journalPopupEl.style.animation = 'none';
  }
  journalShowing = false;
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }
}

export function triggerJournal(id) {
  const entry = journalEntries.find(e => e.id === id);
  if (!entry || entry.triggered) return;

  // Priority check: don't show if pursuer voice is active
  // UNLESS this entry has highPriority (can override voice)
  if (!entry.highPriority && window._isVoiceShowing?.()) return;

  entry.triggered = true;

  // Always dismiss any active voice popup to prevent visual overlap
  window._dismissVoicePopup?.();
  // Dismiss any active HUD hint
  window._dismissHUDHint?.();

  // Show popup (one-shot, auto-hides)
  journalShowing = true;
  if (journalTextEl && journalPopupEl) {
    journalTextEl.textContent = entry.text;
    journalPopupEl.classList.remove('hidden');
    journalPopupEl.style.animation = 'none';
    journalPopupEl.offsetHeight; // reflow
    journalPopupEl.style.animation = 'fadeInOut 5s forwards';
  }

  // Clear previous timeout
  if (popupTimeout) clearTimeout(popupTimeout);
  popupTimeout = setTimeout(() => {
    journalPopupEl?.classList.add('hidden');
    journalShowing = false;
  }, 5000);
}

export function resetJournal() {
  journalEntries.forEach(e => e.triggered = false);
  journalShowing = false;
  if (popupTimeout) clearTimeout(popupTimeout);
  journalPopupEl?.classList.add('hidden');
}

export function hasTriggered(id) {
  const entry = journalEntries.find(e => e.id === id);
  return entry ? entry.triggered : false;
}
