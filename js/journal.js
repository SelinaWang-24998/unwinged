// Observation journal - records discoveries with poetic text

const journalEntries = [
  { id: 'first_move', text: '你踏上了这座岛，它似乎在等待什么。', triggered: false },
  { id: 'first_caught', text: '它并不愤怒，只是在执行某种规则。', triggered: false },
  { id: 'first_fragment', text: '碎片在发光，像是某种记忆。', triggered: false },
  { id: 'gyro_pursuer', text: '原来它也会听从大地的指令。', triggered: false },
  { id: 'gyro_terrain', text: '岛屿似乎感受到了你的手势...', triggered: false },
  { id: 'gyro_wave', text: '海水在回应你。', triggered: false },
  { id: 'first_stack', text: '重力似乎比想象中温柔。', triggered: false },
  { id: 'all_fragments', text: '你发现了这个世界的秘密，但它远不止于此。', triggered: false },
];

let journalPopupEl, journalTextEl, journalReviewEl, journalListEl;
let journalMiniLinesEl;
let popupTimeout = null;

export function initJournal() {
  journalPopupEl = document.getElementById('journal-popup');
  journalTextEl = document.getElementById('journal-text');
  journalReviewEl = document.getElementById('journal-review');
  journalListEl = document.getElementById('journal-list');
  journalMiniLinesEl = document.getElementById('journal-mini-lines');
  document.getElementById('journal-close').addEventListener('click', hideReview);
  updateMiniList();
}

export function triggerJournal(id) {
  const entry = journalEntries.find(e => e.id === id);
  if (!entry || entry.triggered) return;
  entry.triggered = true;

  // Show popup
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
  }, 5000);

  // Update review list
  updateReviewList();
  updateMiniList();
}

function updateReviewList() {
  if (!journalListEl) return;
  journalListEl.innerHTML = '';
  journalEntries.forEach(e => {
    const li = document.createElement('li');
    if (e.triggered) {
      li.textContent = e.text;
    } else {
      li.textContent = '???';
      li.classList.add('locked');
    }
    journalListEl.appendChild(li);
  });
}

function updateMiniList() {
  if (!journalMiniLinesEl) return;
  journalMiniLinesEl.textContent = journalEntries
    .map((e) => (e.triggered ? e.text : '???'))
    .join('\n');
}

export function showReview() {
  updateReviewList();
  journalReviewEl?.classList.remove('hidden');
}

export function hideReview() {
  journalReviewEl?.classList.add('hidden');
}

export function isReviewVisible() {
  return journalReviewEl && !journalReviewEl.classList.contains('hidden');
}

export function resetJournal() {
  journalEntries.forEach(e => e.triggered = false);
  if (popupTimeout) clearTimeout(popupTimeout);
  journalPopupEl?.classList.add('hidden');
  journalReviewEl?.classList.add('hidden');
  updateMiniList();
}

export function hasTriggered(id) {
  const entry = journalEntries.find(e => e.id === id);
  return entry ? entry.triggered : false;
}
