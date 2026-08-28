/**
 * _middleware.js — μόνιμη ανακατεύθυνση http → https μέσα στην εφαρμογή.
 *
 * Η Cloudflare κάνει ήδη την ίδια ανακατεύθυνση στο edge («Always Use HTTPS»),
 * αλλά αυτή κρέμεται αποκλειστικά από έναν διακόπτη στο dashboard: αν σβηστεί,
 * το site αρχίζει να σερβίρεται σε http χωρίς να το πάρει κανείς είδηση. Εδώ
 * είναι δεύτερη γραμμή άμυνας, στον κώδικα και στο git.
 *
 * Υπάρχει και μετρήσιμος λόγος: όταν ένας Worker ζητάει το ΙΔΙΟ hostname στο
 * οποίο είναι δεμένο το Pages project, το αίτημα γυρνάει εσωτερικά στο project
 * και προσπερνάει τελείως το edge — άρα και τον κανόνα «Always Use HTTPS».
 * Έτσι ο δικός μας ελεγκτής (/api/check) έβλεπε το http://a2l.gr/ να απαντά 200
 * χωρίς ανακατεύθυνση, ενώ από έξω με curl έπαιρνε κανονικά 301. Με το
 * middleware η ανακατεύθυνση υπάρχει και σε αυτόν τον εσωτερικό δρόμο.
 *
 * Ασφάλεια από ατέρμονο βρόχο: μετρήθηκε live ότι ένα κανονικό αίτημα https
 * φτάνει εδώ με url.protocol === "https:" (και cf-visitor scheme=https,
 * x-forwarded-proto=https). Άρα η συνθήκη πιάνει μόνο πραγματικό http.
 */
export async function onRequest({ request, next }) {
  const url = new URL(request.url);

  if (url.protocol === "http:") {
    url.protocol = "https:";
    return new Response(null, {
      status: 301,
      headers: { Location: url.toString() },
    });
  }

  return next();
}
