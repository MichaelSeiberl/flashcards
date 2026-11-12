'use strict';

/*
 * Data model (one card):
 *   { id, question, answer, status }
 *   status: 'learning' (UI: "Still learning") | 'known' (UI: "Known")
 *
 * Step 1: in-memory only. Persistence (localStorage) is added in step 2.
 */
let cards = [];
let nextId = 1;

const form = document.getElementById('add-form');
const questionInput = document.getElementById('question');
const answerInput = document.getElementById('answer');
const errorEl = document.getElementById('form-error');
const listEl = document.getElementById('card-list');

// Validates and adds a card. Returns true on success, false if input is invalid.
// Validation lives here (not only in HTML attributes, which can be bypassed).
function addCard(question, answer) {
  const q = question.trim();
  const a = answer.trim();
  if (q === '' || a === '') {
    return false;
  }
  cards.push({ id: nextId++, question: q, answer: a, status: 'learning' });
  return true;
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

    li.append(q, a);
    ul.appendChild(li);
  }
  listEl.appendChild(ul);
}

form.addEventListener('submit', (event) => {
  event.preventDefault(); // stay on the page, no reload

  const ok = addCard(questionInput.value, answerInput.value);

  if (!ok) {
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
  questionInput.value = '';
  answerInput.value = '';
  questionInput.focus();
  render();
});

render();
