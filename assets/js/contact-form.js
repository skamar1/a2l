// A2Labs — υποβολή φόρμας επικοινωνίας προς /api/contact
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
document.getElementById('contactForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  var btn     = document.getElementById('submitBtn');
  var success = document.getElementById('form-success');
  var error   = document.getElementById('form-error');

  btn.disabled    = true;
  btn.textContent = 'Αποστολή…';
  success.style.display = 'none';
  error.style.display   = 'none';

  try {
    var res  = await fetch('/api/contact', { method: 'POST', body: new FormData(this) });
    var data = await res.json();

    if (data.success) {
      success.style.display = 'block';
      this.reset();
      if (window.turnstile) window.turnstile.reset();
    } else {
      error.textContent     = data.error || 'Παρουσιάστηκε σφάλμα.';
      error.style.display   = 'block';
    }
  } catch {
    error.textContent   = 'Σφάλμα σύνδεσης. Παρακαλώ δοκιμάστε ξανά.';
    error.style.display = 'block';
  }

  btn.disabled    = false;
  btn.textContent = 'Αποστολή Μηνύματος →';
});
