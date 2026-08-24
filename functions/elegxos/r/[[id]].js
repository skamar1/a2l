/**
 * /elegxos/r/<id> — μόνιμος σύνδεσμος αποτελέσματος.
 *
 * Δεν ξαναχτίζουμε τη σελίδα σε JavaScript. Παίρνουμε το στατικό /elegxos/ που
 * έφτιαξε το Hugo και εμβολιάζουμε το αποθηκευμένο αποτέλεσμα ως data block.
 * Έτσι υπάρχει ένα μόνο template: αν αλλάξει η σχεδίαση, ο μόνιμος σύνδεσμος
 * την ακολουθεί χωρίς να το θυμηθεί κανείς.
 */

export async function onRequestGet(context) {
  const { params, env, request } = context;

  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = String(raw || "").toLowerCase();

  // Το id το φτιάχνουμε εμείς — 18 hex. Ό,τι δεν ταιριάζει δεν το ψάχνουμε καν.
  if (!/^[0-9a-f]{18}$/.test(id)) {
    return notFound(env, request);
  }

  let report = null;
  if (env.CHECKS) {
    try {
      report = await env.CHECKS.get(`r:${id}`, { type: "json" });
    } catch (error) {
      console.error("could not read result:", error);
    }
  }
  if (!report) return notFound(env, request);

  const shell = await env.ASSETS.fetch(new URL("/elegxos/", request.url));
  if (!shell.ok) return notFound(env, request);

  const title = `Έλεγχος ${hostOf(report.url)} — ${report.total}/100 · A2 Labs`;
  const description = `Αποτέλεσμα ελέγχου για ${hostOf(report.url)}: ${report.total}/100 σε ασφάλεια, SEO, δομημένα δεδομένα, απόδοση, προσβασιμότητα και συμμόρφωση.`;

  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(title) })
    .on('meta[name="description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute("content", title) })
    .on('meta[property="og:description"]', { element: (el) => el.setAttribute("content", description) })
    .on("head", {
      element(el) {
        // type="application/json" δεν εκτελείται, άρα δεν το αγγίζει το script-src
        // του CSP — γι' αυτό περνάμε τα δεδομένα έτσι κι όχι με inline script.
        el.append(`<script type="application/json" id="a2-result">${safeJson(report)}</script>`, {
          html: true,
        });
      },
    })
    .transform(shell);

  // Διαβάζουμε ολόκληρο το σώμα αντί να περάσουμε το `rewritten.body` σε νέο
  // Response: αποσπασμένο από το Response του, το stream του HTMLRewriter δεν
  // οδηγείται και το αίτημα κρεμάει για πάντα. Η σελίδα είναι ~40KB, οπότε δεν
  // κερδίζουμε τίποτα ουσιαστικό από το streaming εδώ.
  const html = await rewritten.text();

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      // Ο μόνιμος σύνδεσμος δεν πρέπει να μπει σε ευρετήριο: τα αποτελέσματα
      // αφορούν ξένα site και δεν είναι δικό μας περιεχόμενο για τη Google.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Το `</script>` μέσα σε string θα έκλεινε το data block νωρίς και θα άφηνε το
 * υπόλοιπο JSON να πέσει στη σελίδα ως markup. Τα U+2028/U+2029 σπάνε τον JSON
 * parser κάποιων browsers, οπότε φεύγουν κι αυτά.
 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function notFound(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
