/**
 * turnstile-loader.js — φορτώνει το Turnstile μόνο εκεί που έχει νόημα.
 *
 * Σε localhost το domain δεν είναι δηλωμένο στο Turnstile, οπότε το widget
 * απαντάει με κόκκινο πλαίσιο λάθους και καμία φόρμα δεν δοκιμάζεται τοπικά.
 * Εκεί δεν φορτώνουμε καθόλου το api.js — και ο server κάνει το αντίστοιχο
 * (functions/api/*, lib/local.js), ώστε το αίτημα να περνάει χωρίς token.
 *
 * Ζει σε ξεχωριστό αρχείο και όχι inline: το CSP του site είναι
 * `script-src 'self' https://challenges.cloudflare.com` χωρίς 'unsafe-inline'.
 */
(function () {
  var host = location.hostname;
  var isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    /\.localhost$/.test(host);

  if (isLocal) {
    document.documentElement.classList.add("is-local-dev");
    return;
  }

  var script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
})();
