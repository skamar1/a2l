// A2Labs — μπάνερ cookies (localStorage flag)
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
(function() {
  if (localStorage.getItem('cookies-ok')) return;
  document.getElementById('cookie-banner').classList.add('cookie-banner--visible');
  document.getElementById('cookie-accept').addEventListener('click', function() {
    localStorage.setItem('cookies-ok', '1');
    document.getElementById('cookie-banner').classList.remove('cookie-banner--visible');
  });
})();
