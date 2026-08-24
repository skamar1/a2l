// A2Labs — Hero carousel + counters (αρχική)
// Ήταν inline στο layouts/index.html· βγήκε σε αρχείο ώστε το CSP
// να μπορεί να είναι script-src 'self' χωρίς 'unsafe-inline'.
(function () {
  var slides = document.querySelectorAll('.carousel-slide');
  var dots   = document.querySelectorAll('.carousel-dot');
  var prev   = document.getElementById('carouselPrev');
  var next   = document.getElementById('carouselNext');
  var prog   = document.getElementById('carouselProgress');
  var hero   = document.getElementById('hero');
  var cur    = 0;
  var timer;
  var paused = false;
  var DUR    = 6000;

  function goTo(i) {
    slides.forEach(function(s) { s.classList.remove('active-slide'); });
    dots.forEach(function(d)   { d.classList.remove('active-dot'); });
    cur = ((i % slides.length) + slides.length) % slides.length;
    slides[cur].classList.add('active-slide');
    dots[cur].classList.add('active-dot');
    prog.classList.remove('running', 'paused');
    void prog.offsetWidth;
    if (!paused) prog.classList.add('running');
  }

  function autoplay() {
    clearInterval(timer);
    timer = setInterval(function() { if (!paused) goTo(cur + 1); }, DUR);
  }

  goTo(0);
  autoplay();

  next.addEventListener('click', function() { goTo(cur + 1); autoplay(); });
  prev.addEventListener('click', function() { goTo(cur - 1); autoplay(); });
  dots.forEach(function(d) {
    d.addEventListener('click', function() { goTo(parseInt(d.dataset.dot)); autoplay(); });
  });

  hero.addEventListener('mouseenter', function() { paused = true;  prog.classList.add('paused'); });
  hero.addEventListener('mouseleave', function() { paused = false; prog.classList.remove('paused'); autoplay(); });

  var tx = 0;
  hero.addEventListener('touchstart', function(e) { tx = e.changedTouches[0].screenX; }, { passive: true });
  hero.addEventListener('touchend',   function(e) {
    var diff = tx - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) { diff > 0 ? goTo(cur + 1) : goTo(cur - 1); autoplay(); }
  }, { passive: true });

  // Counters — run after first paint so CSS (display:none → block) is applied
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      var stats = document.querySelector('.carousel-stats');
      if (!stats || getComputedStyle(stats).display === 'none') return;
      var counters = document.querySelectorAll('.counter');
      counters.forEach(function(c) {
        var target = parseInt(c.getAttribute('data-target'));
        var step   = target / (2000 / 16);
        var val    = 0;
        c.textContent = '0';
        (function tick() {
          val += step;
          if (val < target) { c.textContent = Math.ceil(val); requestAnimationFrame(tick); }
          else { c.textContent = target; }
        })();
      });
    });
  });
})();
