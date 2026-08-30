// A2Labs — αντιγραφή IBAN στη σελίδα τρόπων πληρωμής
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
(function () {
  var buttons = document.querySelectorAll('.bank-row__copy');
  if (!buttons.length) return;

  // Μία περιοχή ανακοίνωσης για όλα τα κουμπιά. Η αλλαγή χρώματος στο εικονίδιο
  // δεν υπάρχει για όποιον ακούει τη σελίδα αντί να τη βλέπει.
  var status = document.createElement('span');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  document.body.appendChild(status);

  function flash(btn, ok, bank) {
    btn.classList.remove('copied', 'copy-failed');
    btn.classList.add(ok ? 'copied' : 'copy-failed');
    status.textContent = ok
      ? 'Αντιγράφηκε το IBAN ' + bank
      : 'Η αντιγραφή δεν ήταν δυνατή. Επιλέξτε το IBAN και αντιγράψτε το χειροκίνητα.';
    setTimeout(function () {
      btn.classList.remove('copied', 'copy-failed');
      status.textContent = '';
    }, 2500);
  }

  /**
   * Εφεδρικός δρόμος. Το Clipboard API δεν υπάρχει σε μη ασφαλές context και
   * μπορεί να απορριφθεί από τον χρήστη· το execCommand είναι παρωχημένο αλλά
   * δουλεύει ακόμα παντού. Το πεδίο παίρνει κλάση αντί για style attribute,
   * γιατί το CSP είναι style-src 'self'.
   */
  function legacyCopy(text) {
    var field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.className = 'copy-proxy';
    document.body.appendChild(field);
    field.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(field);
    return ok;
  }

  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () {
      var iban = (btn.getAttribute('data-iban') || '').replace(/\s/g, '');
      if (!iban) return;
      var bank = (btn.getAttribute('aria-label') || '').replace('Αντιγραφή IBAN ', '');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(iban).then(
          function () { flash(btn, true, bank); },
          function () { flash(btn, legacyCopy(iban), bank); }
        );
        return;
      }
      flash(btn, legacyCopy(iban), bank);
    });
  });
})();
