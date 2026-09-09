// A2Labs — Video embed: facade + parallax
//
// 1. Facade: το <iframe> του YouTube δεν υπάρχει στο HTML. Μπαίνει εδώ, με
//    το κλικ στο κουμπί αναπαραγωγής, και δείχνει στο youtube-nocookie.com.
//    Έτσι όποιος δεν παίξει το βίντεο δεν στέλνει τίποτα στην Google, και η
//    σελίδα δεν κουβαλά ~1MB JavaScript του player σε κάθε φόρτωση.
//
// 2. Parallax: γράφουμε τη μεταβλητή --p στην ενότητα (-1 όταν μπαίνει από
//    κάτω, 0 στο κέντρο, +1 όταν βγαίνει από πάνω) και το CSS μετακινεί τα
//    layers με διαφορετικό συντελεστή. Η εγγραφή γίνεται μέσω CSSOM, όχι με
//    style="..." attribute: το CSP του site δεν έχει 'unsafe-inline'.

(function () {
  'use strict';

  // --- 1. Αναπαραγωγή με κλικ ---
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

  // --- 2. Parallax ---
  var sections = document.querySelectorAll('[data-parallax]');
  if (!sections.length) return;
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var visible = [];
  var queued = false;

  function paint() {
    queued = false;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    visible.forEach(function (el) {
      var box = el.getBoundingClientRect();
      // 0 όταν το κέντρο της ενότητας πέφτει στο κέντρο της οθόνης.
      var p = ((vh - box.top) / (vh + box.height)) * 2 - 1;
      el.style.setProperty('--p', p.toFixed(4));
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  }

  // Ο listener του scroll μπαίνει μόνο όσο μια ενότητα είναι στην οθόνη.
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var i = visible.indexOf(entry.target);
      if (entry.isIntersecting && i === -1) visible.push(entry.target);
      else if (!entry.isIntersecting && i !== -1) visible.splice(i, 1);
    });

    if (visible.length) {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      schedule();
    } else {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    }
  }, { rootMargin: '120px 0px' });

  sections.forEach(function (el) { observer.observe(el); });
})();
