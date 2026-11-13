'use strict';
// Shared simulated page for the step 4-7 tests (edit, status, review).
// app.js runs in a Node vm sandbox with a FAKE document, FAKE localStorage and
// FAKE window.confirm. This is NOT a real browser (no layout, no real focus,
// no real events). node --test also loads this file; it defines no tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const KEY = 'flashcards:v1';
const BACKUP = 'flashcards:v1:backup';

function makeEl(tag) {
  let text = '';
  const el = {
    tag, children: [], value: '', hidden: false, disabled: false, className: '', id: '', type: '',
    listeners: {}, dataset: {}, attrs: {},
    get textContent() { return text; },
    set textContent(v) { text = v; this.children = []; },
    focus() { el.ownerDoc.focused = el; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    // Only the two selectors that app.js uses.
    closest(sel) {
      if (sel === 'button[data-id]') return this.tag === 'button' && 'id' in this.dataset ? this : null;
      if (sel === 'button[data-action]') return this.tag === 'button' && 'action' in this.dataset ? this : null;
      return null;
    },
    allText() { return text + this.children.map((c) => (typeof c === 'string' ? c : c.allText())).join(''); },
    find(pred, acc = []) {
      if (pred(this)) acc.push(this);
      this.children.forEach((c) => typeof c !== 'string' && c.find(pred, acc));
      return acc;
    },
  };
  return el;
}

// opts (read at call time, so a test can change them later):
//   getThrows, setThrows (true or key name), confirm (true/false or array of answers)
function loadPage(store, opts = {}) {
  const doc = { focused: null, listeners: {} };
  const els = {};
  for (const id of ['add-form', 'question', 'answer', 'form-error', 'storage-notice', 'card-list', 'review', 'review-status', 'mode-toggle']) {
    els[id] = makeEl(id === 'add-form' ? 'form' : id === 'mode-toggle' ? 'button' : 'div');
    els[id].ownerDoc = doc;
  }
  const confirms = [];
  const localStorage = {
    getItem(k) {
      if (opts.getThrows) throw new Error('blocked');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      if (opts.setThrows === true || opts.setThrows === k) throw new Error('QuotaExceededError');
      store[k] = String(v);
    },
  };
  const sandbox = {
    localStorage,
    window: {
      confirm: (msg) => {
        confirms.push(msg);
        if (Array.isArray(opts.confirm)) return opts.confirm.length ? opts.confirm.shift() : true;
        return opts.confirm !== false;
      },
    },
    document: {
      getElementById: (id) => els[id],
      createElement: (tag) => { const e = makeEl(tag); e.ownerDoc = doc; return e; },
      addEventListener: (type, fn) => { doc.listeners[type] = fn; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__state = () => ({ cards, nextId, mode, editing, reviewIndex, flipped });', sandbox);

  const list = els['card-list'];
  const review = els.review;
  const page = {
    els, confirms, doc,
    api: sandbox, // app.js top-level functions (setStatus, updateCard, ...)
    state: () => sandbox.__state(),
    notice: () => els['storage-notice'].textContent,
    listText: () => list.allText(),
    reviewText: () => review.allText(),
    questions: () => [...sandbox.__state().cards.map((c) => c.question)],
    statuses: () => [...sandbox.__state().cards.map((c) => c.status)],
    // list view
    listButtons: (action) => list.find((e) => e.tag === 'button' && e.dataset.action === action),
    clickList: (btn) => list.listeners.click({ target: btn }),
    editInput: (field) => list.find((e) => e.tag === 'input' && e.dataset.field === field)[0],
    editError: () => { const f = list.find((e) => e.tag === 'form'); return f.length ? f[0].find((e) => e.className === 'form-error')[0].textContent : null; },
    typeInto(field, v) { const i = page.editInput(field); i.value = v; list.listeners.input({ target: i }); },
    submitEdit() { list.listeners.submit({ preventDefault() {}, target: list.find((e) => e.tag === 'form')[0] }); },
    add(q, a) {
      els.question.value = q; els.answer.value = a;
      els['add-form'].listeners.submit({ preventDefault() {} });
    },
    // review view
    reviewButtons: (action) => review.find((e) => e.tag === 'button' && e.dataset.action === action),
    clickReview: (action) => review.listeners.click({ target: page.reviewButtons(action)[0] }),
    // focus helpers: which review control (data-focus) has focus now
    focusedKey: () => (doc.focused && doc.focused.dataset ? doc.focused.dataset.focus : null),
    focusReview(key) { const b = review.find((e) => e.dataset.focus === key)[0]; b.focus(); return b; },
    reviewStatus: () => els['review-status'].textContent,
    toggleMode: () => els['mode-toggle'].listeners.click(),
    // target: tag name string, or a real (fake) element such as a review button.
    key(key, target = 'BODY') {
      const t = typeof target === 'string' ? { tagName: target } : Object.assign(target, { tagName: target.tag.toUpperCase() });
      let prevented = false;
      doc.listeners.keydown({ key, target: t, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
  return page;
}

const card = (id, q, status = 'learning') => ({ id, question: q, answer: 'A' + id, status });
const deck = (...cards) => ({ [KEY]: JSON.stringify(cards) });
const stored = (store) => JSON.parse(store[KEY]);

module.exports = { loadPage, card, deck, stored, KEY, BACKUP };
