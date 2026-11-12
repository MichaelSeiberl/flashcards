'use strict';

/*
 * Data model (one card):
 *   { id, question, answer, status }
 *   status: 'learning' (UI: "Still learning") | 'known' (UI: "Known")
 *
 * Step 0: in-memory only. Persistence (localStorage) is added in step 2.
 */
let cards = [];

// Central render function. Placeholder: later steps draw the UI here.
function render() {
  const app = document.getElementById('app');
  app.textContent = '';
}

render();
