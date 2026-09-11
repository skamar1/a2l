/**
 * contrast.js — μέτρηση αντίθεσης κειμένου/φόντου (WCAG AA) σε πραγματικό browser.
 *
 * Οι υπόλοιποι κανόνες διαβάζουν το HTML ως κείμενο. Η αντίθεση όμως εξαρτάται
 * από το ΤΕΛΙΚΟ χρώμα κάθε κειμένου και το φόντο που καταλήγει πίσω του μετά
 * την κληρονομικότητα και τις διαφάνειες — αυτό το ξέρει μόνο μια μηχανή
 * rendering. Γι' αυτό η σελίδα φορτώνεται στο Browser Rendering της Cloudflare
 * (REST API, headless Chrome), μέσα της φορτώνεται το static/elegxos/
 * contrast-probe.js, που μετράει κάθε ορατό κείμενο και γράφει το αποτέλεσμα
 * σε ένα στοιχείο, και το διαβάζουμε πίσω με το /scrape.
 *
 * Γιατί εξωτερικό script και όχι inline: το REST API δεν έχει επιλογή
 * παράκαμψης CSP, και σελίδες με `script-src 'self'` (όπως η δική μας)
 * μπλοκάρουν τα inline. Το script από το a2l.gr περνά το 'self' του a2l.gr
 * και τρέχει σε κάθε site χωρίς CSP — δηλαδή στη συντριπτική πλειονότητα.
 * Σε site με αυστηρό CSP που δεν μας επιτρέπει, το στοιχείο δεν εμφανίζεται
 * και ο κανόνας βγαίνει `na` με αιτία "blocked".
 *
 * Ρύθμιση: CF_ACCOUNT_ID (μεταβλητή) και CF_BROWSER_TOKEN (secret, API token με
 * μόνο «Browser Rendering: Edit»). Χωρίς αυτά η μέτρηση γυρνά {available:false}
 * και ο κανόνας βγαίνει `na` — δεν ρίχνει τον βαθμό κανενός.
 */

import { RULES_VERSION } from "./rules.js";

const ENDPOINT_TIMEOUT_MS = 25_000;

// Το ?v= αλλάζει με κάθε έκδοση κανόνων ώστε ο headless browser να μην πάρει
// παλιό αντίγραφο από cache όταν αλλάξει το probe.
export const CONTRAST_PROBE_URL = `https://a2l.gr/elegxos/contrast-probe.js?v=${RULES_VERSION}`;

/**
 * Μετρά την αντίθεση της σελίδας. Δεν κάνει ποτέ reject: κάθε αποτυχία γυρνά
 * {available:false, reason} ώστε ο κανόνας να βγει `na` με σαφή αιτία.
 *
 * reason: "unconfigured" (λείπουν τα credentials), "quota" (429 — εξαντλήθηκε
 * ο χρόνος browser του πλάνου), "timeout", "blocked" (η σελίδα δεν άφησε το
 * probe να τρέξει, συνήθως CSP), "error".
 */
export async function measureContrast(url, env, options = {}) {
  const account = env?.CF_ACCOUNT_ID;
  const token = env?.CF_BROWSER_TOKEN;
  if (!account || !token) return { available: false, reason: "unconfigured" };

  const timeoutMs = options.timeoutMs || ENDPOINT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/browser-rendering/scrape`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          viewport: { width: 1280, height: 900 },
          gotoOptions: { waitUntil: "load", timeout: 15_000 },
          // Βίντεο/ήχος δεν επηρεάζουν χρώματα και καθυστερούν τη φόρτωση.
          rejectResourceTypes: ["media"],
          addScriptTag: [{ url: options.probeUrl || CONTRAST_PROBE_URL }],
          // Περιμένουμε να γράψει ο probe το αποτέλεσμά του πριν διαβαστεί το στοιχείο.
          waitForSelector: { selector: "#a2l-contrast", timeout: 10_000 },
          // Το δεύτερο selector είναι μόνο διαγνωστικό: αν λείπει κι αυτό,
          // το script δεν μπήκε καν στη σελίδα (CSP)· αν υπάρχει αλλά λείπει
          // το αποτέλεσμα, το probe έσκασε πριν γράψει.
          elements: [{ selector: "#a2l-contrast" }, { selector: 'script[src*="contrast-probe.js"]' }],
        }),
        signal: controller.signal,
      }
    );

    if (response.status === 429) return { available: false, reason: "quota" };
    if (!response.ok) {
      console.error("browser rendering failed:", response.status, (await response.text()).slice(0, 300));
      return { available: false, reason: "error" };
    }

    const payload = await response.json();
    const found = payload?.result?.find?.((r) => r.selector === "#a2l-contrast")?.results?.[0];
    if (!found) {
      // Διαγνωστικό: τι σχήμα είχε η απάντηση (χωρίς token, κομμένο).
      console.warn("contrast probe not found in page:", JSON.stringify(payload).slice(0, 600));
      return { available: false, reason: "blocked" };
    }
    const raw = Array.isArray(found.attributes)
      ? found.attributes.find((a) => a.name === "data-result")?.value
      : null;
    if (!raw) return { available: false, reason: "error" };

    const result = JSON.parse(raw);
    if (result.error) {
      console.error("contrast probe failed in page:", result.error);
      return { available: false, reason: "error" };
    }
    return { available: true, ...result };
  } catch (error) {
    const reason = error?.name === "AbortError" || error?.name === "TimeoutError" ? "timeout" : "error";
    if (reason === "error") console.error("browser rendering error:", error?.stack || error);
    return { available: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
