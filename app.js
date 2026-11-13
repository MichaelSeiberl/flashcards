'use strict';

/*
 * Data model (one card):
 *   { id, question, answer, status }
 *   status: 'learning' (UI: "Still learning") | 'known' (UI: "Known")
 *
 * Step 2: cards are persisted in localStorage (see loadCards / saveCards).
 * Steps 3-6: delete, edit, review mode and learning status. Every change to
 * the card list goes through saveCards (single write path, rollback on failure).
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
const reviewEl = document.getElementById('review');
const reviewStatusEl = document.getElementById('review-status');
const modeToggle = document.getElementById('mode-toggle');
const STATUS_LABELS = { learning: 'Still learning', known: 'Known' };

// Two notice sources: the load notice stays until reload, the save notice
// disappears after the next successful save.
let loadNotice = '';
let saveNotice = '';

// True when existing stored data could not be read or backed up reliably.
// Then nothing may be written to STORAGE_KEY (it could destroy that data).
// Only in memory: a reload tries again.
let savingBlocked = false;

// UI state (memory only).
let mode = 'list'; // 'list' or 'review'
let editing = null; // { id, question, answer, error } while a card is edited
let reviewIndex = 0;
let flipped = false;
let editQuestionInput = null;
let editAnswerInput = null;

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

// Writes a new card list. Returns 'ok', 'blocked' or 'save-failed'.
// State changes only after the save succeeded (rollback rule).
function persist(newList) {
  if (savingBlocked) {
    return 'blocked';
  }
  if (!saveCards(newList)) {
    return 'save-failed';
  }
  cards = newList;
  return 'ok';
}

// Deletes the card with the given id. Returns 'ok', 'not-found', 'blocked' or 'save-failed'.
function deleteCard(id) {
  if (!cards.some((c) => c.id === id)) {
    return 'not-found';
  }
  return persist(cards.filter((c) => c.id !== id));
}

// Changes question and answer of a card (id and status stay).
// Returns 'ok', 'not-found', 'invalid', 'blocked' or 'save-failed'.
// Validation lives here (not only in HTML), like in addCard.
function updateCard(id, question, answer) {
  if (!cards.some((c) => c.id === id)) {
    return 'not-found';
  }
  const q = String(question).trim();
  const a = String(answer).trim();
  if (q === '' || a === '') {
    return 'invalid';
  }
  return persist(cards.map((c) => (c.id === id ? { ...c, question: q, answer: a } : c)));
}

// Sets the learning status of a card. Returns 'ok', 'not-found', 'invalid',
// 'blocked' or 'save-failed'.
function setStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    return 'invalid';
  }
  const card = cards.find((c) => c.id === id);
  if (!card) {
    return 'not-found';
  }
  if (card.status === status) {
    return 'ok'; // nothing to write
  }
  return persist(cards.map((c) => (c.id === id ? { ...c, status } : c)));
}

// ---- DOM helpers (text is always set via textContent, never innerHTML) ----
function make(tag, text, className) {
  const e = document.createElement(tag);
  if (text) {
    e.textContent = text;
  }
  if (className) {
    e.className = className;
  }
  return e;
}

function actionButton(label, action, id, className, ariaLabel) {
  const b = make('button', label, className || 'btn');
  b.type = 'button';
  b.dataset.action = action;
  if (id !== undefined) {
    b.dataset.id = String(id);
  }
  if (ariaLabel) {
    b.setAttribute('aria-label', ariaLabel);
  }
  return b;
}

// ---- Card list (with inline edit form) ----
function isDirty() {
  const card = editing && cards.find((c) => c.id === editing.id);
  return !card || editing.question !== card.question || editing.answer !== card.answer;
}

function buildEditForm(card) {
  const f = make('form', '', 'edit-form');
  f.setAttribute('novalidate', '');
  f.dataset.editId = String(card.id);

  const lq = make('label', 'Question');
  lq.setAttribute('for', 'edit-question');
  editQuestionInput = make('input');
  editQuestionInput.type = 'text';
  editQuestionInput.id = 'edit-question';
  editQuestionInput.value = editing.question;
  editQuestionInput.dataset.field = 'question';
  editQuestionInput.setAttribute('autocomplete', 'off');

  const la = make('label', 'Answer');
  la.setAttribute('for', 'edit-answer');
  editAnswerInput = make('input');
  editAnswerInput.type = 'text';
  editAnswerInput.id = 'edit-answer';
  editAnswerInput.value = editing.answer;
  editAnswerInput.dataset.field = 'answer';
  editAnswerInput.setAttribute('autocomplete', 'off');

  const err = make('p', editing.error, 'form-error');
  err.setAttribute('role', 'alert');

  const save = make('button', 'Save', 'btn btn-primary');
  save.type = 'submit';
  const cancel = actionButton('Cancel', 'cancel', card.id);

  const actions = make('div', '', 'actions');
  actions.append(save, cancel);
  f.append(lq, editQuestionInput, la, editAnswerInput, err, actions);
  return f;
}

function renderList() {
  listEl.textContent = '';
  editQuestionInput = null;
  editAnswerInput = null;

  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No flashcards yet. Add your first card.';
    listEl.appendChild(empty);
    return;
  }

  const ul = make('ul', '', 'card-items');
  for (const card of cards) {
    const li = make('li', '', 'card-item');

    if (editing && editing.id === card.id) {
      li.appendChild(buildEditForm(card));
      ul.appendChild(li);
      continue;
    }

    const q = document.createElement('p');
    const qLabel = document.createElement('strong');
    qLabel.textContent = 'Q: ';
    q.append(qLabel, card.question);

    const a = document.createElement('p');
    const aLabel = document.createElement('strong');
    aLabel.textContent = 'A: ';
    a.append(aLabel, card.answer);

    const badge = make('p', STATUS_LABELS[card.status], 'status status-' + card.status);

    const actions = make('div', '', 'actions');
    const toggleLabel = card.status === 'known' ? 'Mark as still learning' : 'Mark as known';
    actions.append(
      actionButton(toggleLabel, 'status', card.id, 'btn', toggleLabel + ': ' + card.question),
      actionButton('Edit', 'edit', card.id, 'btn', 'Edit card: ' + card.question),
      actionButton('Delete', 'delete', card.id, 'btn btn-danger', 'Delete card: ' + card.question),
    );

    li.append(q, a, badge, actions);
    ul.appendChild(li);
  }
  listEl.appendChild(ul);
}

// Asks before throwing away an unsaved edit. Returns true if it may go.
function mayDiscardEdit() {
  return !editing || !isDirty() || window.confirm('Discard your unsaved changes?');
}

function startEdit(id) {
  const card = cards.find((c) => c.id === id);
  if (!card || (editing && editing.id !== id && !mayDiscardEdit())) {
    return;
  }
  editing = { id: card.id, question: card.question, answer: card.answer, error: '' };
  render();
  if (editQuestionInput) {
    editQuestionInput.focus();
  }
}

function cancelEdit() {
  if (!mayDiscardEdit()) {
    return;
  }
  editing = null;
  render();
}

// Shows an error inside the edit form; the typed text stays.
function editFailed(message, field) {
  editing.error = message;
  render();
  const input = field === 'answer' ? editAnswerInput : editQuestionInput;
  if (input) {
    input.focus();
  }
}

function saveEdit(id) {
  if (!editing || editing.id !== id) {
    return;
  }
  const result = updateCard(id, editing.question, editing.answer);
  if (result === 'ok') {
    editing = null;
    saveNotice = '';
    renderNotice();
    render();
  } else if (result === 'invalid') {
    editFailed('Question and answer must not be empty.', editing.question.trim() === '' ? 'question' : 'answer');
  } else if (result === 'not-found') {
    editing = null;
    saveNotice = 'This card no longer exists. Nothing was changed.';
    renderNotice();
    render();
  } else if (result === 'blocked') {
    editFailed('Nothing was saved because saving is turned off (see the message above). Your text is kept here. Copy it before you reload the page.', 'question');
  } else {
    editFailed('Could not save. The card was not changed and your text is kept here. Free up browser storage or allow site data, then press Save again.', 'question');
  }
}

// Changes the status of a card and shows the result. Used by list and review.
function changeStatus(id, status) {
  const result = setStatus(id, status);
  if (result === 'ok') {
    saveNotice = '';
  } else if (result === 'blocked') {
    saveNotice = 'The status was not changed because saving is turned off (see the message above).';
  } else if (result === 'save-failed') {
    saveNotice = 'Could not save the new status. Nothing was changed. Free up browser storage or allow site data, then try again.';
  } else {
    saveNotice = 'This card no longer exists. Nothing was changed.';
  }
  renderNotice();
  return result;
}

// One listener per event type for the whole list (event delegation).
listEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) {
    return;
  }
  const id = Number(button.dataset.id);
  const action = button.dataset.action;
  const card = cards.find((c) => c.id === id);
  if (!card) {
    return;
  }

  if (action === 'edit') {
    startEdit(id);
  } else if (action === 'cancel') {
    cancelEdit();
  } else if (action === 'status') {
    changeStatus(id, card.status === 'known' ? 'learning' : 'known');
    render();
  } else if (action === 'delete') {
    if (!window.confirm('Delete this card?\n\nQ: ' + card.question)) {
      return; // cancelled: nothing changes
    }
    const result = deleteCard(id);
    if (result === 'ok') {
      if (editing && editing.id === id) {
        editing = null;
      }
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
  }
});

listEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const formEl = event.target;
  if (formEl && formEl.dataset && formEl.dataset.editId !== undefined) {
    saveEdit(Number(formEl.dataset.editId));
  }
});

// Keeps the typed text of the edit form in memory (survives a re-render).
listEl.addEventListener('input', (event) => {
  const field = event.target && event.target.dataset && event.target.dataset.field;
  if (editing && (field === 'question' || field === 'answer')) {
    editing[field] = event.target.value;
  }
});

// ---- Review mode ----
// Short message for screen readers. The review view itself is NOT a live
// region (it is rebuilt on every change and would be read out completely).
function announce(message) {
  reviewStatusEl.textContent = message;
}

function renderReview(focusKey) {
  reviewEl.textContent = '';

  if (cards.length === 0) {
    reviewEl.appendChild(make('p', 'No flashcards to review. Add a card first.'));
    return;
  }
  reviewIndex = Math.min(Math.max(reviewIndex, 0), cards.length - 1);
  const card = cards[reviewIndex];

  reviewEl.appendChild(make('p', 'Card ' + (reviewIndex + 1) + ' of ' + cards.length, 'review-progress'));

  const face = actionButton('', 'flip', undefined, 'review-card');
  face.dataset.focus = 'face';
  face.setAttribute('aria-label', flipped ? 'Answer. Press to show the question.' : 'Question. Press to show the answer.');
  face.append(make('span', flipped ? 'Answer' : 'Question', 'review-label'));
  face.append(make('span', flipped ? card.answer : card.question, 'review-text'));
  reviewEl.appendChild(face);

  reviewEl.appendChild(make('p', STATUS_LABELS[card.status], 'status status-' + card.status));

  const prev = actionButton('Previous', 'prev');
  prev.disabled = reviewIndex === 0;
  const flip = actionButton(flipped ? 'Show question' : 'Show answer', 'flip');
  flip.dataset.focus = 'flip';
  const next = actionButton('Next', 'next');
  next.disabled = reviewIndex === cards.length - 1;
  const nav = make('div', '', 'actions');
  nav.append(prev, flip, next);
  reviewEl.appendChild(nav);

  const marks = make('div', '', 'actions');
  // Neutral by default; the stored status is highlighted (colour + check mark
  // + aria-pressed, so it is not conveyed by colour alone).
  const known = actionButton('Known', 'known', undefined, 'btn status-btn status-btn-known');
  const learning = actionButton('Still learning', 'learning', undefined, 'btn status-btn status-btn-learning');
  for (const [btn, key] of [[known, 'known'], [learning, 'learning']]) {
    const active = card.status === key;
    btn.setAttribute('aria-pressed', String(active));
    if (active) {
      btn.className += ' is-active';
    }
  }
  marks.append(known, learning);
  reviewEl.appendChild(marks);

  // The view is rebuilt, so put keyboard focus back on the control that was
  // used. A button that is now disabled (first/last card) hands the focus to
  // the opposite navigation button, or to the flip button as a last resort.
  prev.dataset.focus = 'prev';
  next.dataset.focus = 'next';
  known.dataset.focus = 'known';
  learning.dataset.focus = 'learning';
  const focusable = { face, prev, next, flip, known, learning };
  const fallback = { prev: [next, flip], next: [prev, flip] };
  if (focusKey && focusable[focusKey]) {
    const candidates = [focusable[focusKey], ...(fallback[focusKey] || [])];
    const target = candidates.find((el) => !el.disabled);
    if (target) {
      target.focus();
    }
  }
}

// Which review control (if any) has focus; used to restore focus after render.
function focusKeyOf(el) {
  return (el && el.dataset && el.dataset.focus) || undefined;
}

function describeCard(prefix) {
  const card = cards[reviewIndex];
  return prefix + (flipped ? 'Answer: ' + card.answer : 'Question: ' + card.question);
}

function reviewStep(delta) {
  const target = reviewIndex + delta;
  if (target >= 0 && target < cards.length) {
    reviewIndex = target;
    flipped = false;
  }
}

reviewEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || cards.length === 0) {
    return;
  }
  const action = button.dataset.action;
  if (action === 'flip') {
    flipped = !flipped;
  } else if (action === 'prev' || action === 'next') {
    const before = reviewIndex;
    reviewStep(action === 'next' ? 1 : -1);
    if (reviewIndex !== before) {
      announce(describeCard('Card ' + (reviewIndex + 1) + ' of ' + cards.length + '. '));
    }
  } else if (action === 'known' || action === 'learning') {
    if (changeStatus(cards[reviewIndex].id, action) === 'ok') {
      announce(action === 'known' ? 'Marked as known.' : 'Marked as still learning.');
    }
  }
  render(focusKeyOf(button));
});

// Space flips the card, arrow keys navigate. Not while typing, and not on a
// focused button (a button already reacts to space itself: no double flip).
document.addEventListener('keydown', (event) => {
  if (mode !== 'review' || cards.length === 0) {
    return;
  }
  const tag = event.target && event.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((event.key === ' ' || event.key === 'Spacebar') && !typing && tag !== 'BUTTON' && tag !== 'A') {
    event.preventDefault();
    flipped = !flipped;
    announce(describeCard(''));
    render();
  } else if (!typing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    const before = reviewIndex;
    reviewStep(event.key === 'ArrowRight' ? 1 : -1);
    if (reviewIndex !== before) {
      announce(describeCard('Card ' + (reviewIndex + 1) + ' of ' + cards.length + '. '));
    }
    render(focusKeyOf(event.target));
  }
});

function setMode(next) {
  if (next === mode) {
    return;
  }
  if (next === 'review') {
    if (!mayDiscardEdit()) {
      return;
    }
    editing = null;
    reviewIndex = 0;
    flipped = false;
  }
  mode = next;
  announce('');
  render();
}

modeToggle.addEventListener('click', () => {
  setMode(mode === 'list' ? 'review' : 'list');
});

// Central render function: shows the active view.
function render(focusAction) {
  const review = mode === 'review';
  form.hidden = review;
  listEl.hidden = review;
  reviewEl.hidden = !review;
  modeToggle.textContent = review ? 'Back to cards' : 'Start review';
  if (review) {
    renderReview(focusAction);
  } else {
    renderList();
  }
}

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
