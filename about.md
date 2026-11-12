# Flashcards

A study tool. Users create question/answer cards, flip them in review mode, and mark each as known or unknown.

# Core interactions
- Add a new card with a question and an answer
- Enter review mode: cards show the question first; click or press space to flip to the answer
- Mark each card as Known or Still learning
- Edit or delete a card from the list
- Deck persists across reloads

# Features your app should have
Whichever option you picked, the following should work.


# Core functionality
- Add flow. An input field and a button. Empty submissions are rejected (the user cannot create blank items).
- Delete flow. A way to remove an item. The removal persists on reload.
- Update flow. At least one state change per item: mark complete, edit in place, flip a card, or tick a day.
- Empty state. When there are no items, the page shows a readable message, not a blank screen. "No flashcards yet. Add your first card." counts.
- - Keyboard support. Pressing Enter in the input field adds an item.
Persistence. Reload the page. The data is still there.

# Visual standards
- Responsive-enough layout. The app is usable at 1280 px and 375 px width. Nothing should overflow or disappear.
- Consistent styling. Buttons look like buttons. Inputs look like inputs. The page has spacing; it does not look like a raw HTML dump.
- Readable contrast. Text is readable on its background without squinting.

# Stretch features
- Counter or stats. "3 tasks left". "5 of 7 habits done today". "12 cards in this deck, 4 still learning."

# Future Enhancement - Optional: Leitner Learning System
- Implement a five-box spaced repetition system. Correctly answered cards move to the next box, while incorrect answers return to Box 1. Review intervals increase with each box to support long-term retention. 
Cards are considered mastered after successfully completing Box 5.
