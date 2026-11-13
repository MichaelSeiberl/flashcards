'use strict';
// Simulated tests for steps 4-6 (edit, review mode, status). Run: node --test tests/
// NOT a real browser test; see tests/harness.js for the limits.
const test = require('node:test');
const assert = require('node:assert');
const { loadPage, card, deck, stored, KEY, BACKUP } = require('./harness');

const three = () => deck(card(1, 'one'), card(2, 'two'), card(3, 'three'));
const snapshot = (store) => JSON.stringify(store);

// ================= Step 4: edit =================
test('E1 edit: text changed and trimmed, id/status/order kept, stored [simulated]', () => {
  const store = deck(card(1, 'one'), card(2, 'two', 'known'), card(3, 'three'));
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[1]);
  assert.strictEqual(p.editInput('question').value, 'two');
  p.typeInto('question', '  new question  ');
  p.typeInto('answer', ' new answer ');
  p.submitEdit();
  const c = stored(store);
  assert.deepStrictEqual(c.map((x) => x.id), [1, 2, 3]);
  assert.strictEqual(c[1].question, 'new question');
  assert.strictEqual(c[1].answer, 'new answer');
  assert.strictEqual(c[1].status, 'known');
  assert.strictEqual(c[0].question, 'one');
  assert.strictEqual(p.state().editing, null);
  assert.strictEqual(p.listButtons('edit').length, 3);
});

test('E2 edit survives reload [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'changed');
  p.submitEdit();
  assert.deepStrictEqual([...loadPage(store).questions()], ['changed', 'two', 'three']);
});

test('E3 cancel without changes: no confirm, nothing written [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[0]);
  p.clickList(p.listButtons('cancel')[0]);
  assert.strictEqual(p.confirms.length, 0);
  assert.strictEqual(p.state().editing, null);
  assert.strictEqual(snapshot(store), before);
});

test('E4 cancel with unsaved text asks first; "no" keeps the draft, "yes" discards [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const p = loadPage(store, { confirm: [false, true] });
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'draft');
  p.clickList(p.listButtons('cancel')[0]);
  assert.strictEqual(p.confirms.length, 1);
  assert.strictEqual(p.editInput('question').value, 'draft');
  p.clickList(p.listButtons('cancel')[0]);
  assert.strictEqual(p.state().editing, null);
  assert.strictEqual(snapshot(store), before);
});

for (const [label, q, a, focusField] of [
  ['empty question', '', 'x', 'question'],
  ['whitespace-only question', '   ', 'x', 'question'],
  ['empty answer', 'x', '', 'answer'],
  ['whitespace-only answer', 'x', '  \t ', 'answer'],
]) {
  test(`E5 ${label}: rejected, error shown, draft kept, nothing written [simulated]`, () => {
    const store = three();
    const before = snapshot(store);
    const p = loadPage(store);
    p.clickList(p.listButtons('edit')[0]);
    p.typeInto('question', q);
    p.typeInto('answer', a);
    p.submitEdit();
    assert.strictEqual(snapshot(store), before);
    assert.ok(p.editError().includes('must not be empty'));
    assert.strictEqual(p.editInput('question').value, q);
    assert.strictEqual(p.editInput('answer').value, a);
    assert.strictEqual(p.doc.focused, p.editInput(focusField));
    assert.strictEqual(p.questions()[0], 'one');
  });
}

test('E6 write failure: card unchanged, text kept, clear message; retry works [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const opts = { setThrows: KEY };
  const p = loadPage(store, opts);
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'new q');
  p.typeInto('answer', 'new a');
  p.submitEdit();
  assert.strictEqual(snapshot(store), before);
  assert.strictEqual(p.questions()[0], 'one'); // not shown as saved
  assert.strictEqual(p.editInput('question').value, 'new q');
  assert.strictEqual(p.editInput('answer').value, 'new a');
  assert.ok(p.editError().includes('not changed'));
  assert.ok(p.editError().includes('Save again'));
  opts.setThrows = false; // storage works again
  p.submitEdit();
  assert.strictEqual(stored(store)[0].question, 'new q');
  assert.strictEqual(p.state().editing, null);
});

test('E7 saving locked (backup failed): edit not saved, text kept, original untouched [simulated]', () => {
  const raw = JSON.stringify([card(1, 'one'), { id: 'bad' }]);
  const store = { [KEY]: raw };
  const p = loadPage(store, { setThrows: BACKUP });
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'changed');
  p.submitEdit();
  assert.strictEqual(store[KEY], raw);
  assert.strictEqual(p.questions()[0], 'one');
  assert.strictEqual(p.editInput('question').value, 'changed');
  assert.ok(p.editError().includes('turned off'));
});

test('E8 HTML in edited text stays text [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', '<img src=x onerror=alert(1)>');
  p.submitEdit();
  assert.ok(p.listText().includes('<img src=x onerror=alert(1)>'));
});

test('E9 deleting another card while editing keeps the draft; deleting the edited card is not possible [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[1]);
  p.typeInto('question', 'draft');
  p.clickList(p.listButtons('delete')[0]); // card 1 (card 2 shows the form)
  assert.deepStrictEqual([...p.questions()], ['two', 'three']);
  assert.strictEqual(p.editInput('question').value, 'draft');
  assert.strictEqual(p.listButtons('delete').length, 1); // the edited card has no delete button
});

test('E10 adding a card while editing keeps the draft [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('answer', 'half typed');
  p.add('brand new', 'card');
  assert.strictEqual(p.editInput('answer').value, 'half typed');
  assert.strictEqual(p.state().cards.length, 4);
});

test('E11 starting another edit with unsaved text asks first [simulated]', () => {
  const store = three();
  const p = loadPage(store, { confirm: [false] });
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'draft');
  p.clickList(p.listButtons('edit')[0]); // card 2 is the first remaining edit button
  assert.strictEqual(p.confirms.length, 1);
  assert.strictEqual(p.state().editing.id, 1);
  assert.strictEqual(p.editInput('question').value, 'draft');
});

test('E12 edit button for a card that no longer exists is ignored [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const p = loadPage(store);
  const stale = p.listButtons('edit')[0];
  stale.dataset.id = '99';
  p.clickList(stale);
  assert.strictEqual(p.state().editing, null);
  assert.strictEqual(snapshot(store), before);
});

// ================= Step 6: status =================
test('S1 status toggles learning -> known -> learning and is stored [simulated]', () => {
  const store = three();
  const p = loadPage(store);
  assert.strictEqual(p.listButtons('status')[0].textContent, 'Mark as known');
  p.clickList(p.listButtons('status')[0]);
  assert.strictEqual(stored(store)[0].status, 'known');
  assert.strictEqual(p.listButtons('status')[0].textContent, 'Mark as still learning');
  assert.ok(p.listText().includes('Known'));
  p.clickList(p.listButtons('status')[0]);
  assert.strictEqual(stored(store)[0].status, 'learning');
});

test('S2 status survives reload; other cards unchanged [simulated]', () => {
  const store = three();
  loadPage(store).clickList(loadPage(store).listButtons('status')[1]);
  const p = loadPage(store);
  assert.deepStrictEqual([...p.statuses()], ['learning', 'known', 'learning']);
});

test('S3 write failure: status unchanged, notice shown [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const p = loadPage(store, { setThrows: KEY });
  p.clickList(p.listButtons('status')[0]);
  assert.strictEqual(snapshot(store), before);
  assert.strictEqual(p.statuses()[0], 'learning');
  assert.strictEqual(p.listButtons('status')[0].textContent, 'Mark as known');
  assert.ok(p.notice().includes('Nothing was changed'));
});

test('S4 saving locked: status not changed, notice shown [simulated]', () => {
  const raw = JSON.stringify([card(1, 'one'), { id: 'bad' }]);
  const store = { [KEY]: raw };
  const p = loadPage(store, { setThrows: BACKUP });
  p.clickList(p.listButtons('status')[0]);
  assert.strictEqual(store[KEY], raw);
  assert.strictEqual(p.statuses()[0], 'learning');
  assert.ok(p.notice().includes('turned off'));
});

test('S5 cards saved by the older version (same data format) load unchanged [simulated]', () => {
  const store = { [KEY]: '[{"id":1,"question":"Q","answer":"A","status":"known"},{"id":2,"question":"Q2","answer":"A2","status":"learning"}]' };
  const p = loadPage(store);
  assert.deepStrictEqual([...p.statuses()], ['known', 'learning']);
  assert.strictEqual(p.notice(), '');
  assert.ok(!(BACKUP in store));
});

test('S6 setStatus rejects unknown status values and unknown ids, nothing written [simulated]', () => {
  const store = three();
  const before = snapshot(store);
  const p = loadPage(store);
  assert.strictEqual(p.api.setStatus(1, 'bogus'), 'invalid');
  assert.strictEqual(p.api.setStatus(1, undefined), 'invalid');
  assert.strictEqual(p.api.setStatus(99, 'known'), 'not-found');
  assert.strictEqual(p.api.updateCard(99, 'q', 'a'), 'not-found');
  assert.strictEqual(p.api.updateCard(1, 'q', '   '), 'invalid');
  assert.strictEqual(snapshot(store), before);
});

// ================= Step 5: review mode =================
test('R1 review shows question first; flip shows answer and back [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  assert.strictEqual(p.state().mode, 'review');
  assert.strictEqual(p.els.review.hidden, false);
  assert.strictEqual(p.els['card-list'].hidden, true);
  assert.strictEqual(p.els['add-form'].hidden, true);
  assert.ok(p.reviewText().includes('Card 1 of 3'));
  assert.ok(p.reviewText().includes('one'));
  assert.ok(!p.reviewText().includes('A1'));
  p.clickReview('flip');
  assert.ok(p.reviewText().includes('A1'));
  p.clickReview('flip');
  assert.ok(p.reviewText().includes('one'));
});

test('R2 next/previous move within bounds; flip resets on move [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  assert.strictEqual(p.reviewButtons('prev')[0].disabled, true);
  p.clickReview('flip');
  p.clickReview('next');
  assert.strictEqual(p.state().reviewIndex, 1);
  assert.strictEqual(p.state().flipped, false);
  p.clickReview('next');
  assert.strictEqual(p.reviewButtons('next')[0].disabled, true);
  p.clickReview('next'); // stale click on disabled button: no effect
  assert.strictEqual(p.state().reviewIndex, 2);
  p.clickReview('prev');
  assert.strictEqual(p.state().reviewIndex, 1);
});

test('R3 keyboard: space flips, arrows navigate [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  assert.strictEqual(p.key(' '), true); // default (page scroll) prevented
  assert.strictEqual(p.state().flipped, true);
  p.key('ArrowRight');
  assert.strictEqual(p.state().reviewIndex, 1);
  assert.strictEqual(p.state().flipped, false);
  p.key('ArrowLeft');
  p.key('ArrowLeft'); // at the start: no effect
  assert.strictEqual(p.state().reviewIndex, 0);
});

test('R4 space on a focused button or input does not flip twice / is ignored [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.key(' ', 'BUTTON');
  p.key(' ', 'INPUT');
  assert.strictEqual(p.state().flipped, false);
});

test('R5 keys do nothing outside review mode [simulated]', () => {
  const p = loadPage(three());
  p.key(' ');
  p.key('ArrowRight');
  assert.strictEqual(p.state().flipped, false);
  assert.strictEqual(p.state().reviewIndex, 0);
});

test('R6 mark known/still learning in review is stored; failure leaves status and shows notice [simulated]', () => {
  const store = three();
  const opts = {};
  const p = loadPage(store, opts);
  p.toggleMode();
  p.clickReview('known');
  assert.strictEqual(stored(store)[0].status, 'known');
  assert.ok(p.reviewText().includes('Known'));
  p.clickReview('next');
  opts.setThrows = KEY;
  p.clickReview('known');
  assert.strictEqual(stored(store)[1].status, 'learning');
  assert.ok(p.notice().includes('Nothing was changed'));
  opts.setThrows = false;
  p.clickReview('known');
  assert.strictEqual(stored(store)[1].status, 'known');
  assert.strictEqual(p.notice(), '');
});

test('R7 empty deck: message, no crash, back works [simulated]', () => {
  const p = loadPage({});
  p.toggleMode();
  assert.ok(p.reviewText().includes('No flashcards to review'));
  p.key(' ');
  p.key('ArrowRight');
  p.toggleMode();
  assert.strictEqual(p.state().mode, 'list');
  assert.ok(p.listText().includes('No flashcards yet'));
});

test('R8 leaving and re-entering review starts at card 1, question side [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.clickReview('next');
  p.clickReview('flip');
  p.toggleMode();
  assert.strictEqual(p.els['add-form'].hidden, false);
  assert.strictEqual(p.els['card-list'].hidden, false);
  p.toggleMode();
  assert.strictEqual(p.state().reviewIndex, 0);
  assert.strictEqual(p.state().flipped, false);
});

test('R9 entering review with unsaved edit text asks first; "no" stays in list [simulated]', () => {
  const p = loadPage(three(), { confirm: [false, true] });
  p.clickList(p.listButtons('edit')[0]);
  p.typeInto('question', 'draft');
  p.toggleMode();
  assert.strictEqual(p.state().mode, 'list');
  assert.strictEqual(p.editInput('question').value, 'draft');
  p.toggleMode();
  assert.strictEqual(p.state().mode, 'review');
  assert.strictEqual(p.state().editing, null);
});

test('R10 review shows text safely and review does not write on its own [simulated]', () => {
  const store = deck(card(1, '<b>x</b>'));
  const before = snapshot(store);
  const p = loadPage(store);
  p.toggleMode();
  p.clickReview('flip');
  p.clickReview('flip'); // back to the question side
  assert.ok(p.reviewText().includes('<b>x</b>'));
  assert.strictEqual(snapshot(store), before);
});
