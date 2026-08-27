// A2Labs — αντιγραφή IBAN στη σελίδα τρόπων πληρωμής
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
document.querySelectorAll('.bank-row__copy').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var iban = btn.getAttribute('data-iban').replace(/\s/g, '');
    navigator.clipboard.writeText(iban).then(function() {
      btn.classList.add('copied');
      setTimeout(function() { btn.classList.remove('copied'); }, 2000);
    });
  });
});
