'use strict';
// Simulated tests for step 3 (delete card). Run: node --test tests/
// app.js runs in a Node vm sandbox with a FAKE document, FAKE localStorage
// and a FAKE window.confirm. This is NOT a real browser test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const KEY = 'flashcards:v1';
const BACKUP = 'flashcards:v1:backup';

function makeEl() {
  let text = '';
  const el = {
    children: [], value: '', listeners: {}, dataset: {}, attrs: {},
    get textContent() { return text; },
    set textContent(v) { text = v; this.children = []; },
    focus() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    closest(sel) { return sel === 'button[data-id]' && this.tag === 'button' && 'id' in this.dataset ? this : null; },
    allText() { return text + this.children.map((c) => (typeof c === 'string' ? c : c.allText())).join(''); },
    find(pred, acc = []) {
      if (pred(this)) acc.push(this);
      this.children.forEach((c) => typeof c !== 'string' && c.find(pred, acc));
      return acc;
    },
  };
  return el;
}

// opts.getThrows, opts.setThrows (true or key), opts.confirm (default true)
function loadPage(store, opts = {}) {
  const els = {};
  for (const id of ['add-form', 'question', 'answer', 'form-error', 'storage-notice', 'card-list', 'review', 'mode-toggle']) els[id] = makeEl();
  let confirmAnswer = opts.confirm !== false;
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
    window: { confirm: (msg) => { confirms.push(msg); return confirmAnswer; } },
    document: { addEventListener() {}, getElementById: (id) => els[id], createElement: (tag) => { const e = makeEl(); e.tag = tag; return e; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__state = () => ({ cards, nextId });', sandbox);
  const buttons = () => els['card-list'].find((e) => e.tag === 'button' && e.dataset.action === 'delete');
  return {
    els, confirms, buttons,
    setConfirm: (v) => { confirmAnswer = v; },
    state: () => sandbox.__state(),
    notice: () => els['storage-notice'].textContent,
    listText: () => els['card-list'].allText(),
    add(q, a) {
      els.question.value = q; els.answer.value = a;
      els['add-form'].listeners.submit({ preventDefault() {} });
    },
    click(btn) { els['card-list'].listeners.click({ target: btn }); },
  };
}

const card = (id, q) => `{"id":${id},"question":"${q}","answer":"A${id}","status":"learning"}`;
const three = () => ({ [KEY]: `[${card(1, 'one')},${card(2, 'two')},${card(3, 'three')}]` });
const questions = (p) => [...p.state().cards.map((c) => c.question)];

test('D1 confirm yes: only that card removed, order kept, storage updated [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.click(p.buttons()[1]);
  assert.deepStrictEqual(questions(p), ['one', 'three']);
  assert.deepStrictEqual(JSON.parse(store[KEY]).map((c) => c.id), [1, 3]);
  assert.strictEqual(p.buttons().length, 2);
  assert.strictEqual(p.confirms.length, 1);
});

test('D2 confirm cancel: nothing changes, nothing written [simulated]', () => {
  const store = three();
  const before = JSON.stringify(store);
  const p = loadPage(store, { confirm: false });
  p.click(p.buttons()[0]);
  assert.strictEqual(p.state().cards.length, 3);
  assert.strictEqual(JSON.stringify(store), before);
});

test('D3 last card deleted: empty state shown, storage is [] [simulated]', () => {
  const store = { [KEY]: `[${card(1, 'one')}]` };
  const p = loadPage(store);
  p.click(p.buttons()[0]);
  assert.ok(p.listText().includes('No flashcards yet'));
  assert.strictEqual(store[KEY], '[]');
});

test('D4 deletion survives reload [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.click(p.buttons()[0]);
  assert.deepStrictEqual(questions(loadPage(store)), ['two', 'three']);
});

test('D5 unknown id: no confirm, no change, nothing written [simulated]', () => {
  const store = three();
  const before = JSON.stringify(store);
  const p = loadPage(store);
  for (const id of ['99', 'abc', '']) {
    const fake = makeEl(); fake.tag = 'button'; fake.dataset.id = id; fake.dataset.action = 'delete';
    p.click(fake);
  }
  p.click(makeEl()); // click that is not on a delete button
  assert.strictEqual(p.confirms.length, 0);
  assert.strictEqual(p.state().cards.length, 3);
  assert.strictEqual(JSON.stringify(store), before);
});

test('D6 write failure: card stays in list and storage, notice shown [simulated]', () => {
  const store = three();
  const before = JSON.stringify(store);
  const p = loadPage(store, { setThrows: KEY });
  p.click(p.buttons()[0]);
  assert.strictEqual(p.state().cards.length, 3);
  assert.strictEqual(JSON.stringify(store), before);
  assert.strictEqual(p.buttons().length, 3);
  assert.ok(p.notice().includes('Nothing was deleted'));
});

test('D7a read failure (saving locked): delete blocked, data untouched [simulated]', () => {
  const store = three();
  const before = JSON.stringify(store);
  const p = loadPage(store, { getThrows: true });
  assert.strictEqual(p.buttons().length, 0); // nothing loaded, nothing to delete
  assert.strictEqual(JSON.stringify(store), before);
});

test('D7b backup failure (saving locked): valid cards shown, delete blocked [simulated]', () => {
  const raw = `[${card(1, 'one')},{"id":"x"}]`;
  const store = { [KEY]: raw };
  const p = loadPage(store, { setThrows: BACKUP });
  assert.strictEqual(p.buttons().length, 1);
  p.click(p.buttons()[0]);
  assert.strictEqual(p.state().cards.length, 1);
  assert.strictEqual(store[KEY], raw);
  assert.ok(p.notice().includes('Nothing was deleted'));
});

test('D8 delete then add: new id is above all existing ids [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.click(p.buttons()[0]); // delete id 1
  p.add('new', 'x');
  assert.deepStrictEqual([...p.state().cards.map((c) => c.id)], [2, 3, 4]);
});

test('D9 double click on the same button: only one card deleted [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  const btn = p.buttons()[0];
  p.click(btn);
  p.click(btn); // stale button, card already gone
  assert.deepStrictEqual(questions(p), ['two', 'three']);
  assert.strictEqual(p.confirms.length, 1);
});

test('D10 HTML in question is shown as text, not markup [simulated]', () => {
  const store = { [KEY]: `[${card(1, '<img src=x onerror=alert(1)>')}]` };
  const p = loadPage(store);
  assert.ok(p.listText().includes('<img src=x onerror=alert(1)>'));
  assert.strictEqual(p.buttons()[0].attrs['aria-label'], 'Delete card: <img src=x onerror=alert(1)>');
});
