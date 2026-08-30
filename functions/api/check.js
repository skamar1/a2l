/**
 * /api/check — ο έλεγχος ενός site.
 *
 * Η ροή: επικύρωση στόχου → Turnstile → όριο συχνότητας → λήψη → κανόνες → βαθμός
 * → αποθήκευση σε KV για μόνιμο σύνδεσμο.
 *
 * Ό,τι βαραίνει (λήψη robots, sitemap, 404, στατικά) τρέχει παράλληλα: σειριακά
 * θα ξεπερνούσαμε τον χρόνο απόκρισης και ο χρήστης θα κοιτούσε spinner 20".
 */

import { validateTarget, validateUrlSyntax } from "../../lib/checker/guard.js";
import { probe, probeStatus } from "../../lib/checker/probe.js";
import { extractFacts, htmlToText } from "../../lib/checker/extract.js";
import { runRules } from "../../lib/checker/rules.js";
import { score } from "../../lib/checker/score.js";
import { isLocalRequest } from "../../lib/local.js";

const RESULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 ημέρες
const RATE_LIMIT = { max: 12, windowSeconds: 3600 };

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }

  const input = String(payload?.url || "").trim();
  const token = String(payload?.token || "");

  // Ο συντακτικός έλεγχος πρώτος: αν η διεύθυνση είναι άκυρη, δεν έχει νόημα να
  // ενοχλήσουμε το Turnstile ούτε να ξοδέψουμε αίτημα από το όριο του χρήστη.
  const syntax = validateUrlSyntax(input);
  if (!syntax.ok) return json({ error: syntax.message, code: syntax.code }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "";

  const turnstile = await verifyTurnstile(token, ip, env, request);
  if (!turnstile.ok) return json({ error: turnstile.message }, 400);

  const limit = await checkRateLimit(env, ip);
  if (!limit.ok) {
    return json(
      { error: `Έχετε κάνει ${RATE_LIMIT.max} ελέγχους την τελευταία ώρα. Δοκιμάστε ξανά αργότερα.` },
      429
    );
  }

  const target = await validateTarget(syntax.url.toString());
  if (!target.ok) return json({ error: target.message, code: target.code }, 400);

  let report;
  try {
    report = await runCheck(target.url, { selfHost: new URL(request.url).host });
  } catch (error) {
    console.error("check failed:", error?.stack || error);
    return json({ error: "Ο έλεγχος δεν ολοκληρώθηκε. Δοκιμάστε ξανά σε λίγο." }, 500);
  }
  if (report.error) return json({ error: report.error, code: report.code }, 422);

  const id = await store(env, report);
  return json({ ...report, id, permalink: id ? `/elegxos/r/${id}/` : null });
}

/** Ο πυρήνας — χωρίς Turnstile/KV, ώστε να μπορεί να δοκιμαστεί απομονωμένος. */
export async function runCheck(url, options = {}) {
  const origin = url.origin;

  const main = await probe(url.toString());
  if (!main.ok) {
    return { error: main.message, code: main.code };
  }
  if (main.status >= 400) {
    return {
      error: `Η σελίδα απάντησε με σφάλμα ${main.status}. Ελέγξτε τη διεύθυνση.`,
      code: "http_error",
    };
  }
  if (!/text\/html/i.test(main.headers.get("content-type") || "")) {
    return {
      error: "Η διεύθυνση δεν επιστρέφει ιστοσελίδα HTML.",
      code: "not_html",
    };
  }

  const facts = await extractFacts(main.body, main.url);

  // Οι βοηθητικές λήψεις μαζί. Το `settle` κρατά ό,τι πέτυχε και μετατρέπει τις
  // αποτυχίες σε null — ο αντίστοιχος κανόνας θα βγει `na` αντί να ρίξει το πάντα.
  const assetUrls = pickAssets(facts, origin);
  // Σελίδες «Επικοινωνία / Σχετικά / Όροι»: το ΑΦΜ/ΓΕΜΗ σπάνια ζει στην αρχική
  // — είναι φυσιολογικό να βρίσκεται εκεί, οπότε ο κανόνας TRUST-02 τις κοιτάζει.
  const companyUrls = pickCompanyPages(facts, main.url);
  const [httpRedirect, robots, sitemap, notFound, favicon, ttfbA, ttfbB, ...rest] = await Promise.all([
    settle(probeStatus(`http://${url.host}${url.pathname}`)),
    settle(probe(`${origin}/robots.txt`, { maxBytes: 256 * 1024, timeoutMs: 6000 })),
    settle(probe(`${origin}/sitemap.xml`, { maxBytes: 1024 * 1024, timeoutMs: 6000 })),
    settle(probeStatus(`${origin}/a2l-elegxos-anyparkto-${randomSlug()}/`)),
    // Οι browsers ζητούν το /favicon.ico μόνοι τους ακόμη κι όταν δεν δηλώνεται
    // πουθενά· χωρίς αυτόν τον έλεγχο ο SEO-10 θα έβγαζε αποτυχία σε site που
    // δείχνουν κανονικά εικονίδιο.
    settle(probeStatus(`${origin}/favicon.ico`, { timeoutMs: 5000 })),
    settle(probeStatus(url.toString(), { timeoutMs: 8000 })),
    settle(probeStatus(url.toString(), { timeoutMs: 8000 })),
    ...companyUrls.map((pageUrl) =>
      settle(probe(pageUrl, { maxBytes: 1024 * 1024, timeoutMs: 6000 }))
    ),
    ...assetUrls.map((assetUrl) => settle(probeStatus(assetUrl, { timeoutMs: 6000 }))),
  ]);
  const companyResults = rest.slice(0, companyUrls.length);
  const assets = rest.slice(companyUrls.length);

  const companyPages = companyResults
    .map((result, index) => {
      if (!result || !result.ok || result.status >= 400) return null;
      if (!/text\/html/i.test(result.headers.get("content-type") || "")) return null;
      return { url: companyUrls[index], text: htmlToText(result.body).slice(0, 200_000) };
    })
    .filter(Boolean);

  // Διάμεσος αντί για μέσο όρο: μία αργή μέτρηση από στιγμιαία συμφόρηση δεν
  // πρέπει να χαρακτηρίσει έναν server ως αργό.
  const samples = [main.headersMs, ttfbA?.headersMs, ttfbB?.headersMs].filter(
    (value) => typeof value === "number"
  );
  const ttfbMs = median(samples);

  const ctx = {
    url: url.toString(),
    // Το hostname στο οποίο τρέχει ο ίδιος ο ελεγκτής. Χρειάζεται στον SEC-01:
    // δεν μπορούμε να ζητήσουμε http από τον εαυτό μας (βλ. σχόλιο εκεί).
    selfHost: options.selfHost || null,
    finalUrl: main.url,
    status: main.status,
    headers: main.headers,
    html: main.body,
    bytes: main.bytes,
    truncated: main.truncated,
    ttfbMs,
    ttfbSamples: samples,
    facts,
    probes: {
      httpRedirect: httpRedirect
        ? { ...httpRedirect, finalIsHttps: httpRedirect.url?.startsWith("https://") }
        : null,
      robots,
      sitemap,
      notFound,
      favicon,
      assets: assets.filter((asset) => asset && asset.ok),
      companyPages,
    },
  };

  const results = runRules(ctx);
  const summary = score(results);

  return {
    url: url.toString(),
    finalUrl: main.url,
    redirected: main.redirected,
    checkedAt: new Date().toISOString(),
    ...summary,
  };
}

// ── Βοηθητικά ────────────────────────────────────────────────────────────────

/**
 * Δείγμα στατικών αρχείων ίδιας προέλευσης, για τον έλεγχο Cache-Control.
 *
 * Το /cdn-cgi/ μένει απ' έξω: εκεί μέσα δεν υπάρχει αρχείο του site. Είναι ο
 * χώρος που κρατάει για τον εαυτό της η Cloudflare και μέσα του σερβίρει δικά
 * της scripts που τα εμφυτεύει μόνη της στη σελίδα — π.χ. το email-decode.min.js
 * του Email Obfuscation, με Cache-Control τεσσάρων ωρών. Ο ιδιοκτήτης του site
 * ούτε το ζήτησε ούτε μπορεί να αλλάξει τα header του, οπότε το να χάνει βαθμούς
 * γι' αυτό θα ήταν να τιμωρούμε κάθε site που τρέχει πίσω από Cloudflare.
 */
function pickAssets(facts, origin) {
  const candidates = [...facts.stylesheets, ...facts.scripts.external];
  const sameOrigin = [];
  for (const href of candidates) {
    let resolved;
    try {
      resolved = new URL(href, origin);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    if (resolved.pathname.startsWith("/cdn-cgi/")) continue;
    if (sameOrigin.includes(resolved.toString())) continue;
    sameOrigin.push(resolved.toString());
    if (sameOrigin.length === 3) break;
  }
  return sameOrigin;
}

/**
 * Οι υποψήφιες σελίδες με στοιχεία επιχείρησης — το φιλτράρισμα με το
 * COMPANY_PAGE_RE έχει ήδη γίνει στο extract.js (companyHrefs), χωρίς το όριο
 * των 400 πρώτων συνδέσμων. Εδώ μένει η επίλυση σε απόλυτο URL, ο περιορισμός
 * σε ίδια προέλευση και το ταβάνι των 3 — δεν θέλουμε ο έλεγχος να γίνει crawler.
 */
function pickCompanyPages(facts, mainUrl) {
  let base;
  try {
    base = new URL(mainUrl);
  } catch {
    return [];
  }
  const picked = [];
  for (const href of facts.links.companyHrefs) {
    if (!href || href.startsWith("#") || /^(tel:|mailto:|javascript:)/i.test(href)) continue;
    let resolved;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    resolved.hash = "";
    const asString = resolved.toString();
    if (asString === base.toString() || picked.includes(asString)) continue;
    picked.push(asString);
    if (picked.length === 3) break;
  }
  return picked;
}

// Ο probe δεν κάνει ποτέ reject — γυρνά {ok:false, code}. Το catch είναι για το
// απρόβλεπτο (π.χ. όριο subrequests), όπου προτιμάμε null και κανόνα `na`.
const settle = (promise) => promise.catch(() => null);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Τυχαία διαδρομή για τον έλεγχο 404 — σταθερή θα μπορούσε να έχει γίνει cache. */
function randomSlug() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((byte) => byte.toString(36))
    .join("");
}

async function verifyTurnstile(token, ip, env, request) {
  // Τοπικά δεν υπάρχει έγκυρο domain για το widget, άρα ούτε token. Βλ. lib/local.js
  // για το γιατί ο έλεγχος δεν πλαστογραφείται από την παραγωγή.
  if (isLocalRequest(request)) return { ok: true, skipped: "local" };

  if (!env.TURNSTILE_SECRET_KEY) {
    // Fail-closed: χωρίς μυστικό δεν περνάει κανένα αίτημα, ώστε ένα ξεχασμένο
    // secret σε νέο environment να μη μας αφήνει εκτεθειμένους σε bots.
    // Τοπικά: τρέξε με το δοκιμαστικό κλειδί του Turnstile (περνάει πάντα):
    //   npx wrangler pages dev public --kv CHECKS \
    //     --binding TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
    console.error("TURNSTILE_SECRET_KEY missing — rejecting request");
    return { ok: false, message: "Η υπηρεσία δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα." };
  }
  if (!token) return { ok: false, message: "Ολοκληρώστε την επαλήθευση και δοκιμάστε ξανά." };

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const data = await response.json();
    return data.success
      ? { ok: true }
      : { ok: false, message: "Η επαλήθευση απέτυχε. Ανανεώστε τη σελίδα και δοκιμάστε ξανά." };
  } catch {
    return { ok: false, message: "Η επαλήθευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά." };
  }
}

/**
 * IP που εξαιρούνται από το όριο — δικές μας, για δοκιμές και επιδείξεις.
 *
 * Διαβάζονται από μεταβλητή περιβάλλοντος και ΟΧΙ από τον κώδικα: το repo είναι
 * δημόσιο και μια IP στο git είναι πληροφορία που δεν χρειάζεται να δίνουμε.
 * Μορφή: μία ή περισσότερες IP χωρισμένες με κόμμα (IPv4 ή IPv6, γιατί η ίδια
 * σύνδεση μπορεί να βγει και με τα δύο).
 */
function isExemptIp(env, ip) {
  const raw = env.RATE_LIMIT_EXEMPT_IPS;
  if (!raw || !ip) return false;
  return String(raw)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(ip.toLowerCase());
}

/**
 * Όριο ανά IP. Χωρίς KV το εργαλείο εξακολουθεί να δουλεύει — προτιμούμε να
 * λειτουργεί χωρίς όριο παρά να μη λειτουργεί καθόλου επειδή λείπει ένα binding.
 */
async function checkRateLimit(env, ip) {
  if (!env.CHECKS || !ip) return { ok: true };
  if (isExemptIp(env, ip)) return { ok: true };
  const key = `rl:${ip}`;
  try {
    const current = Number((await env.CHECKS.get(key)) || 0);
    if (current >= RATE_LIMIT.max) return { ok: false };
    await env.CHECKS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT.windowSeconds });
    return { ok: true };
  } catch (error) {
    console.error("rate limit unavailable:", error);
    return { ok: true };
  }
}

async function store(env, report) {
  if (!env.CHECKS) return null;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  try {
    await env.CHECKS.put(`r:${id}`, JSON.stringify(report), { expirationTtl: RESULT_TTL_SECONDS });
    return id;
  } catch (error) {
    console.error("could not store result:", error);
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
