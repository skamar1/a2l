// A2Labs — μπάνερ cookies (localStorage flag)
// Εξωτερικό αρχείο ώστε το CSP να μένει script-src 'self'.
(function () {
  var banner = document.getElementById('cookie-banner');
  var accept = document.getElementById('cookie-accept');
  if (!banner || !accept) return;

  /**
   * Σε αυστηρή ιδιωτική περιήγηση — και όταν ο χρήστης έχει μπλοκάρει τα
   * δεδομένα ιστότοπου — η localStorage πετάει SecurityError ακόμα και στο
   * διάβασμα. Χωρίς try/catch έσκαγε ολόκληρο το script στην πρώτη γραμμή και
   * το μπάνερ δεν εμφανιζόταν ποτέ: ο χρήστης που νοιάζεται περισσότερο για το
   * απόρρητό του ήταν ακριβώς αυτός που δεν έβλεπε την ενημέρωση.
   */
  function remembered() {
    try {
      return !!localStorage.getItem('cookies-ok');
    } catch (error) {
      return false;
    }
  }

  function remember() {
    try {
      localStorage.setItem('cookies-ok', '1');
    } catch (error) {
      // Δεν μπορούμε να το θυμηθούμε· το μπάνερ θα ξαναφανεί στην επόμενη
      // σελίδα. Ενοχλητικό, αλλά προτιμότερο από σπασμένη σελίδα.
    }
  }

  if (remembered()) return;

  banner.classList.add('cookie-banner--visible');
  accept.addEventListener('click', function () {
    remember();
    banner.classList.remove('cookie-banner--visible');
  });
})();
