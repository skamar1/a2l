/**
 * guard.js — φραγή SSRF.
 *
 * Ένα endpoint που κάνει fetch ό,τι URL του δώσει ο καθένας είναι ανοιχτό
 * proxy. Εδώ αστοχούν τα περισσότερα εργαλεία ελέγχου site: μπλοκάρουν το
 * `localhost` στο string του URL και σταματούν εκεί. Δεν αρκεί — ο επιτιθέμενος
 * βάζει domain που *αναλύεται* σε 127.0.0.1, ή που κάνει redirect εκεί.
 *
 * Γι' αυτό ελέγχουμε τρία πράγματα, με αυτή τη σειρά:
 *   1. Το σχήμα και το hostname, πριν καν βγούμε στο δίκτυο.
 *   2. Τις πραγματικές IP μετά από DNS (μέσω DNS-over-HTTPS της Cloudflare —
 *      το Workers runtime δεν έχει API για resolve).
 *   3. Κάθε βήμα redirect ξεχωριστά (βλ. probe.js) — αλλιώς το βήμα 2 παρακάμπτεται
 *      με ένα 302 προς http://169.254.169.254/.
 */

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** Hostnames που δεν βγάζουν ποτέ έξω από το μηχάνημα ή το ιδιωτικό δίκτυο. */
const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

/**
 * Ιδιωτικά / δεσμευμένα IPv4 εύρη ως [πρώτο, τελευταίο] σε μορφή 32-bit ακεραίου.
 * Περιλαμβάνει το 169.254.0.0/16 — εκεί ζει το endpoint μεταδεδομένων των
 * περισσότερων cloud providers, που είναι ο βασικός στόχος μιας SSRF.
 */
const IPV4_BLOCKED_RANGES = [
  ["0.0.0.0", "0.255.255.255"], // "this network"
  ["10.0.0.0", "10.255.255.255"], // ιδιωτικό
  ["100.64.0.0", "100.127.255.255"], // CGNAT
  ["127.0.0.0", "127.255.255.255"], // loopback
  ["169.254.0.0", "169.254.255.255"], // link-local + cloud metadata
  ["172.16.0.0", "172.31.255.255"], // ιδιωτικό
  ["192.0.0.0", "192.0.0.255"], // IETF protocol assignments
  ["192.0.2.0", "192.0.2.255"], // TEST-NET-1
  ["192.168.0.0", "192.168.255.255"], // ιδιωτικό
  ["198.18.0.0", "198.19.255.255"], // benchmarking
  ["198.51.100.0", "198.51.100.255"], // TEST-NET-2
  ["203.0.113.0", "203.0.113.255"], // TEST-NET-3
  ["224.0.0.0", "255.255.255.255"], // multicast + broadcast + reserved
];

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Απορρίπτουμε ρητά τα "01" και "0x7f": το parseInt θα τα δεχόταν σιωπηλά
    // και ο έλεγχος εύρους θα γινόταν πάνω σε λάθος αριθμό.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const IPV4_BLOCKED_INTS = IPV4_BLOCKED_RANGES.map(([lo, hi]) => [
  ipv4ToInt(lo),
  ipv4ToInt(hi),
]);

/** true αν η IPv4 πέφτει σε ιδιωτικό ή δεσμευμένο εύρος. */
export function isBlockedIPv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // ό,τι δεν καταλαβαίνουμε, δεν το εμπιστευόμαστε
  return IPV4_BLOCKED_INTS.some(([lo, hi]) => value >= lo && value <= hi);
}

/** true αν η IPv6 είναι loopback, link-local, unique-local ή IPv4-mapped ιδιωτική. */
export function isBlockedIPv6(ip) {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");

  if (addr === "::1" || addr === "::") return true;

  // IPv4-mapped (::ffff:127.0.0.1) — ελέγχουμε το IPv4 κομμάτι.
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  if (/^f[cd]/.test(addr)) return true;
  if (/^fe[89ab]/.test(addr)) return true;
  if (/^ff/.test(addr)) return true;

  return false;
}

function looksLikeIPv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function looksLikeIPv6(host) {
  return host.includes(":");
}

/**
 * Συντακτικός έλεγχος — τρέχει πριν από κάθε αίτημα δικτύου.
 * @returns {{ok: true, url: URL} | {ok: false, code: string, message: string}}
 */
export function validateUrlSyntax(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return { ok: false, code: "empty", message: "Δώστε μια διεύθυνση." };
  }
  if (raw.length > 2000) {
    return { ok: false, code: "too_long", message: "Η διεύθυνση είναι υπερβολικά μεγάλη." };
  }

  // Ο χρήστης γράφει "a2l.gr" — το κάνουμε https:// αντί να του πετάξουμε λάθος.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: "invalid", message: "Η διεύθυνση δεν είναι έγκυρη." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      code: "scheme",
      message: "Δεκτές μόνο διευθύνσεις http:// και https://.",
    };
  }

  // Το userinfo (https://user:pass@host) χρησιμεύει μόνο για να μπερδέψει τον
  // έλεγχο hostname· δεν το χρειαζόμαστε πουθενά.
  if (url.username || url.password) {
    return { ok: false, code: "userinfo", message: "Η διεύθυνση δεν είναι έγκυρη." };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, code: "private", message: "Δεν ελέγχουμε τοπικές διευθύνσεις." };
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, code: "private", message: "Δεν ελέγχουμε τοπικές διευθύνσεις." };
  }
  // Χωρίς τελεία δεν είναι δημόσιο domain — είναι όνομα μηχανήματος στο LAN.
  if (!host.includes(".") && !looksLikeIPv6(host)) {
    return { ok: false, code: "private", message: "Δεν ελέγχουμε τοπικές διευθύνσεις." };
  }

  if (looksLikeIPv4(host) && isBlockedIPv4(host)) {
    return { ok: false, code: "private", message: "Δεν ελέγχουμε ιδιωτικές διευθύνσεις IP." };
  }
  if (looksLikeIPv6(host) && isBlockedIPv6(host)) {
    return { ok: false, code: "private", message: "Δεν ελέγχουμε ιδιωτικές διευθύνσεις IP." };
  }

  // Μη τυπικές θύρες σημαίνουν σχεδόν πάντα εσωτερική υπηρεσία.
  if (url.port && !["80", "443", ""].includes(url.port)) {
    return { ok: false, code: "port", message: "Δεκτές μόνο οι θύρες 80 και 443." };
  }

  return { ok: true, url };
}

/**
 * Αναλύει το hostname σε πραγματικές IP και τις ελέγχει.
 * Χωρίς αυτό, ένα domain που δείχνει σε 127.0.0.1 περνάει τον συντακτικό έλεγχο.
 *
 * Αν το DoH αποτύχει, επιτρέπουμε τη συνέχεια: το να μπλοκάρουμε κάθε έλεγχο
 * επειδή έπεσε ο resolver μας θα έκανε το εργαλείο άχρηστο, και ο συντακτικός
 * έλεγχος μαζί με τον έλεγχο ανά redirect καλύπτουν τις προφανείς περιπτώσεις.
 */
export async function validateHostResolves(hostname, { timeoutMs = 3000 } = {}) {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  // Οι IP literals έχουν ήδη ελεγχθεί συντακτικά — δεν χρειάζονται DNS.
  if (looksLikeIPv4(host) || looksLikeIPv6(host)) return { ok: true, addresses: [host] };

  const lookup = async (type) => {
    const response = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    const data = await response.json();
    // type 1 = A, type 28 = AAAA. Τα CNAME (type 5) τα αγνοούμε — μας ενδιαφέρει
    // μόνο η τελική διεύθυνση, που ο resolver την επιστρέφει ούτως ή άλλως.
    return (data.Answer || [])
      .filter((answer) => answer.type === 1 || answer.type === 28)
      .map((answer) => answer.data);
  };

  let addresses;
  try {
    const [a, aaaa] = await Promise.all([lookup("A"), lookup("AAAA")]);
    addresses = [...a, ...aaaa];
  } catch {
    return { ok: true, addresses: [], unresolved: true };
  }

  if (addresses.length === 0) {
    return { ok: true, addresses: [], unresolved: true };
  }

  const blocked = addresses.find((address) =>
    address.includes(":") ? isBlockedIPv6(address) : isBlockedIPv4(address)
  );
  if (blocked) {
    return {
      ok: false,
      code: "private",
      message: "Η διεύθυνση δείχνει σε ιδιωτικό δίκτυο.",
      addresses,
    };
  }

  return { ok: true, addresses };
}

/** Συντακτικός έλεγχος + DNS, σε μία κλήση. */
export async function validateTarget(input) {
  const syntax = validateUrlSyntax(input);
  if (!syntax.ok) return syntax;

  const dns = await validateHostResolves(syntax.url.hostname);
  if (!dns.ok) return dns;

  return { ok: true, url: syntax.url, addresses: dns.addresses };
}
