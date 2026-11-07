/* The lock screen has one word now: open Dawam and start a round.

   The hold-to-step-out button that used to sit beside it is gone. It was built
   as friction — two and a half seconds of deliberate press — and friction is
   not what it became. It turned into the ordinary way to open the laptop, a
   ritual performed without deciding anything, which is precisely the habit
   commitment mode exists to interrupt. A door with a slow handle is a door.

   What replaces it is not more severity. Dawam's focus page will start a
   round on a reward, so "I am going to rest for twenty minutes" is an answer
   the lock accepts. The thing that is no longer possible is opening the
   machine without answering at all. */
document.getElementById('open-rhythm').addEventListener('click', () => {
  window.rhythmFocus.openPlanner();
});
