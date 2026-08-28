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
})();
