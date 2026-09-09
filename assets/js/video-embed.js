// A2Labs — Video embed (facade)
//
// Το <iframe> του YouTube δεν υπάρχει στο HTML. Μπαίνει εδώ, με το κλικ στο
// κουμπί αναπαραγωγής, και δείχνει στο youtube-nocookie.com. Έτσι όποιος δεν
// παίξει το βίντεο δεν στέλνει τίποτα στην Google, και η σελίδα δεν κουβαλά
// ~1MB JavaScript του player σε κάθε φόρτωση.
//
// Το parallax της ενότητας το κάνει το main.js ([data-parallax]).

(function () {
  'use strict';

  document.querySelectorAll('.video-embed__btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.video-embed__card');
      if (!card || card.classList.contains('is-playing')) return;

      var id = card.getAttribute('data-video-id');
      if (!id) return;

      var frame = document.createElement('iframe');
      frame.className = 'video-embed__iframe';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
                  '?autoplay=1&rel=0&modestbranding=1&hl=el';
      frame.title = card.getAttribute('data-video-title') || 'Βίντεο';
      // Το fullscreen δίνεται μέσω του allow. Το παλιό allowfullscreen attribute
      // δεν μπαίνει: ο browser το αγνοεί όταν υπάρχει allow και γράφει
      // προειδοποίηση στην κονσόλα.
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

      card.appendChild(frame);
      card.classList.add('is-playing');
    });
  });
})();
