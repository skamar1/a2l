// A2Labs — υποβολή φόρμας επικοινωνίας προς /api/contact
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
document.getElementById('contactForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  var btn     = document.getElementById('submitBtn');
  var success = document.getElementById('form-success');
  var error   = document.getElementById('form-error');

  btn.disabled    = true;
  btn.textContent = 'Αποστολή…';
  success.classList.add('is-hidden');
  error.classList.add('is-hidden');

  try {
    var res  = await fetch('/api/contact', { method: 'POST', body: new FormData(this) });
    var data = await res.json();

    if (data.success) {
      success.classList.remove('is-hidden');
      this.reset();
      if (window.turnstile) window.turnstile.reset();
    } else {
      error.textContent     = data.error || 'Παρουσιάστηκε σφάλμα.';
      error.classList.remove('is-hidden');
    }
  } catch {
    error.textContent   = 'Σφάλμα σύνδεσης. Παρακαλώ δοκιμάστε ξανά.';
    error.classList.remove('is-hidden');
  }

  btn.disabled    = false;
  btn.textContent = 'Αποστολή Μηνύματος →';
});
