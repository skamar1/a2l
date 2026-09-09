// A2Labs — Main JS

(function () {
  'use strict';

  // --- Hero Carousel ---
  var slides = document.querySelectorAll('.hero-carousel__slide');
  var dots   = document.querySelectorAll('.hero-carousel__dot');
  var current = 0;
  var timer;

  function goTo(index) {
    slides[current].classList.remove('hero-carousel__slide--active');
    dots[current].classList.remove('hero-carousel__dot--active');
    dots[current].setAttribute('aria-selected', 'false');
    current = index;
    slides[current].classList.add('hero-carousel__slide--active');
    dots[current].classList.add('hero-carousel__dot--active');
    dots[current].setAttribute('aria-selected', 'true');
  }

  function startTimer() {
    timer = setInterval(function () {
      goTo((current + 1) % slides.length);
    }, 5000);
  }

  if (slides.length > 1) {
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        clearInterval(timer);
        goTo(i);
        startTimer();
      });
    });

    var carousel = document.getElementById('heroCarousel');
    if (carousel) {
      carousel.addEventListener('mouseenter', function () { clearInterval(timer); });
      carousel.addEventListener('mouseleave', startTimer);
    }

    startTimer();
  }

  // --- Mobile menu toggle ---
  const toggle = document.querySelector('.nav__toggle');
  const mobileNav = document.querySelector('.nav__mobile');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      const isOpen = mobileNav.classList.toggle('is-open');
      toggle.classList.toggle('is-active', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!toggle.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  // --- Dropdown: click toggle (touch / keyboard) ---
  document.querySelectorAll('.nav__dropdown-toggle').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var dropdown = btn.closest('.nav__dropdown');
      var isOpen = dropdown.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen);
    });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', function () {
    document.querySelectorAll('.nav__dropdown.is-open').forEach(function (d) {
      d.classList.remove('is-open');
      d.querySelector('.nav__dropdown-toggle').setAttribute('aria-expanded', 'false');
    });
  });

  // --- Scroll: add class to header on scroll ---
  const header = document.querySelector('.header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('header--scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  // --- Δυναμικό background από data-bg ---
  // Το URL της εικόνας είναι διαφορετικό ανά σελίδα, οπότε δεν μπορεί να ζει
  // σε κλάση του CSS. Μπαίνει μέσω CSSOM και όχι ως style="..." attribute:
  // το CSP του site δεν επιτρέπει 'unsafe-inline' στο style-src.
  document.querySelectorAll('[data-bg]').forEach(function (el) {
    var url = el.getAttribute('data-bg');
    if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
  });

  // --- Animate elements on scroll ---
  if ('IntersectionObserver' in window) {
    // Το CSS κρύβει τα [data-animate] μόνο όταν υπάρχει αυτή η κλάση, ώστε
    // χωρίς JS να μη μείνει τίποτα αόρατο.
    document.documentElement.classList.add('has-anim');
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-animate]').forEach(function (el) {
      observer.observe(el);
    });
  }

  // --- Parallax ---
  // Γράφει τη μεταβλητή --p σε κάθε [data-parallax] και το CSS μετακινεί τα
  // layers με διαφορετικό συντελεστή. Δύο τρόποι μέτρησης:
  //   (προεπιλογή)  -1 όταν η ενότητα μπαίνει από κάτω, 0 στο κέντρο της
  //                 οθόνης, +1 όταν βγαίνει από πάνω.
  //   "top"         0 όσο η ενότητα είναι στην κορυφή, 1 όταν έχει φύγει
  //                 ολόκληρη — για το hero, που δεν «μπαίνει» ποτέ από κάτω.
  // Η εγγραφή γίνεται μέσω CSSOM, όχι με style="..." attribute: το CSP του
  // site δεν έχει 'unsafe-inline'. Χωρίς JS το --p μένει 0 και όλα κάθονται
  // στη θέση τους.
  (function () {
    var sections = document.querySelectorAll('[data-parallax]');
    if (!sections.length) return;
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var visible = [];
    var queued = false;

    function progress(el, box, vh) {
      if (el.getAttribute('data-parallax') === 'top') {
        return Math.min(1, Math.max(0, -box.top / box.height));
      }
      return ((vh - box.top) / (vh + box.height)) * 2 - 1;
    }

    function paint() {
      queued = false;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      visible.forEach(function (el) {
        var p = progress(el, el.getBoundingClientRect(), vh);
        el.style.setProperty('--p', p.toFixed(4));
      });
    }

    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    }

    // Ο listener του scroll μπαίνει μόνο όσο μια ενότητα είναι στην οθόνη.
    var watcher = new IntersectionObserver(function (entries) {
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

    sections.forEach(function (el) { watcher.observe(el); });
  })();
})();
