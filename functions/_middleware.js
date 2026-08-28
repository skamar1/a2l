/**
 * _middleware.js — μόνιμη ανακατεύθυνση http → https μέσα στην εφαρμογή.
 *
 * Η Cloudflare κάνει ήδη την ίδια ανακατεύθυνση στο edge («Always Use HTTPS»),
 * αλλά αυτή κρέμεται αποκλειστικά από έναν διακόπτη στο dashboard: αν σβηστεί,
 * το site αρχίζει να σερβίρεται σε http χωρίς να το πάρει κανείς είδηση. Εδώ
 * είναι δεύτερη γραμμή άμυνας — στον κώδικα και στο git, όχι σε ένα checkbox.
 *
 * Ασφάλεια από ατέρμονο βρόχο: μετρήθηκε live ότι κανονικό αίτημα https φτάνει
 * εδώ με url.protocol === "https:" (και cf-visitor scheme=https,
 * x-forwarded-proto=https), άρα η συνθήκη πιάνει μόνο πραγματικό http.
 *
 * Τι ΔΕΝ λύνει: όταν ένας Worker ζητάει το ίδιο hostname στο οποίο είναι δεμένο
 * το Pages project, η πλατφόρμα αναβαθμίζει σιωπηλά το σχήμα σε https πριν φύγει
 * το αίτημα — μετρήθηκε ότι το middleware δέχεται τέτοιο αίτημα ως "https:" ενώ
 * ζητήθηκε http://. Γι' αυτό ο δικός μας SEC-01 βγάζει `na` στον αυτοέλεγχο.
 *
 * Κόστος: τα cached στατικά αρχεία σερβίρονται από το edge χωρίς να περνούν από
 * εδώ (επιβεβαιώθηκε — το CSS δεν έπαιρνε header που έβαζε το middleware).
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
