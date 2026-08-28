/**
 * local.js — αναγνώριση τοπικού περιβάλλοντος (wrangler pages dev).
 *
 * Το Turnstile δεν εκδίδει token για domain που δεν είναι δηλωμένο, οπότε σε
 * localhost κάθε φόρμα χτυπάει «η επαλήθευση απέτυχε» και δεν δοκιμάζεται
 * τίποτα. Την παρακάμπτουμε τοπικά — αλλά ο έλεγχος πρέπει να είναι αδύνατο να
 * πλαστογραφηθεί από έξω, αλλιώς μόλις ανοίξαμε τις φόρμες στα bots.
 *
 * Γι' αυτό απαιτούνται ΔΥΟ ανεξάρτητες συνθήκες μαζί:
 *
 *   1. Το hostname του αιτήματος είναι loopback. Έρχεται από το Host header,
 *      άρα από μόνο του δεν αρκεί.
 *   2. Λείπει το `CF-Ray`. Το προσθέτει το edge της Cloudflare σε ΚΑΘΕ αίτημα
 *      που φτάνει σε Worker/Pages Function και δεν αφαιρείται από τον client.
 *
 * Στην παραγωγή η (2) είναι πάντα ψευδής, οπότε ό,τι Host κι αν στείλει
 * κάποιος, το Turnstile εξακολουθεί να ισχύει. Στο `wrangler pages dev` δεν
 * υπάρχει edge, άρα δεν υπάρχει CF-Ray, και ισχύουν και οι δύο.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** true μόνο όταν τρέχουμε σε τοπικό dev server, ποτέ πίσω από την Cloudflare. */
export function isLocalRequest(request) {
  if (request.headers.get("CF-Ray")) return false;

  let hostname;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}
