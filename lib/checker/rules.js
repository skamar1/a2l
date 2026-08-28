/**
 * rules.js — οι 44 κανόνες του ελέγχου.
 *
 * Κάθε κανόνας επιστρέφει pass / partial / fail / na — ποτέ ελεύθερη κρίση.
 * Το ίδιο site πρέπει να δίνει το ίδιο νούμερο σήμερα και σε έναν μήνα, αλλιώς
 * ο έλεγχος δεν είναι εργαλείο μέτρησης αλλά παιχνίδι.
 *
 * `na` σημαίνει «δεν μπόρεσε να ελεγχθεί» και ΒΓΑΙΝΕΙ από τον παρονομαστή. Το να
 * τιμωρείς ένα site για δικό σου timeout καταστρέφει την αξιοπιστία του εργαλείου.
 *
 * Κάθε αποτέλεσμα κρατά τρία πράγματα:
 *   measured — η πραγματική τιμή που είδαμε (για να απαντάμε σε όποιον διαφωνεί)
 *   meaning  — τι σημαίνει, σε μία πρόταση χωρίς ορολογία
 *   fix      — τι ακριβώς να κάνει. Χωρίς αυτό ο έλεγχος είναι λίστα παραπόνων.
 */

export const RULES_VERSION = "1.0.0";

export const CATEGORIES = [
  { id: "security", label: "Ασφάλεια", weight: 25 },
  { id: "seo", label: "SEO & ευρετηρίαση", weight: 20 },
  { id: "structured", label: "Δομημένα δεδομένα & AI", weight: 20 },
  { id: "performance", label: "Απόδοση", weight: 20 },
  { id: "a11y", label: "Προσβασιμότητα", weight: 10 },
  { id: "trust", label: "Εμπιστοσύνη & συμμόρφωση", weight: 5 },
];

import { decodeHref } from "./extract.js";

const PASS = "pass";
const PARTIAL = "partial";
const FAIL = "fail";
const NA = "na";

// ── Βοηθητικά ────────────────────────────────────────────────────────────────

const header = (ctx, name) => ctx.headers?.get(name) ?? null;

/** Σπάει ένα CSP σε map directive → πίνακας τιμών. */
function parseCsp(value) {
  const directives = {};
  for (const part of String(value).split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    directives[tokens[0].toLowerCase()] = tokens.slice(1).map((t) => t.toLowerCase());
  }
  return directives;
}

/** Επίπεδη λίστα όλων των κόμβων ενός JSON-LD, είτε είναι @graph είτε πίνακας. */
function flattenJsonLd(blocks) {
  const nodes = [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    nodes.push(node);
    if (node["@graph"]) visit(node["@graph"], depth + 1);
    // Οι φωλιασμένες οντότητες (publisher, author, mainEntity) μετράνε κι αυτές.
    for (const key of ["publisher", "author", "mainEntity", "itemListElement", "about"]) {
      if (node[key]) visit(node[key], depth + 1);
    }
  };
  blocks.forEach((block) => visit(block));
  return nodes;
}

const typesOf = (node) => {
  const raw = node["@type"];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((t) => String(t).toLowerCase());
};

const hasType = (nodes, ...wanted) => {
  const want = wanted.map((w) => w.toLowerCase());
  return nodes.some((node) => typesOf(node).some((t) => want.includes(t)));
};

const findType = (nodes, ...wanted) => {
  const want = wanted.map((w) => w.toLowerCase());
  return nodes.find((node) => typesOf(node).some((t) => want.includes(t))) || null;
};

const pct = (part, total) => (total === 0 ? 0 : Math.round((part / total) * 100));

/** URL → μονοπάτι για εμφάνιση στο «μετρήθηκε» (π.χ. /epikoinonia/). */
function pathOf(value) {
  try {
    let path = new URL(value).pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* κρατάμε το encoded */
    }
    return path;
  } catch {
    return String(value);
  }
}

/**
 * Όλοι οι σύνδεσμοι που κοιτάζουν οι κανόνες εμπιστοσύνης: το hrefs (πρώτοι
 * 400) συν το companyHrefs, που μαζεύεται χωρίς αυτό το όριο — σε μεγάλα
 * e-shop τα footer links (όροι, απόρρητο, επικοινωνία) έρχονται μετά από
 * εκατοντάδες συνδέσμους προϊόντων.
 */
const trustHrefs = (ctx) => [
  ...ctx.facts.links.hrefs,
  ...(ctx.facts.links.companyHrefs || []),
];

// ── Ασφάλεια (βάρος 25) ──────────────────────────────────────────────────────

const SECURITY_RULES = [
  {
    id: "SEC-01",
    title: "Ανακατεύθυνση HTTP → HTTPS",
    units: 3,
    meaning:
      "Όποιος πληκτρολογήσει τη διεύθυνση χωρίς https θα έπρεπε να μεταφέρεται αυτόματα στην ασφαλή έκδοση.",
    fix: "Στο Cloudflare: SSL/TLS → Edge Certificates → ενεργοποίηση «Always Use HTTPS». Σε Apache/Nginx: μόνιμη ανακατεύθυνση 301 από τη θύρα 80.",
    run(ctx) {
      const probe = ctx.probes.httpRedirect;
      if (!probe) return { state: NA, measured: "Ο έλεγχος δεν ολοκληρώθηκε." };
      if (!probe.ok) {
        // Κλειστή θύρα 80 δεν είναι αποτυχία: κανένας δεν μπορεί να συνδεθεί
        // ανασφαλώς. Απλώς δεν έχουμε τι να μετρήσουμε.
        return {
          state: NA,
          measured: "Η θύρα 80 δεν απάντησε — δεν υπάρχει μη κρυπτογραφημένη είσοδος για να ελεγχθεί.",
        };
      }

      const hop = probe.chain?.[0];
      if (!hop) {
        return probe.finalIsHttps
          ? { state: PASS, measured: "Η σύνδεση γίνεται ήδη μέσω HTTPS." }
          : { state: FAIL, measured: "Το http:// απαντά κανονικά χωρίς ανακατεύθυνση σε https." };
      }
      if (!probe.finalIsHttps) {
        return { state: FAIL, measured: `Ανακατεύθυνση ${hop.status} αλλά ο προορισμός μένει σε http://.` };
      }
      return hop.status === 301 || hop.status === 308
        ? { state: PASS, measured: `Μόνιμη ανακατεύθυνση ${hop.status} προς https.` }
        : {
            state: PARTIAL,
            measured: `Προσωρινή ανακατεύθυνση ${hop.status} προς https.`,
            fix: "Αλλάξτε την ανακατεύθυνση από προσωρινή (302/307) σε μόνιμη (301), ώστε να την απομνημονεύσουν οι browsers και οι μηχανές αναζήτησης.",
          };
    },
  },
  {
    id: "SEC-02",
    title: "Strict-Transport-Security τουλάχιστον 6 μηνών",
    units: 3,
    meaning:
      "Λέει στον browser να μη δοκιμάσει ποτέ ξανά μη κρυπτογραφημένη σύνδεση με το site σας.",
    fix: "Προσθέστε το header `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Σε Cloudflare Pages μπαίνει στο αρχείο `_headers`.",
    run(ctx) {
      const value = header(ctx, "strict-transport-security");
      if (!value) return { state: FAIL, measured: "Το header δεν υπάρχει." };
      const maxAge = Number(value.match(/max-age\s*=\s*(\d+)/i)?.[1] ?? 0);
      const months = Math.round(maxAge / 2592000);
      if (maxAge >= 15552000) {
        return { state: PASS, measured: `max-age=${maxAge} (≈${months} μήνες).` };
      }
      return {
        state: PARTIAL,
        measured: `max-age=${maxAge} — κάτω από 6 μήνες.`,
        fix: "Ανεβάστε το max-age σε τουλάχιστον 15552000 (6 μήνες). Το συνηθισμένο είναι 63072000 (2 χρόνια).",
      };
    },
  },
  {
    id: "SEC-03",
    title: "Υπάρχει Content-Security-Policy",
    units: 3,
    meaning:
      "Ορίζει από πού επιτρέπεται να φορτώσει κώδικα η σελίδα. Είναι η βασική άμυνα όταν κάποιος καταφέρει να περάσει ξένο script.",
    fix: "Ξεκινήστε με `Content-Security-Policy: default-src 'self'` και προσθέστε ρητά μόνο τα εξωτερικά domains που πραγματικά χρειάζεστε.",
    run(ctx) {
      const value = header(ctx, "content-security-policy");
      if (value) return { state: PASS, measured: `Δηλωμένο ως header (${value.length} χαρακτήρες).` };
      if (ctx.facts.metaCsp) {
        return {
          state: PARTIAL,
          measured: "Δηλωμένο μόνο ως <meta http-equiv>.",
          fix: "Μεταφέρετέ το σε HTTP header. Το meta αγνοείται για frame-ancestors και εφαρμόζεται αργότερα, αφού έχει ήδη ξεκινήσει η ανάλυση της σελίδας.",
        };
      }
      return { state: FAIL, measured: "Δεν υπάρχει ούτε header ούτε meta." };
    },
  },
  {
    id: "SEC-04",
    title: "Το CSP δεν επιτρέπει unsafe-inline σε script-src",
    units: 3,
    meaning:
      "Με 'unsafe-inline' στα scripts, το CSP σταματά να προστατεύει από την επίθεση για την οποία υπάρχει.",
    fix: "Βγάλτε κάθε inline <script> σε ξεχωριστό αρχείο .js και αφαιρέστε το 'unsafe-inline' από το script-src.",
    run(ctx) {
      const raw = header(ctx, "content-security-policy") || ctx.facts.metaCsp;
      if (!raw) return { state: FAIL, measured: "Δεν υπάρχει CSP για να ελεγχθεί." };

      const directives = parseCsp(raw);
      const scriptSrc = directives["script-src"] || directives["default-src"] || [];
      const styleSrc = directives["style-src"] || directives["default-src"] || [];
      const scriptUnsafe = scriptSrc.includes("'unsafe-inline'");
      const scriptEval = scriptSrc.includes("'unsafe-eval'");
      const styleUnsafe = styleSrc.includes("'unsafe-inline'");
      // Με nonce ή hash, ο browser αγνοεί το 'unsafe-inline' — δεν είναι σφάλμα.
      const hasNonceOrHash = scriptSrc.some((t) => t.startsWith("'nonce-") || t.startsWith("'sha"));

      if (scriptUnsafe && !hasNonceOrHash) {
        return {
          state: FAIL,
          measured: `Το script-src περιέχει 'unsafe-inline'${scriptEval ? " και 'unsafe-eval'" : ""}.`,
        };
      }
      if (styleUnsafe) {
        return {
          state: PARTIAL,
          measured: "Το script-src είναι καθαρό· το 'unsafe-inline' υπάρχει μόνο στο style-src.",
          fix: "Δεκτό συμβιβασμός: το inline style attribute είναι πολύ μικρότερος κίνδυνος από inline script. Για πλήρη βαθμό, αφαιρέστε τα style=\"...\" attributes και βάλτε τους κανόνες σε αρχείο CSS.",
        };
      }
      return { state: PASS, measured: "Ούτε το script-src ούτε το style-src επιτρέπουν inline κώδικα." };
    },
  },
  {
    id: "SEC-05",
    title: "X-Content-Type-Options: nosniff",
    units: 2,
    meaning:
      "Εμποδίζει τον browser να μαντέψει τον τύπο ενός αρχείου και να εκτελέσει ως κώδικα κάτι που ανέβασε χρήστης.",
    fix: "Προσθέστε το header `X-Content-Type-Options: nosniff`.",
    run(ctx) {
      const value = header(ctx, "x-content-type-options");
      if (!value) return { state: FAIL, measured: "Το header δεν υπάρχει." };
      return value.trim().toLowerCase() === "nosniff"
        ? { state: PASS, measured: "nosniff" }
        : { state: PARTIAL, measured: `Τιμή «${value}» — αναμενόταν «nosniff».` };
    },
  },
  {
    id: "SEC-06",
    title: "Προστασία από clickjacking",
    units: 2,
    meaning:
      "Χωρίς αυτό, κάποιος μπορεί να φορτώσει το site σας μέσα σε αόρατο πλαίσιο και να παρασύρει τον χρήστη να πατήσει κουμπιά που δεν βλέπει.",
    fix: "Προσθέστε `X-Frame-Options: DENY` και, καλύτερα, `frame-ancestors 'none'` μέσα στο CSP.",
    run(ctx) {
      const xfo = header(ctx, "x-frame-options");
      const csp = header(ctx, "content-security-policy") || ctx.facts.metaCsp || "";
      const frameAncestors = parseCsp(csp)["frame-ancestors"];

      if (frameAncestors) {
        const denies = frameAncestors.includes("'none'") || frameAncestors.includes("'self'");
        return denies
          ? { state: PASS, measured: `CSP frame-ancestors ${frameAncestors.join(" ")}` }
          : { state: PARTIAL, measured: `CSP frame-ancestors ${frameAncestors.join(" ")} — επιτρέπει τρίτους.` };
      }
      if (xfo) {
        return /deny|sameorigin/i.test(xfo)
          ? {
              state: PARTIAL,
              measured: `X-Frame-Options: ${xfo} — χωρίς CSP frame-ancestors.`,
              fix: "Προσθέστε και `frame-ancestors 'none'` στο CSP. Το X-Frame-Options είναι παλαιότερο και δεν το υποστηρίζουν όλοι οι browsers πλέον.",
            }
          : { state: FAIL, measured: `X-Frame-Options: ${xfo} — μη έγκυρη τιμή.` };
      }
      return { state: FAIL, measured: "Ούτε X-Frame-Options ούτε CSP frame-ancestors." };
    },
  },
  {
    id: "SEC-07",
    title: "Referrer-Policy δηλωμένο",
    units: 2,
    meaning:
      "Ελέγχει πόσα από τη διεύθυνσή σας μαθαίνει ένα εξωτερικό site όταν ο χρήστης πατήσει σύνδεσμο — σημαντικό αν τα URL σας περιέχουν στοιχεία.",
    fix: "Προσθέστε `Referrer-Policy: strict-origin-when-cross-origin`.",
    run(ctx) {
      const value = header(ctx, "referrer-policy");
      if (!value) return { state: FAIL, measured: "Το header δεν υπάρχει." };
      const valid = [
        "no-referrer",
        "no-referrer-when-downgrade",
        "origin",
        "origin-when-cross-origin",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
      ];
      const tokens = value.toLowerCase().split(",").map((t) => t.trim());
      if (!tokens.some((t) => valid.includes(t))) {
        return { state: FAIL, measured: `Τιμή «${value}» — δεν είναι έγκυρη πολιτική.` };
      }
      if (tokens.includes("unsafe-url")) {
        return { state: PARTIAL, measured: "unsafe-url — στέλνει ολόκληρη τη διεύθυνση παντού." };
      }
      return { state: PASS, measured: value };
    },
  },
  {
    id: "SEC-08",
    title: "Permissions-Policy δηλωμένο",
    units: 2,
    meaning:
      "Δηλώνει ρητά ότι η σελίδα δεν ζητά κάμερα, μικρόφωνο ή τοποθεσία — ώστε να μην μπορεί να τα ζητήσει ούτε κάποιο script που θα περάσει κρυφά.",
    fix: "Προσθέστε `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()` και όποια άλλη δυνατότητα δεν χρησιμοποιείτε.",
    run(ctx) {
      const value = header(ctx, "permissions-policy") || header(ctx, "feature-policy");
      if (!value) return { state: FAIL, measured: "Το header δεν υπάρχει." };
      const sensitive = ["camera", "microphone", "geolocation"];
      const closed = sensitive.filter((feature) =>
        new RegExp(`${feature}\\s*=\\s*\\(\\s*\\)`, "i").test(value)
      );
      if (closed.length === sensitive.length) {
        return { state: PASS, measured: `Δηλωμένο· κλείνει camera, microphone και geolocation.` };
      }
      return {
        state: PARTIAL,
        measured: `Δηλωμένο, αλλά δεν κλείνει ρητά: ${sensitive.filter((f) => !closed.includes(f)).join(", ")}.`,
      };
    },
  },
  {
    id: "SEC-09",
    title: "Έγκυρο πιστοποιητικό HTTPS",
    units: 2,
    meaning: "Ένα ληγμένο ή λάθος πιστοποιητικό βγάζει προειδοποίηση που διώχνει κάθε επισκέπτη.",
    fix: "Ανανεώστε το πιστοποιητικό. Με Let's Encrypt ή Cloudflare η ανανέωση γίνεται αυτόματα — αν έληξε, κάτι έχει σπάσει στη διαδικασία.",
    run(ctx) {
      if (!ctx.finalUrl.startsWith("https://")) {
        return { state: FAIL, measured: "Η σελίδα δεν σερβίρεται μέσω HTTPS." };
      }
      // Το Workers runtime απορρίπτει άκυρα πιστοποιητικά πριν φτάσει η απόκριση
      // εδώ — άρα το ότι διαβάσαμε τη σελίδα σημαίνει έγκυρη αλυσίδα.
      return {
        state: PASS,
        measured: "Η σύνδεση HTTPS ολοκληρώθηκε με έγκυρη αλυσίδα πιστοποιητικών.",
        note: "Την ημερομηνία λήξης δεν μπορούμε να τη δούμε από εδώ — ελέγξτε την ξεχωριστά αν το πιστοποιητικό δεν ανανεώνεται αυτόματα.",
      };
    },
  },
  {
    id: "SEC-10",
    title: "Χωρίς mixed content",
    units: 2,
    meaning:
      "Αρχεία που φορτώνονται μέσω http μέσα σε ασφαλή σελίδα είτε μπλοκάρονται είτε σπάνε το λουκέτο του browser.",
    fix: "Αλλάξτε κάθε http:// σε https:// στα src και href, ή αφήστε το πρωτόκολλο έξω (//example.com/…).",
    run(ctx) {
      if (!ctx.finalUrl.startsWith("https://")) {
        return { state: NA, measured: "Η σελίδα δεν είναι σε HTTPS — δεν ισχύει." };
      }
      const refs = ctx.facts.insecureRefs;
      if (refs.length === 0) return { state: PASS, measured: "Καμία αναφορά σε http://." };
      return {
        state: FAIL,
        measured: `${refs.length} αναφορές σε http://, π.χ. ${refs[0]}`,
        evidence: refs.slice(0, 5),
      };
    },
  },
  {
    id: "SEC-11",
    title: "Χωρίς διαρροή έκδοσης server ή CMS",
    units: 1,
    meaning:
      "Η ακριβής έκδοση λέει σε όποιον ψάχνει θύματα ποια γνωστά κενά ασφαλείας να δοκιμάσει πρώτα.",
    fix: "Κρύψτε την έκδοση: `server_tokens off` σε Nginx, `ServerTokens Prod` σε Apache, αφαίρεση του X-Powered-By και του <meta name=\"generator\">.",
    run(ctx) {
      const leaks = [];
      const server = header(ctx, "server");
      const powered = header(ctx, "x-powered-by");
      const generator = ctx.facts.metaGenerator;

      if (server && /\d+\.\d+/.test(server)) leaks.push(`Server: ${server}`);
      if (powered) leaks.push(`X-Powered-By: ${powered}`);
      if (generator && /\d+\.\d+/.test(generator)) leaks.push(`meta generator: ${generator}`);

      if (leaks.length === 0) {
        return { state: PASS, measured: "Καμία έκδοση δεν εκτίθεται." };
      }
      return { state: FAIL, measured: leaks.join(" · "), evidence: leaks };
    },
  },
];

// ── SEO & ευρετηρίαση (βάρος 20) ─────────────────────────────────────────────

const SEO_RULES = [
  {
    id: "SEO-01",
    title: "Τίτλος 30–60 χαρακτήρων",
    units: 3,
    meaning: "Ο τίτλος είναι η πρώτη γραμμή του αποτελέσματος στη Google. Πολύ μεγάλος κόβεται, πολύ μικρός δεν λέει τίποτα.",
    fix: "Γράψτε τίτλο 30–60 χαρακτήρων που περιέχει και την υπηρεσία και το όνομα της επιχείρησης.",
    run(ctx) {
      const title = ctx.facts.title;
      if (!title) return { state: FAIL, measured: "Δεν υπάρχει <title>." };
      const length = title.length;
      if (ctx.facts.titleCount > 1) {
        return { state: PARTIAL, measured: `${ctx.facts.titleCount} στοιχεία <title> — πρέπει να υπάρχει ένα.` };
      }
      if (length >= 30 && length <= 60) {
        return { state: PASS, measured: `${length} χαρακτήρες: «${title}»` };
      }
      return {
        state: PARTIAL,
        measured: `${length} χαρακτήρες (${length < 30 ? "πολύ σύντομος" : "θα κοπεί στα αποτελέσματα"}): «${title}»`,
      };
    },
  },
  {
    id: "SEO-02",
    title: "Meta description 70–160 χαρακτήρων",
    units: 3,
    meaning: "Είναι το κείμενο κάτω από τον τίτλο στη Google. Αν λείπει, η Google διαλέγει μόνη της ένα τυχαίο κομμάτι της σελίδας.",
    fix: "Προσθέστε `<meta name=\"description\" content=\"…\">` με 70–160 χαρακτήρες που περιγράφουν τη σελίδα και καλούν σε ενέργεια.",
    run(ctx) {
      const description = ctx.facts.metaDescription?.trim();
      if (!description) return { state: FAIL, measured: "Δεν υπάρχει meta description." };
      const length = description.length;
      if (length >= 70 && length <= 160) return { state: PASS, measured: `${length} χαρακτήρες.` };
      return {
        state: PARTIAL,
        measured: `${length} χαρακτήρες (${length < 70 ? "πολύ σύντομη" : "θα κοπεί"}).`,
      };
    },
  },
  {
    id: "SEO-03",
    title: "Ακριβώς ένα <h1>",
    units: 2,
    meaning: "Ο βασικός τίτλος της σελίδας. Κανένας σημαίνει ασαφές θέμα· πολλοί σημαίνει ότι κανένας δεν ξεχωρίζει.",
    fix: "Αφήστε έναν <h1> ανά σελίδα και μετατρέψτε τους υπόλοιπους σε <h2>.",
    run(ctx) {
      const count = ctx.facts.h1Count;
      if (count === 1) return { state: PASS, measured: `1 <h1>: «${ctx.facts.h1Texts[0] || ""}»` };
      if (count === 0) return { state: FAIL, measured: "Δεν υπάρχει <h1>." };
      return { state: PARTIAL, measured: `${count} στοιχεία <h1>.` };
    },
  },
  {
    id: "SEO-04",
    title: "Canonical δηλωμένο και αυτοαναφερόμενο",
    units: 2,
    meaning: "Λέει στη Google ποια είναι η επίσημη διεύθυνση της σελίδας, ώστε να μη θεωρηθούν διπλότυπα τα /page, /page/ και /page?utm=…",
    fix: "Προσθέστε `<link rel=\"canonical\" href=\"…\">` με την πλήρη, τελική διεύθυνση της σελίδας.",
    run(ctx) {
      const canonical = ctx.facts.canonical;
      if (!canonical) return { state: FAIL, measured: "Δεν υπάρχει link rel=canonical." };
      let resolved;
      try {
        resolved = new URL(canonical, ctx.finalUrl);
      } catch {
        return { state: FAIL, measured: `Άκυρη τιμή canonical: «${canonical}»` };
      }
      const final = new URL(ctx.finalUrl);
      const same =
        resolved.origin === final.origin &&
        resolved.pathname.replace(/\/$/, "") === final.pathname.replace(/\/$/, "");
      return same
        ? { state: PASS, measured: resolved.toString() }
        : {
            state: PARTIAL,
            measured: `Δείχνει σε ${resolved.toString()} ενώ η σελίδα είναι ${ctx.finalUrl}`,
            fix: "Το canonical δείχνει αλλού. Αν είναι σκόπιμο (π.χ. σελίδα με παραλλαγές), αγνοήστε το· αλλιώς διορθώστε το ώστε να δείχνει στον εαυτό του.",
          };
    },
  },
  {
    id: "SEO-05",
    title: "robots.txt υπάρχει και είναι κείμενο",
    units: 3,
    meaning:
      "Πολλά site επιστρέφουν την αρχική σελίδα σε HTML όταν ζητηθεί το robots.txt. Οι crawlers το διαβάζουν ως άκυρο και αγνοούν ό,τι λέει.",
    fix: "Δημιουργήστε πραγματικό /robots.txt που επιστρέφει content-type text/plain. Σε Hugo: `enableRobotsTXT = true` και αρχείο layouts/robots.txt.",
    run(ctx) {
      const probe = ctx.probes.robots;
      if (!probe) return { state: NA, measured: "Ο έλεγχος δεν ολοκληρώθηκε." };
      if (!probe.ok) return { state: NA, measured: "Το robots.txt δεν κατέβηκε." };
      if (probe.status === 404) {
        return {
          state: PARTIAL,
          measured: "Δεν υπάρχει (404).",
          fix: "Δεν είναι λάθος να λείπει — οι crawlers το θεωρούν «όλα επιτρεπτά». Αλλά χωρίς αυτό δεν μπορείτε να δηλώσετε το sitemap σας.",
        };
      }
      if (probe.status !== 200) return { state: FAIL, measured: `Απαντά με status ${probe.status}.` };

      const contentType = probe.headers.get("content-type") || "";
      if (!/text\/plain/i.test(contentType)) {
        return {
          state: FAIL,
          measured: `Status 200 αλλά content-type «${contentType}» — δεν είναι απλό κείμενο.`,
        };
      }
      if (/<html|<!doctype/i.test(probe.body.slice(0, 300))) {
        return { state: FAIL, measured: "Επιστρέφει HTML αντί για κανόνες robots." };
      }
      return { state: PASS, measured: `Status 200, ${contentType.split(";")[0]}, ${probe.bytes} bytes.` };
    },
  },
  {
    id: "SEO-06",
    title: "Sitemap υπάρχει και δηλώνεται στο robots.txt",
    units: 3,
    meaning: "Το sitemap λέει στη Google ποιες σελίδες υπάρχουν, χωρίς να χρειάζεται να τις ανακαλύψει μόνη της από συνδέσμους.",
    fix: "Δημιουργήστε /sitemap.xml και προσθέστε τη γραμμή `Sitemap: https://…/sitemap.xml` στο robots.txt.",
    run(ctx) {
      const probe = ctx.probes.sitemap;
      const robots = ctx.probes.robots;
      const declared = robots?.ok && /^\s*sitemap:\s*\S+/im.test(robots.body || "");

      if (!probe) return { state: NA, measured: "Ο έλεγχος δεν ολοκληρώθηκε." };
      if (!probe.ok || probe.status !== 200) {
        return declared
          ? { state: PARTIAL, measured: "Δηλώνεται στο robots.txt αλλά δεν κατέβηκε από την τυπική διεύθυνση." }
          : { state: FAIL, measured: "Δεν βρέθηκε sitemap ούτε δήλωση στο robots.txt." };
      }

      const isXml = /<(urlset|sitemapindex)\b/i.test(probe.body.slice(0, 2000));
      if (!isXml) return { state: FAIL, measured: "Το /sitemap.xml δεν είναι έγκυρο XML sitemap." };

      const urlCount = (probe.body.match(/<loc>/gi) || []).length;
      return declared
        ? { state: PASS, measured: `Έγκυρο sitemap με ${urlCount} διευθύνσεις, δηλωμένο στο robots.txt.` }
        : {
            state: PARTIAL,
            measured: `Έγκυρο sitemap με ${urlCount} διευθύνσεις, αλλά δεν δηλώνεται στο robots.txt.`,
            fix: "Προσθέστε τη γραμμή `Sitemap: https://…/sitemap.xml` στο robots.txt.",
          };
    },
  },
  {
    id: "SEO-07",
    title: "Ανύπαρκτη σελίδα επιστρέφει πραγματικό 404",
    units: 3,
    meaning:
      "Αν κάθε λάθος διεύθυνση απαντά «όλα καλά», η Google ευρετηριάζει άπειρες ανύπαρκτες σελίδες και ο βαθμός ποιότητας του site πέφτει.",
    fix: "Ρυθμίστε τον server ώστε οι ανύπαρκτες διαδρομές να επιστρέφουν status 404 μαζί με τη σελίδα σφάλματος. Σε Cloudflare Pages αρκεί ένα αρχείο 404.html στη ρίζα.",
    run(ctx) {
      const probe = ctx.probes.notFound;
      if (!probe || !probe.ok) return { state: NA, measured: "Ο έλεγχος δεν ολοκληρώθηκε." };
      if (probe.status === 404 || probe.status === 410) {
        return { state: PASS, measured: `Status ${probe.status} σε τυχαία ανύπαρκτη διαδρομή.` };
      }
      if (probe.status >= 300 && probe.status < 400) {
        return {
          state: PARTIAL,
          measured: `Ανακατεύθυνση ${probe.status} αντί για 404.`,
          fix: "Η ανακατεύθυνση στην αρχική κρύβει το σφάλμα από τον χρήστη αλλά μπερδεύει τις μηχανές αναζήτησης. Επιστρέψτε 404.",
        };
      }
      return { state: FAIL, measured: `Status ${probe.status} — soft-404. Η σελίδα δεν υπάρχει αλλά ο server λέει ότι όλα είναι εντάξει.` };
    },
  },
  {
    id: "SEO-08",
    title: "Open Graph: title, description, image, url",
    units: 2,
    meaning: "Καθορίζει πώς φαίνεται ο σύνδεσμός σας όταν κάποιος τον μοιραστεί σε Facebook, LinkedIn ή Viber.",
    fix: "Προσθέστε og:title, og:description, og:image (τουλάχιστον 1200×630) και og:url στο <head>.",
    run(ctx) {
      const og = ctx.facts.og;
      const required = ["title", "description", "image", "url"];
      const missing = required.filter((key) => !og[key]);
      if (missing.length === 0) return { state: PASS, measured: "Και τα τέσσερα υπάρχουν." };
      if (missing.length === required.length) return { state: FAIL, measured: "Δεν υπάρχει καμία ετικέτα Open Graph." };
      return { state: PARTIAL, measured: `Λείπουν: ${missing.map((m) => `og:${m}`).join(", ")}.` };
    },
  },
  {
    id: "SEO-09",
    title: "Κάλυψη alt σε εικόνες ≥ 90%",
    units: 2,
    meaning:
      "Το alt είναι το κείμενο που διαβάζει ο αναγνώστης οθόνης και που καταλαβαίνει η Google. Κενό alt σε διακοσμητική εικόνα είναι σωστό — απόν alt δεν είναι.",
    fix: "Προσθέστε περιγραφικό alt σε κάθε ουσιαστική εικόνα και alt=\"\" στις καθαρά διακοσμητικές.",
    run(ctx) {
      const { total, withAlt, decorative } = ctx.facts.images;
      if (total === 0) return { state: NA, measured: "Η σελίδα δεν έχει εικόνες <img>." };
      const declared = withAlt + decorative;
      const coverage = pct(declared, total);
      if (coverage >= 90) {
        return { state: PASS, measured: `${declared}/${total} εικόνες με δηλωμένο alt (${coverage}%).` };
      }
      if (coverage >= 60) {
        return { state: PARTIAL, measured: `${declared}/${total} εικόνες με alt (${coverage}%).` };
      }
      return { state: FAIL, measured: `Μόνο ${declared}/${total} εικόνες έχουν alt (${coverage}%).` };
    },
  },
];

// ── Δομημένα δεδομένα & ετοιμότητα για AI (βάρος 20) ─────────────────────────

const STRUCTURED_RULES = [
  {
    id: "LD-01",
    title: "Υπάρχει JSON-LD και κάνει parse",
    units: 4,
    meaning:
      "Τα δομημένα δεδομένα είναι ο τρόπος που εξηγείτε στη Google και στα AI τι ακριβώς είναι η επιχείρησή σας. Χωρίς αυτά, μαντεύουν.",
    fix: "Προσθέστε ένα <script type=\"application/ld+json\"> με τουλάχιστον Organization ή LocalBusiness.",
    run(ctx) {
      const blocks = ctx.facts.jsonLd;
      if (blocks.length === 0) return { state: FAIL, measured: "Δεν υπάρχει κανένα block JSON-LD." };
      const { parsed, broken } = ctx.jsonLd;
      if (broken.length === 0) {
        return { state: PASS, measured: `${blocks.length} block${blocks.length > 1 ? "s" : ""}, όλα έγκυρα.` };
      }
      if (parsed.length > 0) {
        return {
          state: PARTIAL,
          measured: `${parsed.length}/${blocks.length} έγκυρα. Σφάλμα σε ${broken.length}.`,
          evidence: broken,
        };
      }
      return { state: FAIL, measured: `Κανένα block δεν κάνει parse.`, evidence: broken };
    },
  },
  {
    id: "LD-02",
    title: "Οντότητα Organization ή LocalBusiness",
    units: 3,
    meaning: "Είναι η ταυτότητα της επιχείρησης: όνομα, λογότυπο, διεύθυνση, τηλέφωνο — αυτά που εμφανίζονται στο πλαίσιο δεξιά στη Google.",
    fix: "Προσθέστε κόμβο με @type LocalBusiness (ή Organization αν δεν έχετε φυσικό κατάστημα) και συμπληρώστε name, url, logo, address, telephone.",
    run(ctx) {
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      if (nodes.length === 0) return { state: FAIL, measured: "Δεν υπάρχουν δομημένα δεδομένα." };
      const found = findType(nodes, "Organization", "LocalBusiness", "ProfessionalService", "Store", "Corporation");
      const label = found && (Array.isArray(found["@type"]) ? found["@type"].join(" + ") : found["@type"]);
      return found
        ? { state: PASS, measured: `Βρέθηκε ${label}.` }
        : { state: FAIL, measured: "Δεν υπάρχει οντότητα επιχείρησης." };
    },
  },
  {
    id: "LD-03",
    title: "Οντότητα WebSite",
    units: 2,
    meaning: "Δηλώνει το site ως ενιαία οντότητα με όνομα και διεύθυνση — προϋπόθεση για το πλαίσιο αναζήτησης μέσα στα αποτελέσματα της Google.",
    fix: "Προσθέστε κόμβο `{\"@type\":\"WebSite\",\"name\":\"…\",\"url\":\"https://…\"}` στο @graph σας.",
    run(ctx) {
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      const site = findType(nodes, "WebSite");
      if (!site) return { state: FAIL, measured: "Δεν υπάρχει οντότητα WebSite." };
      const complete = site.url && site.name;
      return complete
        ? { state: PASS, measured: `WebSite με name «${site.name}».` }
        : { state: PARTIAL, measured: "Υπάρχει WebSite αλλά λείπει name ή url." };
    },
  },
  {
    id: "LD-04",
    title: "BreadcrumbList σε εσωτερικές σελίδες",
    units: 2,
    meaning: "Η διαδρομή πλοήγησης που εμφανίζεται πάνω από τον τίτλο στα αποτελέσματα αναζήτησης, αντί για ολόκληρο το URL.",
    fix: "Προσθέστε BreadcrumbList με τη διαδρομή από την αρχική μέχρι την τρέχουσα σελίδα.",
    run(ctx) {
      const path = new URL(ctx.finalUrl).pathname.replace(/^\/|\/$/g, "");
      if (!path) {
        return { state: NA, measured: "Ελέγχθηκε η αρχική σελίδα — δεν χρειάζεται διαδρομή πλοήγησης." };
      }
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      return hasType(nodes, "BreadcrumbList")
        ? { state: PASS, measured: "Υπάρχει BreadcrumbList." }
        : { state: FAIL, measured: "Εσωτερική σελίδα χωρίς BreadcrumbList." };
    },
  },
  {
    id: "LD-05",
    title: "Υποχρεωτικές ιδιότητες συμπληρωμένες",
    units: 3,
    meaning: "Μια οντότητα επιχείρησης χωρίς διεύθυνση και τηλέφωνο δεν βοηθά τη Google να σας εμφανίσει σε τοπικές αναζητήσεις.",
    fix: "Συμπληρώστε name, url, logo, address (με streetAddress, postalCode, addressLocality) και telephone.",
    run(ctx) {
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      const business = findType(nodes, "Organization", "LocalBusiness", "ProfessionalService", "Store", "Corporation");
      if (!business) return { state: FAIL, measured: "Δεν υπάρχει οντότητα επιχείρησης για έλεγχο." };

      const checks = {
        name: Boolean(business.name),
        url: Boolean(business.url),
        logo: Boolean(business.logo || business.image),
        address: Boolean(business.address),
        telephone: Boolean(business.telephone || business.contactPoint),
      };
      const missing = Object.entries(checks).filter(([, present]) => !present).map(([key]) => key);

      if (missing.length === 0) return { state: PASS, measured: "Και οι πέντε ιδιότητες υπάρχουν." };
      if (missing.length <= 2) return { state: PARTIAL, measured: `Λείπουν: ${missing.join(", ")}.` };
      return { state: FAIL, measured: `Λείπουν: ${missing.join(", ")}.` };
    },
  },
  {
    id: "LD-06",
    title: "sameAs με προφίλ κοινωνικών δικτύων",
    units: 2,
    meaning: "Συνδέει το site με τα επίσημα προφίλ σας, ώστε η Google να ξέρει ότι είναι η ίδια επιχείρηση.",
    fix: "Προσθέστε `\"sameAs\": [\"https://www.facebook.com/…\", \"https://www.linkedin.com/company/…\"]` — μόνο ενεργά προφίλ.",
    run(ctx) {
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      const business = findType(nodes, "Organization", "LocalBusiness", "ProfessionalService", "Store", "Corporation");
      if (!business) return { state: NA, measured: "Δεν υπάρχει οντότητα επιχείρησης για έλεγχο." };

      const sameAs = business.sameAs;
      const list = Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [];
      const real = list.filter((entry) => /^https?:\/\//i.test(entry) && !/example\.com|yourdomain|placeholder/i.test(entry));

      if (real.length === 0) {
        return {
          state: FAIL,
          measured: list.length ? "Το sameAs περιέχει μόνο placeholder τιμές." : "Δεν υπάρχει sameAs.",
          fix: "Προσθέστε sameAs μόνο αν έχετε ενεργά προφίλ. Ένα σπασμένο sameAs βλάπτει περισσότερο από την απουσία του.",
        };
      }
      return { state: PASS, measured: `${real.length} σύνδεσμοι: ${real.slice(0, 3).join(", ")}` };
    },
  },
  {
    id: "LD-07",
    title: "FAQPage όταν υπάρχει ενότητα ερωτήσεων",
    units: 2,
    meaning:
      "Αν η σελίδα έχει συχνές ερωτήσεις χωρίς το αντίστοιχο schema, χάνετε τη δυνατότητα να εμφανιστούν οι ερωτήσεις απευθείας στα αποτελέσματα.",
    fix: "Προσθέστε FAQPage με mainEntity: πίνακα από Question, το καθένα με acceptedAnswer.",
    run(ctx) {
      const nodes = flattenJsonLd(ctx.jsonLd.parsed);
      const hasFaqSchema = hasType(nodes, "FAQPage");
      // Ανίχνευση ενότητας ερωτήσεων στο κείμενο — ελληνικά και αγγλικά.
      const looksLikeFaq =
        /συχν[έεών]{1,3}\s+ερωτ[ήη]σ|συχνές\s+ερωτήσεις|frequently\s+asked|\bFAQ\b/i.test(ctx.facts.text) ||
        /id=["']faq|class=["'][^"']*\bfaq\b/i.test(ctx.html.slice(0, 300_000));

      if (hasFaqSchema) {
        const faq = findType(nodes, "FAQPage");
        const questions = Array.isArray(faq?.mainEntity) ? faq.mainEntity.length : faq?.mainEntity ? 1 : 0;
        return questions > 0
          ? { state: PASS, measured: `FAQPage με ${questions} ερωτήσεις.` }
          : { state: PARTIAL, measured: "Υπάρχει FAQPage αλλά χωρίς mainEntity." };
      }
      if (looksLikeFaq) {
        return { state: FAIL, measured: "Εντοπίστηκε ενότητα συχνών ερωτήσεων χωρίς αντίστοιχο FAQPage schema." };
      }
      return { state: NA, measured: "Η σελίδα δεν έχει ενότητα συχνών ερωτήσεων." };
    },
  },
  {
    id: "LD-08",
    title: "Το κείμενο υπάρχει στο HTML, όχι μόνο σε JavaScript",
    units: 2,
    meaning:
      "Αν το περιεχόμενο χτίζεται από JavaScript, οι crawlers και τα AI που δεν εκτελούν κώδικα βλέπουν άδεια σελίδα.",
    fix: "Χρησιμοποιήστε server-side rendering ή static generation, ώστε το κείμενο να υπάρχει στο HTML που κατεβαίνει.",
    run(ctx) {
      const words = ctx.facts.wordCount;
      if (words >= 200) return { state: PASS, measured: `${words} λέξεις στο HTML.` };
      if (words >= 80) {
        return { state: PARTIAL, measured: `${words} λέξεις — λίγες για να καταλάβει η μηχανή το θέμα.` };
      }
      return {
        state: FAIL,
        measured: `${words} λέξεις στο HTML — η σελίδα φαίνεται σχεδόν άδεια στους crawlers.`,
      };
    },
  },
];

// ── Απόδοση (βάρος 20) ───────────────────────────────────────────────────────

const PERFORMANCE_RULES = [
  {
    id: "PERF-01",
    title: "Χρόνος πρώτου byte κάτω από 600ms",
    units: 4,
    meaning: "Πόσο αργεί ο server να αρχίσει να απαντά. Είναι το πρώτο πράγμα που νιώθει ο επισκέπτης και ό,τι ακολουθεί προστίθεται πάνω του.",
    fix: "Ενεργοποιήστε cache στον server ή CDN. Σε WordPress, ένα plugin σελιδοποίησης cache συνήθως ρίχνει τον χρόνο κάτω από 200ms.",
    run(ctx) {
      const ms = ctx.ttfbMs;
      if (ms == null) return { state: NA, measured: "Δεν μετρήθηκε." };
      const detail = `${ms}ms (διάμεσος ${ctx.ttfbSamples?.length || 1} μετρήσεων)`;
      if (ms < 600) return { state: PASS, measured: detail };
      if (ms < 1200) return { state: PARTIAL, measured: detail };
      return { state: FAIL, measured: detail };
    },
  },
  {
    id: "PERF-02",
    title: "Συμπίεση Brotli ή gzip",
    units: 3,
    meaning: "Η συμπίεση μικραίνει το HTML κατά 70–80%. Χωρίς αυτήν, κάθε επισκέπτης κατεβάζει τετραπλάσια δεδομένα.",
    fix: "Ενεργοποιήστε Brotli στον server ή βάλτε το site πίσω από CDN — σχεδόν όλα το κάνουν αυτόματα.",
    run(ctx) {
      const encoding = header(ctx, "content-encoding");
      if (!encoding) {
        // Το runtime των Cloudflare Workers αποσυμπιέζει μόνο του κάθε subrequest
        // και αφαιρεί το Content-Encoding πριν φτάσει εδώ — ακόμη κι όταν το
        // probe.js ζητάει ρητά «Accept-Encoding: gzip, br». Δηλαδή η απουσία του
        // header ΔΕΝ είναι ένδειξη ότι το site στέλνει ασυμπίεστο HTML:
        // επιβεβαιώθηκε με curl ότι sites που όντως στέλνουν `br` φτάνουν εδώ
        // χωρίς header. Δεν έχουμε στοιχείο, οπότε δεν βαθμολογούμε στα τυφλά —
        // ίδια αντιμετώπιση με τον PERF-05.
        return {
          state: NA,
          measured: "Δεν μπορούμε να δούμε τη συμπίεση από εδώ — το περιβάλλον μας αποσυμπιέζει την απάντηση πριν τη μετρήσουμε, οπότε ο κανόνας δεν μετράει στη βαθμολογία. Ελέγξτε το με: curl -sI -H 'Accept-Encoding: br' https://…",
        };
      }
      if (/br/i.test(encoding)) return { state: PASS, measured: `Brotli (${encoding}).` };
      if (/gzip|deflate/i.test(encoding)) {
        return {
          state: PARTIAL,
          measured: `${encoding} — λειτουργεί, αλλά το Brotli δίνει 15–20% μικρότερο αρχείο.`,
        };
      }
      return { state: PARTIAL, measured: `content-encoding: ${encoding}` };
    },
  },
  {
    id: "PERF-03",
    title: "HTML κάτω από 150KB",
    units: 3,
    meaning: "Το ίδιο το HTML, πριν από εικόνες και scripts. Μεγάλο HTML σημαίνει συνήθως ότι όλη η σελίδα είναι φορτωμένη.",
    fix: "Αφαιρέστε αχρησιμοποίητο markup, μεταφέρετε inline CSS/JS σε αρχεία και ενεργοποιήστε minification.",
    run(ctx) {
      const kb = Math.round(ctx.bytes / 1024);
      if (ctx.truncated) return { state: FAIL, measured: `Πάνω από 5MB — η λήψη κόπηκε στο όριο.` };
      if (kb <= 150) return { state: PASS, measured: `${kb}KB.` };
      if (kb <= 400) return { state: PARTIAL, measured: `${kb}KB.` };
      return { state: FAIL, measured: `${kb}KB — υπερβολικά μεγάλο.` };
    },
  },
  {
    id: "PERF-04",
    title: "Cache-Control σε στατικά αρχεία",
    units: 3,
    meaning: "Χωρίς cache, ο επισκέπτης ξανακατεβάζει τα ίδια CSS και JS σε κάθε σελίδα που ανοίγει.",
    fix: "Δώστε `Cache-Control: public, max-age=31536000, immutable` σε CSS/JS με fingerprint στο όνομα αρχείου.",
    run(ctx) {
      const samples = ctx.probes.assets || [];
      if (samples.length === 0) return { state: NA, measured: "Δεν βρέθηκαν στατικά αρχεία για δειγματοληψία." };

      const withLongCache = samples.filter((sample) => {
        const value = sample.headers?.get("cache-control") || "";
        const maxAge = Number(value.match(/max-age\s*=\s*(\d+)/i)?.[1] ?? 0);
        return maxAge >= 31536000;
      });
      const withAnyCache = samples.filter((sample) => {
        const value = sample.headers?.get("cache-control") || "";
        return /max-age\s*=\s*[1-9]/i.test(value);
      });

      if (withLongCache.length === samples.length) {
        return { state: PASS, measured: `${samples.length}/${samples.length} αρχεία με cache ενός έτους.` };
      }
      if (withAnyCache.length > 0) {
        return {
          state: PARTIAL,
          measured: `${withAnyCache.length}/${samples.length} αρχεία με cache, αλλά μικρότερης διάρκειας από ένα έτος.`,
        };
      }
      return { state: FAIL, measured: `Κανένα από τα ${samples.length} αρχεία δεν έχει Cache-Control.` };
    },
  },
  {
    id: "PERF-05",
    title: "Υποστήριξη HTTP/3",
    units: 2,
    meaning: "Το HTTP/3 μειώνει την καθυστέρηση σε κινητά και ασταθή δίκτυα, χωρίς καμία αλλαγή στη σελίδα.",
    fix: "Ενεργοποιήστε HTTP/3 στον πάροχό σας. Σε Cloudflare είναι ένας διακόπτης στο Network.",
    run(ctx) {
      const altSvc = header(ctx, "alt-svc");
      if (altSvc && /h3/i.test(altSvc)) {
        return { state: PASS, measured: `Διαφημίζεται μέσω alt-svc: ${altSvc.slice(0, 60)}` };
      }
      // Δεν μπορούμε να δούμε το πρωτόκολλο της δικής μας σύνδεσης από μέσα από
      // Worker. Χωρίς alt-svc δεν έχουμε στοιχείο — και δεν βαθμολογούμε στα τυφλά.
      return {
        state: NA,
        measured: "Δεν δηλώνεται alt-svc. Δεν μπορούμε να επιβεβαιώσουμε το πρωτόκολλο από εδώ, οπότε ο κανόνας δεν μετράει στη βαθμολογία.",
      };
    },
  },
  {
    id: "PERF-06",
    title: "Σύγχρονες μορφές εικόνας",
    units: 3,
    meaning: "Το WebP και το AVIF δίνουν την ίδια εικόνα σε 30–50% λιγότερα bytes από JPEG ή PNG.",
    fix: "Μετατρέψτε τις εικόνες σε WebP ή AVIF και σερβίρετέ τες με <picture> και fallback. Αν ήδη κάνετε content negotiation (ίδιο URL .jpg, WebP ανάλογα με το Accept), ο έλεγχος δεν μπορεί να το δει από το HTML — αγνοήστε το εύρημα.",
    run(ctx) {
      const { modern, modernSources, raster, total } = ctx.facts.images;
      if (total === 0) return { state: NA, measured: "Η σελίδα δεν έχει εικόνες." };

      // Μια raster εικόνα μέσα σε <picture> με σύγχρονο <source> σερβίρεται στην
      // πράξη ως WebP/AVIF — δεν είναι σωστό να χρεωθεί ως παλιά μορφή.
      const coveredByPicture = Math.min(raster, modernSources);
      const served = modern + coveredByPicture;
      const known = served + (raster - coveredByPicture);
      if (known === 0) {
        return {
          state: NA,
          measured: "Δεν αναγνωρίστηκε η μορφή των εικόνων — πιθανώς σερβίρονται μέσω υπηρεσίας μετασχηματισμού ή είναι διανυσματικές.",
        };
      }
      const share = pct(served, known);
      const modernLabel = served;
      if (share >= 80) return { state: PASS, measured: `${modernLabel}/${known} εικόνες σε WebP/AVIF (${share}%).` };
      if (share >= 30) return { state: PARTIAL, measured: `${modernLabel}/${known} εικόνες σε WebP/AVIF (${share}%).` };
      return { state: FAIL, measured: `Μόνο ${modernLabel}/${known} εικόνες σε σύγχρονη μορφή (${share}%).` };
    },
  },
  {
    id: "PERF-07",
    title: "Λιγότερα από 5 blocking scripts στο <head>",
    units: 2,
    meaning: "Κάθε script χωρίς defer ή async σταματά την εμφάνιση της σελίδας μέχρι να κατέβει και να εκτελεστεί.",
    fix: "Προσθέστε defer (ή async όπου δεν έχει σημασία η σειρά) σε κάθε <script> του <head>.",
    run(ctx) {
      const count = ctx.facts.scripts.blockingInHead;
      if (count === 0) return { state: PASS, measured: "Κανένα blocking script στο <head>." };
      if (count < 5) return { state: PARTIAL, measured: `${count} blocking scripts στο <head>.` };
      return { state: FAIL, measured: `${count} blocking scripts στο <head>.` };
    },
  },
];

// ── Προσβασιμότητα (βάρος 10) ────────────────────────────────────────────────

const A11Y_RULES = [
  {
    id: "A11Y-01",
    title: "Το <html> έχει έγκυρο lang",
    units: 2,
    meaning: "Λέει στον αναγνώστη οθόνης σε ποια γλώσσα να διαβάσει. Χωρίς αυτό, ελληνικό κείμενο διαβάζεται με αγγλική προφορά.",
    fix: "Προσθέστε `<html lang=\"el\">`.",
    run(ctx) {
      const lang = ctx.facts.lang;
      if (!lang) return { state: FAIL, measured: "Το <html> δεν έχει lang." };
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(lang.trim())) {
        return { state: PARTIAL, measured: `lang="${lang}" — δεν μοιάζει με έγκυρο κωδικό γλώσσας.` };
      }
      return { state: PASS, measured: `lang="${lang}"` };
    },
  },
  {
    id: "A11Y-02",
    title: "Το viewport δεν απαγορεύει το zoom",
    units: 2,
    meaning: "Το user-scalable=no εμποδίζει όποιον δεν βλέπει καλά να μεγεθύνει το κείμενο.",
    fix: "Αφήστε `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` χωρίς user-scalable ή maximum-scale.",
    run(ctx) {
      const viewport = ctx.facts.viewport;
      if (!viewport) {
        return {
          state: FAIL,
          measured: "Δεν υπάρχει meta viewport — η σελίδα δεν προσαρμόζεται σε κινητά.",
          fix: "Προσθέστε `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">`.",
        };
      }
      const blocksZoom =
        /user-scalable\s*=\s*(no|0)/i.test(viewport) ||
        Number(viewport.match(/maximum-scale\s*=\s*([\d.]+)/i)?.[1] ?? 5) < 2;
      return blocksZoom
        ? { state: FAIL, measured: `«${viewport}» — απαγορεύει τη μεγέθυνση.` }
        : { state: PASS, measured: `«${viewport}»` };
    },
  },
  {
    id: "A11Y-03",
    title: "Πεδία φόρμας με ετικέτα",
    units: 2,
    meaning: "Χωρίς ετικέτα, ο αναγνώστης οθόνης λέει μόνο «πεδίο κειμένου» και ο χρήστης δεν ξέρει τι να γράψει.",
    fix: "Δώστε σε κάθε πεδίο είτε <label for=\"id\"> είτε aria-label.",
    run(ctx) {
      const { inputs, labelledInputs } = ctx.facts.forms;
      if (inputs === 0) return { state: NA, measured: "Η σελίδα δεν έχει πεδία φόρμας." };
      const coverage = pct(labelledInputs, inputs);
      if (coverage === 100) return { state: PASS, measured: `${inputs}/${inputs} πεδία με ετικέτα.` };
      if (coverage >= 70) return { state: PARTIAL, measured: `${labelledInputs}/${inputs} πεδία με ετικέτα (${coverage}%).` };
      return { state: FAIL, measured: `Μόνο ${labelledInputs}/${inputs} πεδία έχουν ετικέτα (${coverage}%).` };
    },
  },
  {
    id: "A11Y-04",
    title: "Σύνδεσμοι και κουμπιά με προσβάσιμο όνομα",
    units: 2,
    meaning: "Ένας σύνδεσμος που περιέχει μόνο εικονίδιο ανακοινώνεται ως «σύνδεσμος» και τίποτα άλλο.",
    fix: "Προσθέστε aria-label στους συνδέσμους που έχουν μόνο εικονίδιο, ή alt στην εικόνα μέσα τους.",
    run(ctx) {
      const anonymous = ctx.facts.controls.anonymous;
      const total = ctx.facts.links.total;
      if (total === 0) return { state: NA, measured: "Η σελίδα δεν έχει συνδέσμους." };
      if (anonymous === 0) return { state: PASS, measured: `Κανένας από τους ${total} συνδέσμους δεν είναι ανώνυμος.` };
      const share = pct(anonymous, total);
      if (share <= 5) return { state: PARTIAL, measured: `${anonymous} από ${total} συνδέσμους χωρίς όνομα (${share}%).` };
      return { state: FAIL, measured: `${anonymous} από ${total} συνδέσμους χωρίς όνομα (${share}%).` };
    },
  },
  {
    id: "A11Y-05",
    title: "Σημασιολογικά landmarks",
    units: 2,
    meaning: "Τα <header>, <nav>, <main> και <footer> επιτρέπουν στον χρήστη αναγνώστη οθόνης να πηδήξει κατευθείαν στο περιεχόμενο.",
    fix: "Τυλίξτε το κύριο περιεχόμενο σε <main> και χρησιμοποιήστε <header>, <nav>, <footer> αντί για <div>.",
    run(ctx) {
      const { header: h, nav, main, footer, mainCount } = ctx.facts.landmarks;
      const present = [h && "header", nav && "nav", main && "main", footer && "footer"].filter(Boolean);
      if (mainCount > 1) {
        return { state: PARTIAL, measured: `${mainCount} στοιχεία <main> — πρέπει να υπάρχει ένα.` };
      }
      if (present.length === 4) return { state: PASS, measured: "header, nav, main και footer υπάρχουν." };
      if (main) return { state: PARTIAL, measured: `Υπάρχουν: ${present.join(", ")}.` };
      return { state: FAIL, measured: present.length ? `Λείπει το <main>. Υπάρχουν: ${present.join(", ")}.` : "Δεν υπάρχει κανένα landmark." };
    },
  },
];

// ── Εμπιστοσύνη & συμμόρφωση (βάρος 5) ───────────────────────────────────────

const TRUST_RULES = [
  {
    id: "TRUST-01",
    title: "Τρόπος επικοινωνίας ορατός",
    units: 2,
    meaning: "Τηλέφωνο ή email σε κάθε σελίδα. Είναι το πρώτο που ψάχνει ο υποψήφιος πελάτης και το πρώτο που ελέγχει η Google για τοπική επιχείρηση.",
    fix: "Προσθέστε στο υποσέλιδο σύνδεσμο `tel:` και `mailto:` και μια σελίδα επικοινωνίας.",
    run(ctx) {
      const { hasTel, hasMailto } = ctx.facts;
      const hasContactPage = trustHrefs(ctx).some((href) =>
        /epikoinon|contact|επικοινων/i.test(decodeHref(href))
      );
      if ((hasTel || hasMailto) && hasContactPage) {
        return { state: PASS, measured: `Σύνδεσμος ${hasTel ? "tel:" : ""}${hasTel && hasMailto ? " και " : ""}${hasMailto ? "mailto:" : ""} και σελίδα επικοινωνίας.` };
      }
      if (hasTel || hasMailto || hasContactPage) {
        return {
          state: PARTIAL,
          measured: hasContactPage
            ? "Υπάρχει σελίδα επικοινωνίας αλλά όχι άμεσος σύνδεσμος tel:/mailto:."
            : "Υπάρχει σύνδεσμος επικοινωνίας αλλά όχι σελίδα επικοινωνίας.",
        };
      }
      return { state: FAIL, measured: "Δεν βρέθηκε ούτε tel:/mailto: ούτε σελίδα επικοινωνίας." };
    },
  },
  {
    id: "TRUST-02",
    title: "ΑΦΜ ή ΓΕΜΗ ορατά",
    units: 2,
    meaning: "Για ελληνική επιχείρηση, τα στοιχεία μητρώου είναι νομική υποχρέωση στο ηλεκτρονικό εμπόριο και σήμα εμπιστοσύνης παντού αλλού.",
    fix: "Προσθέστε ΑΦΜ, ΔΟΥ και αριθμό ΓΕΜΗ στο υποσέλιδο ή στη σελίδα «Σχετικά».",
    run(ctx) {
      const afmRe = /(Α\.?Φ\.?Μ\.?|ΑΦΜ|VAT)\s*:?\s*(EL)?\s*\d{9}/i;
      const gemiRe = /(ΓΕ\.?ΜΗ\.?|ΓΕΜΗ)\s*:?\s*\d{6,}/i;

      // Είναι φυσιολογικό τα στοιχεία μητρώου να ζουν στη σελίδα «Επικοινωνία»
      // ή «Σχετικά» και όχι στην αρχική — γι' αυτό κοιτάμε και εκείνες.
      const pages = [
        { where: null, text: ctx.facts.text },
        ...(ctx.probes?.companyPages || []).map((page) => ({
          where: pathOf(page.url),
          text: page.text,
        })),
      ];
      let afm;
      let gemi;
      for (const page of pages) {
        if (afm === undefined && afmRe.test(page.text)) afm = page.where;
        if (gemi === undefined && gemiRe.test(page.text)) gemi = page.where;
      }

      const spots = [...new Set([afm, gemi].filter((where) => typeof where === "string"))];
      const note = spots.length ? ` (στη σελίδα ${spots.join(" και ")})` : "";
      if (afm !== undefined && gemi !== undefined) {
        return { state: PASS, measured: `Βρέθηκαν ΑΦΜ και ΓΕΜΗ${note}.` };
      }
      if (afm !== undefined || gemi !== undefined) {
        return {
          state: PARTIAL,
          measured: `Βρέθηκε ${afm !== undefined ? "ΑΦΜ" : "ΓΕΜΗ"}${note}, λείπει το άλλο.`,
        };
      }
      const alsoChecked = pages.length > 1
        ? ` ούτε σε: ${pages.slice(1).map((page) => page.where).join(", ")}`
        : "";
      return { state: FAIL, measured: `Δεν βρέθηκε ΑΦΜ ούτε ΓΕΜΗ στη σελίδα${alsoChecked}.` };
    },
  },
  {
    id: "TRUST-03",
    title: "Πολιτική απορρήτου",
    units: 2,
    meaning: "Υποχρεωτική από τον GDPR για κάθε site που συλλέγει οποιοδήποτε στοιχείο, ακόμη και μέσω φόρμας επικοινωνίας.",
    fix: "Δημιουργήστε σελίδα πολιτικής απορρήτου και βάλτε σύνδεσμο προς αυτήν στο υποσέλιδο κάθε σελίδας.",
    run(ctx) {
      const found = trustHrefs(ctx).some((href) =>
        /privacy|aporrit|απορρ|prosopik|gdpr|cookies?-?polic|politiki-cookies/i.test(decodeHref(href))
      );
      const inText = /πολιτικ[ήη]\s+απορρ[ήη]του|privacy\s+policy/i.test(ctx.facts.text);
      if (found) return { state: PASS, measured: "Βρέθηκε σύνδεσμος προς πολιτική απορρήτου." };
      if (inText) return { state: PARTIAL, measured: "Αναφέρεται στο κείμενο αλλά χωρίς σύνδεσμο." };
      return { state: FAIL, measured: "Δεν βρέθηκε σύνδεσμος προς πολιτική απορρήτου." };
    },
  },
  {
    id: "TRUST-04",
    title: "Χωρίς trackers πριν τη συγκατάθεση",
    units: 3,
    meaning:
      "Το να φορτώνει Google Analytics ή Meta Pixel πριν πει «ναι» ο επισκέπτης είναι η πιο συχνή παράβαση GDPR στα ελληνικά site — και επισύρει πρόστιμο.",
    fix: "Φορτώστε τα scripts παρακολούθησης μόνο μετά τη συγκατάθεση, μέσω μηχανισμού συναίνεσης (π.χ. Google Consent Mode v2).",
    run(ctx) {
      const trackers = ctx.facts.trackers;
      if (trackers.length === 0) {
        return { state: PASS, measured: "Δεν εντοπίστηκε κανένα script παρακολούθησης." };
      }
      const names = trackers.map((tracker) => tracker.label).join(", ");
      if (ctx.facts.consentHint) {
        return {
          state: PARTIAL,
          measured: `Εντοπίστηκαν ${names}, μαζί με μηχανισμό συγκατάθεσης.`,
          fix: "Υπάρχει banner συγκατάθεσης, αλλά από το HTML δεν φαίνεται αν τα scripts όντως περιμένουν το «ναι». Επιβεβαιώστε το με τα εργαλεία δικτύου του browser, σε παράθυρο ιδιωτικής περιήγησης.",
        };
      }
      return {
        state: FAIL,
        measured: `Εντοπίστηκαν ${names} χωρίς κανέναν μηχανισμό συγκατάθεσης.`,
        evidence: trackers.map((tracker) => tracker.label),
      };
    },
  },
];

// ── Συγκέντρωση ──────────────────────────────────────────────────────────────

export const RULES = [
  ...SECURITY_RULES.map((rule) => ({ ...rule, category: "security" })),
  ...SEO_RULES.map((rule) => ({ ...rule, category: "seo" })),
  ...STRUCTURED_RULES.map((rule) => ({ ...rule, category: "structured" })),
  ...PERFORMANCE_RULES.map((rule) => ({ ...rule, category: "performance" })),
  ...A11Y_RULES.map((rule) => ({ ...rule, category: "a11y" })),
  ...TRUST_RULES.map((rule) => ({ ...rule, category: "trust" })),
];

/**
 * Κάνει parse τα JSON-LD blocks μία φορά, πριν τρέξει οποιοσδήποτε κανόνας.
 *
 * Παλιότερα το έκανε ο LD-01 και το άφηνε πάνω στο ctx για τους επόμενους. Αυτό
 * σήμαινε ότι μια αλλαγή στη σειρά των κανόνων θα άδειαζε σιωπηλά τα δομημένα
 * δεδομένα σε έξι κανόνες — σφάλμα που δεν θα έσκαγε, απλώς θα έβγαζε λάθος βαθμό.
 */
function parseJsonLd(blocks) {
  const parsed = [];
  const broken = [];
  blocks.forEach((raw, index) => {
    try {
      parsed.push(JSON.parse(raw));
    } catch (error) {
      broken.push(`#${index + 1}: ${error.message}`);
    }
  });
  return { parsed, broken };
}

/**
 * Τρέχει όλους τους κανόνες. Ένας κανόνας που σκάει γίνεται `na` αντί να ρίξει
 * ολόκληρο τον έλεγχο — προτιμούμε αποτέλεσμα με ένα κενό από καθόλου αποτέλεσμα.
 */
export function runRules(input) {
  const ctx = { ...input, jsonLd: parseJsonLd(input.facts.jsonLd || []) };

  return RULES.map((rule) => {
    let outcome;
    try {
      outcome = rule.run(ctx) || { state: NA, measured: "Ο κανόνας δεν επέστρεψε αποτέλεσμα." };
    } catch (error) {
      outcome = { state: NA, measured: `Ο κανόνας δεν μπόρεσε να εκτελεστεί: ${error.message}` };
    }
    return {
      id: rule.id,
      category: rule.category,
      title: rule.title,
      units: rule.units,
      state: outcome.state,
      measured: outcome.measured,
      meaning: rule.meaning,
      fix: outcome.fix || rule.fix,
      note: outcome.note,
      evidence: outcome.evidence,
    };
  });
}
