'use strict';

/*
 * Data model (one card):
 *   { id, question, answer, status }
 *   status: 'learning' (UI: "Still learning") | 'known' (UI: "Known")
 *
 * Step 2: cards are persisted in localStorage (see loadCards / saveCards).
 */
const STORAGE_KEY = 'flashcards:v1';
const BACKUP_KEY = 'flashcards:v1:backup';
const VALID_STATUSES = ['learning', 'known'];

const form = document.getElementById('add-form');
const questionInput = document.getElementById('question');
const answerInput = document.getElementById('answer');
const errorEl = document.getElementById('form-error');
const storageNoticeEl = document.getElementById('storage-notice');
const listEl = document.getElementById('card-list');

// Two notice sources: the load notice stays until reload, the save notice
// disappears after the next successful save.
let loadNotice = '';
let saveNotice = '';

// True when existing stored data could not be read or backed up reliably.
// Then nothing may be written to STORAGE_KEY (it could destroy that data).
// Only in memory: a reload tries again.
let savingBlocked = false;

function renderNotice() {
  storageNoticeEl.textContent = [loadNotice, saveNotice].filter(Boolean).join(' ');
}

// True if the value is a well-formed card.
function isValidCard(c) {
  return (
    c !== null &&
    typeof c === 'object' &&
    Number.isSafeInteger(c.id) && c.id > 0 &&
    typeof c.question === 'string' && c.question.trim() !== '' &&
    typeof c.answer === 'string' && c.answer.trim() !== '' &&
    VALID_STATUSES.includes(c.status)
  );
}

// Copies the raw stored value to the backup key. Returns true on success.
function backupRaw(raw) {
  try {
    localStorage.setItem(BACKUP_KEY, raw);
    return true;
  } catch (e) {
    return false;
  }
}

// Reads cards from localStorage. Never throws.
// Returns { cards, notice, blocked }. Loading never overwrites STORAGE_KEY.
// blocked = true: existing data is unknown or unsaved, so saving must stay off.
function loadCards() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return {
      cards: [],
      blocked: true,
      notice: 'Saved cards could not be read. Saving is turned off so existing data is not overwritten. Reload the page to try again.',
    };
  }
  if (raw === null) {
    return { cards: [], notice: '', blocked: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = null;
  }

  const valid = [];
  let discarded = false;
  if (!Array.isArray(parsed)) {
    discarded = true;
  } else {
    const seenIds = new Set();
    for (const item of parsed) {
      if (isValidCard(item) && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        // Keep only known fields, trimmed like in addCard.
        valid.push({
          id: item.id,
          question: item.question.trim(),
          answer: item.answer.trim(),
          status: item.status,
        });
      } else {
        discarded = true;
      }
    }
  }

  if (!discarded) {
    return { cards: valid, notice: '', blocked: false };
  }

  if (backupRaw(raw)) {
    return {
      cards: valid,
      blocked: false,
      notice: 'Some saved cards were invalid and were skipped. A backup of the original data was kept.',
    };
  }
  // No backup: the next save would destroy the only copy of the original data.
  return {
    cards: valid,
    blocked: true,
    notice: 'Some saved cards were invalid and the backup could not be saved. Saving is turned off so the original data is not overwritten.',
  };
}

// Writes the list to localStorage. Returns true on success, false on failure.
// Single write path to STORAGE_KEY; refuses while saving is blocked.
function saveCards(list) {
  if (savingBlocked) {
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

const loaded = loadCards();
let cards = loaded.cards;
loadNotice = loaded.notice;
savingBlocked = loaded.blocked;
// Next id = highest existing id + 1 (1 if the deck is empty).
let nextId = cards.reduce((max, c) => Math.max(max, c.id), 0) + 1;

// Validates and adds a card.
// Returns 'ok', 'invalid', 'blocked', 'id-limit' or 'save-failed'.
// Validation lives here (not only in HTML attributes, which can be bypassed).
// Rollback: state changes only after the save succeeded.
function addCard(question, answer) {
  const q = question.trim();
  const a = answer.trim();
  if (q === '' || a === '') {
    return 'invalid';
  }
  if (savingBlocked) {
    return 'blocked';
  }
  if (!Number.isSafeInteger(nextId)) {
    return 'id-limit'; // ids beyond 2^53-1 are no longer unique
  }
  const newList = [...cards, { id: nextId, question: q, answer: a, status: 'learning' }];
  if (!saveCards(newList)) {
    return 'save-failed';
  }
  cards = newList;
  nextId++;
  return 'ok';
}

// Deletes the card with the given id. Returns 'ok', 'not-found', 'blocked' or 'save-failed'.
// Same rollback rule as addCard: state changes only after the save succeeded.
function deleteCard(id) {
  if (!cards.some((c) => c.id === id)) {
    return 'not-found';
  }
  if (savingBlocked) {
    return 'blocked';
  }
  const newList = cards.filter((c) => c.id !== id);
  if (!saveCards(newList)) {
    return 'save-failed';
  }
  cards = newList;
  return 'ok';
}

// Central render function: draws the card list or the empty state.
// User text is set via textContent only (never innerHTML) to avoid XSS.
function render() {
  listEl.textContent = '';

  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No flashcards yet. Add your first card.';
    listEl.appendChild(empty);
    return;
  }

  const ul = document.createElement('ul');
  for (const card of cards) {
    const li = document.createElement('li');

    const q = document.createElement('p');
    const qLabel = document.createElement('strong');
    qLabel.textContent = 'Q: ';
    q.append(qLabel, card.question);

    const a = document.createElement('p');
    const aLabel = document.createElement('strong');
    aLabel.textContent = 'A: ';
    a.append(aLabel, card.answer);

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.dataset.id = String(card.id);
    del.setAttribute('aria-label', 'Delete card: ' + card.question);

    li.append(q, a, del);
    ul.appendChild(li);
  }
  listEl.appendChild(ul);
}

// One listener for all delete buttons (event delegation).
listEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) {
    return;
  }
  const id = Number(button.dataset.id);
  const card = cards.find((c) => c.id === id);
  if (!card) {
    return;
  }
  if (!window.confirm('Delete this card?\n\nQ: ' + card.question)) {
    return; // cancelled: nothing changes
  }
  const result = deleteCard(id);
  if (result === 'ok') {
    saveNotice = '';
    renderNotice();
    render();
  } else if (result === 'blocked') {
    saveNotice = 'Nothing was deleted because saving is turned off (see the message above).';
    renderNotice();
  } else if (result === 'save-failed') {
    saveNotice = 'Could not save. Nothing was deleted. Your browser may block storage or be out of space.';
    renderNotice();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault(); // stay on the page, no reload

  const result = addCard(questionInput.value, answerInput.value);

  const failureNotices = {
    'save-failed': 'Could not save the card. Nothing was added. Your browser may block storage or be out of space.',
    'blocked': 'Nothing was added because saving is turned off (see the message above).',
    'id-limit': 'No more card IDs available. Nothing was added.',
  };
  if (result in failureNotices) {
    // Nothing was added; keep the form content so the input is not lost.
    errorEl.textContent = '';
    saveNotice = failureNotices[result];
    renderNotice();
    return;
  }

  if (result === 'invalid') {
    errorEl.textContent = 'Please enter a question and an answer.';
    // Focus the first field that is empty (after trimming).
    if (questionInput.value.trim() === '') {
      questionInput.focus();
    } else {
      answerInput.focus();
    }
    return;
  }

  errorEl.textContent = '';
  saveNotice = '';
  renderNotice();
  questionInput.value = '';
  answerInput.value = '';
  questionInput.focus();
  render();
});

renderNotice();
render();
