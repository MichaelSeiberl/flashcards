'use strict';
// Simulated regression tests: keyboard focus and screen reader announcements in
// review mode. NOT a real browser test (fake focus); see tests/harness.js.
const test = require('node:test');
const assert = require('node:assert');
const { loadPage, card, deck } = require('./harness');

const three = () => deck(card(1, 'one'), card(2, 'two'), card(3, 'three'));

test('F1 focus stays on Known / Still learning after marking [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.reviewButtons('known')[0].focus();
  p.clickReview('known');
  assert.strictEqual(p.focusedKey(), 'known');
  p.reviewButtons('learning')[0].focus();
  p.clickReview('learning');
  assert.strictEqual(p.focusedKey(), 'learning');
});

test('F2 arrow keys keep focus on the focused review button [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.key('ArrowRight', p.focusReview('known'));
  assert.strictEqual(p.state().reviewIndex, 1);
  assert.strictEqual(p.focusedKey(), 'known');
  p.key('ArrowLeft', p.focusReview('next'));
  assert.strictEqual(p.focusedKey(), 'next');
});

test('F3 at the last card Next hands focus to Previous; at the first, Previous to Next [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.clickReview('next');
  p.reviewButtons('next')[0].focus();
  p.clickReview('next'); // now on the last card, Next is disabled
  assert.strictEqual(p.state().reviewIndex, 2);
  assert.strictEqual(p.focusedKey(), 'prev');
  p.clickReview('prev');
  p.clickReview('prev'); // first card, Previous is disabled
  assert.strictEqual(p.state().reviewIndex, 0);
  assert.strictEqual(p.focusedKey(), 'next');
});

test('F4 single card: both nav buttons disabled, focus falls back to flip [simulated]', () => {
  const p = loadPage(deck(card(1, 'only')));
  p.toggleMode();
  p.key('ArrowRight', p.focusReview('next'));
  assert.strictEqual(p.focusedKey(), 'flip');
});

test('F5 flip via the card face keeps focus on the card face [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  const face = p.reviewButtons('flip').find((b) => b.dataset.focus === 'face');
  face.focus();
  p.els.review.listeners.click({ target: face });
  assert.strictEqual(p.state().flipped, true);
  assert.strictEqual(p.focusedKey(), 'face');
});

test('F6 keys on the page body do not steal focus [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.key('ArrowRight');
  assert.strictEqual(p.focusedKey(), null);
});

test('A1 review view is not a live region; one persistent polite status exists [simulated]', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/id="review"[^>]*aria-live/.test(html));
  assert.ok(/id="review-status"[^>]*role="status"/.test(html));
});

test('A2 card change announces only a short message, not the whole view [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.clickReview('next');
  assert.strictEqual(p.reviewStatus(), 'Card 2 of 3. Question: two');
  p.key(' ');
  assert.strictEqual(p.reviewStatus(), 'Answer: A2');
  p.clickReview('known');
  assert.strictEqual(p.reviewStatus(), 'Marked as known.');
});

test('A3 no announcement when nothing changes (boundary) and cleared on leaving review [simulated]', () => {
  const p = loadPage(three());
  p.toggleMode();
  p.clickReview('known');
  p.key('ArrowLeft'); // already first card
  assert.strictEqual(p.reviewStatus(), 'Marked as known.');
  p.toggleMode();
  assert.strictEqual(p.reviewStatus(), '');
});
