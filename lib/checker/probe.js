/**
 * probe.js — ελεγχόμενη λήψη ξένων σελίδων.
 *
 * Κάθε αίτημα προς τρίτο site περνάει από εδώ, ώστε τα όρια (χρόνος, μέγεθος,
 * αριθμός redirect, φραγή ιδιωτικών IP σε κάθε βήμα) να είναι σε ένα σημείο και
 * να μην ξεχαστούν σε κάποια νέα κλήση.
 */

import { validateUrlSyntax, validateHostResolves } from "./guard.js";

export const USER_AGENT = "A2LabsChecker/1.0 (+https://a2l.gr/elegxos)";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 5;

/**
 * Διαβάζει το σώμα μέχρι το όριο και σταματά. Το `response.text()` θα
 * κατέβαζε ολόκληρο ένα αρχείο 500MB πριν προλάβουμε να αντιδράσουμε.
 * @returns {{text: string, bytes: number, truncated: boolean}}
 */
async function readCapped(response, maxBytes = MAX_BYTES) {
  if (!response.body) return { text: "", bytes: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        chunks.push(value.slice(0, value.byteLength - (bytes - maxBytes)));
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    // Χωρίς αυτό, μια σελίδα που στέλνει ατέρμονο stream κρατάει τη σύνδεση
    // ανοιχτή μέχρι το όριο CPU του Worker.
    try {
      await reader.cancel();
    } catch {
      /* το stream έχει ήδη κλείσει */
    }
  }

  const merged = new Uint8Array(truncated ? Math.min(bytes, maxBytes) : bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Σεβόμαστε το charset του server· πολλά ελληνικά site είναι ακόμη σε windows-1253.
  const charset = (response.headers.get("content-type") || "")
    .match(/charset=([^;\s]+)/i)?.[1]
    ?.replace(/["']/g, "");
  let text;
  try {
    text = new TextDecoder(charset || "utf-8", { fatal: false }).decode(merged);
  } catch {
    text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
  }

  return { text, bytes: truncated ? maxBytes : bytes, truncated };
}

/**
 * Ακολουθεί redirects χειροκίνητα, επικυρώνοντας κάθε βήμα.
 *
 * Το `redirect: "follow"` του fetch θα ακολουθούσε ένα 302 προς
 * http://169.254.169.254/ χωρίς να το δούμε ποτέ — γι' αυτό `manual`.
 */
export async function probe(
  targetUrl,
  { method = "GET", timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_BYTES, readBody = true } = {}
) {
  const chain = [];
  let current = new URL(targetUrl);
  const startedAt = Date.now();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response;
    const hopStartedAt = Date.now();
    try {
      response = await fetch(current.toString(), {
        method,
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, br",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      return {
        ok: false,
        code: timedOut ? "timeout" : "network",
        message: timedOut
          ? "Η σελίδα δεν απάντησε μέσα σε 10 δευτερόλεπτα."
          : "Δεν ήταν δυνατή η σύνδεση με τη διεύθυνση.",
        url: current.toString(),
        chain,
      };
    }

    // Στο Workers runtime το fetch επιστρέφει μόλις φτάσουν τα headers, οπότε
    // αυτό είναι πραγματικός χρόνος πρώτου byte — όχι χρόνος λήψης της σελίδας.
    const headersMs = Date.now() - hopStartedAt;
    const status = response.status;
    const location = response.headers.get("location");

    if (status >= 300 && status < 400 && location) {
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, code: "bad_redirect", message: "Άκυρη ανακατεύθυνση.", chain };
      }

      chain.push({ url: current.toString(), status, to: next.toString() });

      if (hop === MAX_REDIRECTS) {
        return { ok: false, code: "too_many_redirects", message: "Πάρα πολλές ανακατευθύνσεις.", chain };
      }

      // Ο έλεγχος γίνεται στον *προορισμό*, πριν τον ακολουθήσουμε.
      const syntax = validateUrlSyntax(next.toString());
      if (!syntax.ok) return { ...syntax, chain };
      const dns = await validateHostResolves(next.hostname);
      if (!dns.ok) return { ...dns, chain };

      current = next;
      continue;
    }

    const body = readBody
      ? await readCapped(response, maxBytes)
      : { text: "", bytes: 0, truncated: false };

    return {
      ok: true,
      url: current.toString(),
      status,
      headers: response.headers,
      body: body.text,
      bytes: body.bytes,
      truncated: body.truncated,
      headersMs,
      elapsedMs: Date.now() - startedAt,
      chain,
      // `cf` υπάρχει μόνο στο Workers runtime· τοπικά σε άλλο runtime λείπει.
      httpProtocol: response.cf?.httpProtocol || null,
      tls: response.cf?.tlsVersion || null,
      redirected: chain.length > 0,
    };
  }

  return { ok: false, code: "too_many_redirects", message: "Πάρα πολλές ανακατευθύνσεις.", chain };
}

/**
 * Ελαφρύ αίτημα όταν μας νοιάζει μόνο το status/headers (π.χ. έλεγχος 404).
 * Πολλοί servers απαντούν 405 σε HEAD, οπότε χρησιμοποιούμε GET χωρίς να
 * διαβάσουμε το σώμα.
 */
export async function probeStatus(targetUrl, options = {}) {
  return probe(targetUrl, { ...options, readBody: false, timeoutMs: options.timeoutMs ?? 6000 });
}
