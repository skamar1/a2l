/**
 * _middleware.js — ΒΗΜΑ 1 (προσωρινό): μόνο παρατήρηση, καμία ανακατεύθυνση.
 *
 * Θέλουμε να προσθέσουμε ανακατεύθυνση http → https μέσα στην εφαρμογή, γιατί
 * σήμερα γίνεται μόνο στο edge («Always Use HTTPS») και ο εσωτερικός δρόμος
 * (subrequest προς το ίδιο hostname) δεν την περνάει.
 *
 * Πριν όμως βάλουμε 301, πρέπει να είμαστε ΣΙΓΟΥΡΟΙ ότι ένα κανονικό αίτημα
 * https φτάνει εδώ με url.protocol === "https:". Αν δεν ίσχυε αυτό, το 301 θα
 * έστελνε κάθε επισκέπτη σε ατέρμονο βρόχο και θα έριχνε όλο το site.
 * Γι' αυτό αυτή η έκδοση απλώς γράφει την παρατήρηση σε header.
 */
export async function onRequest({ request, next }) {
  const response = await next();
  const url = new URL(request.url);

  const observed = new Response(response.body, response);
  observed.headers.set("X-Observed-Protocol", url.protocol);
  observed.headers.set("X-Observed-CF-Visitor", request.headers.get("cf-visitor") || "-");
  observed.headers.set("X-Observed-XFP", request.headers.get("x-forwarded-proto") || "-");
  return observed;
}
