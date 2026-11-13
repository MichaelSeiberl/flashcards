'use strict';
// Simulated tests for step 2 (persistence). Run: node --test tests/
// app.js is executed in a Node vm sandbox with a FAKE document and a FAKE
// localStorage. This is NOT a real browser test (no real DOM, no real storage).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const KEY = 'flashcards:v1';
const BACKUP = 'flashcards:v1:backup';

// Minimal fake DOM element: only what app.js uses.
function makeEl() {
  let text = '';
  return {
    children: [],
    value: '',
    listeners: {},
    get textContent() { return text; },
    set textContent(v) { text = v; this.children = []; },
    focus() {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    // Collects all text below this element.
    allText() {
      return text + this.children.map((c) => (typeof c === 'string' ? c : c.allText())).join('');
    },
  };
}

// Starts a fresh "page load" with the given storage object.
// opts.getThrows: getItem throws.
// opts.setThrows: true (all keys) or a key name -> setItem always throws.
// opts.failSets: number of initial setItem calls that throw, then storage works.
function loadPage(store, opts = {}) {
  const els = {};
  for (const id of ['add-form', 'question', 'answer', 'form-error', 'storage-notice', 'card-list']) {
    els[id] = makeEl();
  }
  let failsLeft = opts.failSets || 0;
  const localStorage = {
    getItem(k) {
      if (opts.getThrows) throw new Error('blocked');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      if (failsLeft > 0) {
        failsLeft--;
        throw new Error('QuotaExceededError');
      }
      if (opts.setThrows === true || opts.setThrows === k) {
        throw new Error('QuotaExceededError');
      }
      store[k] = String(v);
    },
  };
  const sandbox = {
    localStorage,
    document: { getElementById: (id) => els[id], createElement: () => makeEl() },
  };
  vm.createContext(sandbox);
  // `let` variables of app.js are exposed through a getter appended to the script.
  vm.runInContext(SRC + '\n;this.__state = () => ({ cards, nextId });', sandbox);
  return {
    els,
    state: () => sandbox.__state(),
    notice: () => els['storage-notice'].textContent,
    add(q, a) {
      els.question.value = q;
      els.answer.value = a;
      els['add-form'].listeners.submit({ preventDefault() {} });
    },
  };
}

const VALID = '{"id":1,"question":"Q","answer":"A","status":"learning"}';

test('T2-1 two cards survive a reload, same order [simulated]', () => {
  const store = {};
  const p = loadPage(store);
  p.add('first', '1');
  p.add('second', '2');
  const p2 = loadPage(store);
  // [...] copies the array into this realm (vm arrays have a different prototype).
  assert.deepStrictEqual([...p2.state().cards.map((c) => c.question)], ['first', 'second']);
});

test('T2-2 storage holds a JSON array, no backup, no notice [simulated]', () => {
  const store = {};
  loadPage(store).add('q', 'a');
  assert.ok(Array.isArray(JSON.parse(store[KEY])));
  assert.ok(!(BACKUP in store));
  assert.strictEqual(loadPage(store).notice(), '');
});

test('T2-3 ids unique and ascending after reload [simulated]', () => {
  const store = {};
  loadPage(store).add('a', '1');
  loadPage(store).add('b', '2');
  const p = loadPage(store);
  p.add('c', '3');
  assert.deepStrictEqual([...p.state().cards.map((c) => c.id)], [1, 2, 3]);
});

test('T2-4 missing key: empty state, no notice, no backup [simulated]', () => {
  const store = {};
  const p = loadPage(store);
  assert.strictEqual(p.state().cards.length, 0);
  assert.strictEqual(p.notice(), '');
  assert.ok(!(BACKUP in store));
  assert.ok(p.els['card-list'].allText().includes('No flashcards yet. Add your first card.'));
});

for (const [id, raw, kept] of [
  ['T2-5 invalid JSON', 'kaputt', 0],
  ['T2-6 valid JSON but not an array', '{"a":1}', 0],
  ['T2-7 array with one valid and one invalid card', `[${VALID},{"id":"x"}]`, 1],
]) {
  test(`${id}: backup of raw value, notice, load does not overwrite [simulated]`, () => {
    const store = { [KEY]: raw };
    const p = loadPage(store);
    assert.strictEqual(p.state().cards.length, kept);
    assert.strictEqual(store[BACKUP], raw);
    assert.strictEqual(store[KEY], raw); // loading alone never overwrites
    assert.notStrictEqual(p.notice(), '');
  });
}

test('T2-8 duplicate ids: only one kept, backup exists [simulated]', () => {
  const raw = `[${VALID},{"id":1,"question":"Q2","answer":"A2","status":"known"}]`;
  const store = { [KEY]: raw };
  const p = loadPage(store);
  assert.strictEqual(p.state().cards.length, 1);
  assert.strictEqual(store[BACKUP], raw);
});

test('T2-9 stored id 41 -> next card gets id 42 [simulated]', () => {
  const store = { [KEY]: '[{"id":41,"question":"Q","answer":"A","status":"known"}]' };
  const p = loadPage(store);
  p.add('n', 'm');
  assert.strictEqual(p.state().cards[1].id, 42);
});

test('T2-10 HTML in text stays text (textContent only) [simulated]', () => {
  const store = {};
  loadPage(store).add('<b>fett</b>', '<i>x</i>');
  const p = loadPage(store);
  assert.strictEqual(p.state().cards[0].question, '<b>fett</b>');
  assert.ok(p.els['card-list'].allText().includes('<b>fett</b>'));
  // No HTML-injecting API is used in code (the word may appear in comments).
  assert.ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/.test(SRC));
});

test('T2-11 after corruption the app saves again, backup keeps old raw [simulated]', () => {
  const store = { [KEY]: 'kaputt' };
  loadPage(store).add('q', 'a');
  assert.strictEqual(JSON.parse(store[KEY]).length, 1);
  assert.strictEqual(store[BACKUP], 'kaputt');
});

test('T2-12 write failure: rollback, form kept, notice, nothing stored [simulated]', () => {
  const store = {};
  const p = loadPage(store, { setThrows: true });
  p.add('q', 'a');
  assert.strictEqual(p.state().cards.length, 0);
  assert.strictEqual(p.state().nextId, 1);
  assert.strictEqual(p.els.question.value, 'q');
  assert.strictEqual(p.els.answer.value, 'a');
  assert.ok(p.notice().startsWith('Could not save the card.'));
  assert.ok(!(KEY in store));
  assert.ok(p.els['card-list'].allText().includes('No flashcards yet'));
});

test('T2-13 after a reload with working storage, saving works, no notice [simulated]', () => {
  const store = {};
  const p = loadPage(store, { setThrows: true });
  p.add('q', 'a'); // fails, notice shown
  assert.notStrictEqual(p.notice(), '');
  const p2 = loadPage(store); // reload, storage works again
  p2.add('q', 'a');
  assert.strictEqual(p2.state().cards.length, 1);
  assert.strictEqual(p2.notice(), '');
  assert.strictEqual(p2.els.question.value, '');
});

test('T2-13b same page: failed save, then successful save clears the notice [simulated]', () => {
  const store = {};
  const p = loadPage(store, { failSets: 1 });
  p.add('q', 'a');
  assert.strictEqual(p.state().cards.length, 0);
  assert.notStrictEqual(p.notice(), '');
  p.add('q', 'a'); // form was kept; submit again
  assert.strictEqual(p.state().cards.length, 1);
  assert.strictEqual(p.state().cards[0].id, 1); // id not burned by the failed attempt
  assert.strictEqual(p.notice(), '');
  assert.strictEqual(JSON.parse(store[KEY]).length, 1);
});

test('T2-14 second corruption overwrites backup (known limit 1) [simulated]', () => {
  const store = { [KEY]: 'kaputt' };
  loadPage(store);
  store[KEY] = '{"x":2}';
  loadPage(store);
  assert.strictEqual(store[BACKUP], '{"x":2}');
});

test('EXTRA getItem throws: empty list, notice, no crash [simulated]', () => {
  const p = loadPage({}, { getThrows: true });
  assert.strictEqual(p.state().cards.length, 0);
  assert.ok(p.notice().includes('not available'));
});

test('EXTRA backup write fails: notice says so, app still runs [simulated]', () => {
  const store = { [KEY]: 'kaputt' };
  const p = loadPage(store, { setThrows: BACKUP });
  assert.ok(p.notice().includes('could not be saved'));
  p.add('q', 'a');
  assert.strictEqual(p.state().cards.length, 1);
});

test('EXTRA load notice stays after a successful save [simulated]', () => {
  const p = loadPage({ [KEY]: 'kaputt' });
  p.add('q', 'a');
  assert.ok(p.notice().includes('invalid'));
});

// Regression (step 1 behavior; the original manual tests A1-A8 are not in the repo)
test('REG empty and whitespace-only input rejected, error shown [simulated]', () => {
  for (const [q, a] of [['', ''], ['  ', 'x'], ['x', '  ']]) {
    const store = {};
    const p = loadPage(store);
    p.add(q, a);
    assert.strictEqual(p.state().cards.length, 0);
    assert.strictEqual(p.els['form-error'].textContent, 'Please enter a question and an answer.');
    assert.ok(!(KEY in store));
  }
});

test('REG valid card: added, trimmed, status learning, form cleared, rendered [simulated]', () => {
  const p = loadPage({});
  p.add('  Q  ', '  A  ');
  const c = p.state().cards[0];
  assert.deepStrictEqual({ ...c }, { id: 1, question: 'Q', answer: 'A', status: 'learning' });
  assert.strictEqual(p.els.question.value, '');
  assert.strictEqual(p.els['form-error'].textContent, '');
  assert.ok(p.els['card-list'].allText().includes('Q: Q'));
});
