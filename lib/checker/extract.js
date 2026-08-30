/**
 * extract.js — μία streaming διέλευση του HTML με HTMLRewriter.
 *
 * Ο λόγος που δεν χρησιμοποιούμε βιβλιοθήκη parsing: το HTMLRewriter είναι ο
 * native parser της Cloudflare, δουλεύει σε stream και δεν χτίζει DOM στη μνήμη.
 * Ένα cheerio/jsdom πάνω σε σελίδα 2MB σκάει στο όριο CPU του δωρεάν πλάνου.
 *
 * Το αρχείο ΜΟΝΟ μαζεύει γεγονότα. Καμία κρίση, καμία βαθμολογία — αυτά ζουν
 * στο rules.js, ώστε ο ίδιος parser να μπορεί να τροφοδοτήσει και άλλους κανόνες
 * αργότερα χωρίς να ξαναγραφτεί.
 */

const TRACKER_PATTERNS = [
  { id: "ga4", label: "Google Analytics", re: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(g\/collect|analytics\.js)/i },
  { id: "gtm", label: "Google Tag Manager", re: /googletagmanager\.com\/gtm\.js/i },
  { id: "meta-pixel", label: "Meta Pixel", re: /connect\.facebook\.net\/[^/]+\/fbevents\.js/i },
  { id: "hotjar", label: "Hotjar", re: /static\.hotjar\.com/i },
  { id: "clarity", label: "Microsoft Clarity", re: /clarity\.ms\/tag/i },
  { id: "tiktok", label: "TikTok Pixel", re: /analytics\.tiktok\.com/i },
  { id: "linkedin", label: "LinkedIn Insight", re: /snap\.licdn\.com/i },
];

// Ψάχνουμε *μηχανισμό* συγκατάθεσης, όχι τη λέξη «cookies». Σχεδόν κάθε site
// αναφέρει cookies κάπου· αν το μετρούσαμε αυτό ως banner, ο TRUST-04 δεν θα
// έβγαζε ποτέ αποτυχία — δηλαδή ο πιο χρήσιμος κανόνας θα ήταν διακοσμητικός.
const CONSENT_PATTERNS =
  /cookieconsent|cookie-consent|cookiebot|onetrust|klaro|osano|termly|iubenda|complianz|borlabs|cookie-?banner|cookie-?notice|cookie-?law|gdpr-?consent|consent-?manager|__tcfapi|googlefc|συγκατάθεσ[ηι]/i;

// Το lookahead αντί για `$`: ελέγχουμε ένα haystack "src srcset", οπότε η
// κατάληξη σχεδόν ποτέ δεν βρίσκεται στο τέλος της συμβολοσειράς. Με `$` ο
// έλεγχος μορφής εικόνας δεν έβρισκε ποτέ τίποτα και ο PERF-06 έβγαινε `na`.
const MODERN_IMAGE_RE = /\.(webp|avif)(?=[?#\s,]|$)/i;
const RASTER_IMAGE_RE = /\.(jpe?g|png|gif|bmp|tiff?)(?=[?#\s,]|$)/i;
const VECTOR_IMAGE_RE = /\.svg(?=[?#\s,]|$)/i;

/** Άδειο σύνολο γεγονότων — κάθε πεδίο ορίζεται, ώστε οι κανόνες να μη σκάνε σε undefined. */
function emptyFacts() {
  return {
    lang: null,
    title: "",
    titleCount: 0,
    metaDescription: null,
    metaKeywords: null,
    metaGenerator: null,
    metaRobots: null,
    metaCsp: null,
    viewport: null,
    charset: null,
    canonical: null,
    og: {},
    twitter: {},
    h1Count: 0,
    h1Texts: [],
    headingCounts: { h1: 0, h2: 0, h3: 0 },
    images: { total: 0, withAlt: 0, decorative: 0, modern: 0, modernSources: 0, raster: 0, vector: 0, lazy: 0, missingDimensions: 0 },
    scripts: { external: [], inline: 0, blockingInHead: 0, moduleCount: 0 },
    stylesheets: [],
    icons: { icon: false, appleTouch: false, manifest: false },
    preconnects: [],
    jsonLdRaw: [],
    links: { total: 0, internal: 0, external: 0, hrefs: [], companyHrefs: [] },
    hasTel: false,
    hasMailto: false,
    forms: { count: 0, inputs: 0, labelledInputs: 0 },
    labelFor: new Set(),
    pendingInputs: [],
    controls: { total: 0, named: 0 },
    landmarks: { header: false, nav: false, main: false, footer: false, mainCount: 0 },
    insecureRefs: [],
    trackers: [],
    consentHint: false,
    inHead: true,
  };
}

/**
 * @param {string} html  Το ωμό HTML όπως το κατέβασε ο probe.
 * @param {string} pageUrl  Το τελικό URL (μετά από redirects) — για internal/external.
 */
/**
 * Τα ελληνικά slugs (π.χ. /επικοινωνια/) φτάνουν στο HTML percent-encoded
 * (%ce%b5%cf%80…) — χωρίς αποκωδικοποίηση, κανένα ελληνικό pattern δεν
 * ταιριάζει ποτέ σε href.
 */
export function decodeHref(href) {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * Σελίδες όπου συνήθως ζουν τα στοιχεία της επιχείρησης: Επικοινωνία, Σχετικά,
 * Όροι, Πολιτική απορρήτου. Τα ελληνικά pattern είναι άτονα επίτηδες — τα slugs
 * γράφονται χωρίς τόνους (/οροι-χρησης/). Μαζεύονται σε δική τους λίστα, όχι
 * μέσα από το hrefs: εκείνο κόβεται στους 400 πρώτους συνδέσμους, και σε ένα
 * e-shop με 1.500+ links τα footer links (όροι, απόρρητο) μένουν πάντα απέξω.
 */
export const COMPANY_PAGE_RE =
  /epikoin|epikin|contact|kontakt|sxetik|σχετικ|επικοινων|about|etaire|εταιρ|oroi|[οό]ροι|terms|nomik|νομικ|impressum|privacy|aporrit|απορρ[ηή]τ/i;

/**
 * HTML → ορατό κείμενο. Εξάγεται χωριστά ώστε ο έλεγχος ΑΦΜ/ΓΕΜΗ να μπορεί να
 * διαβάσει και δευτερεύουσες σελίδες (Επικοινωνία, Σχετικά) χωρίς το κόστος
 * ενός πλήρους extractFacts για την καθεμία.
 */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#\d+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractFacts(html, pageUrl) {
  const facts = emptyFacts();
  const pageOrigin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return null;
    }
  })();
  const isHttps = pageUrl.startsWith("https://");

  const attr = (element, name) => element.getAttribute(name);
  const push = (list, value, cap = 60) => {
    if (list.length < cap) list.push(value);
  };

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        facts.lang = attr(el, "lang");
      },
    })
    .on("head", {
      element(el) {
        el.onEndTag(() => {
          facts.inHead = false;
        });
      },
    })
    .on("body", {
      element() {
        facts.inHead = false;
      },
    })
    .on("title", {
      element() {
        facts.titleCount += 1;
      },
      text(chunk) {
        if (facts.titleCount <= 1) facts.title += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const name = (attr(el, "name") || "").toLowerCase();
        const property = (attr(el, "property") || "").toLowerCase();
        const httpEquiv = (attr(el, "http-equiv") || "").toLowerCase();
        const content = attr(el, "content");

        if (attr(el, "charset")) facts.charset = attr(el, "charset");
        if (httpEquiv === "content-type" && content) {
          facts.charset = facts.charset || content.match(/charset=([^;\s]+)/i)?.[1] || null;
        }
        if (httpEquiv === "content-security-policy" && content) facts.metaCsp = content;

        if (name === "description") facts.metaDescription = content;
        else if (name === "keywords") facts.metaKeywords = content;
        else if (name === "generator") facts.metaGenerator = content;
        else if (name === "robots") facts.metaRobots = content;
        else if (name === "viewport") facts.viewport = content;

        if (property.startsWith("og:")) facts.og[property.slice(3)] = content;
        // Το twitter:* δηλώνεται άλλοτε ως name και άλλοτε ως property.
        if (name.startsWith("twitter:")) facts.twitter[name.slice(8)] = content;
        else if (property.startsWith("twitter:")) facts.twitter[property.slice(8)] = content;
      },
    })
    .on("link", {
      element(el) {
        const rel = (attr(el, "rel") || "").toLowerCase();
        const href = attr(el, "href");
        if (!href) return;
        // Το rel είναι λίστα με κενά ("shortcut icon"), και το "apple-touch-icon"
        // περιέχει τη λέξη "icon" — με includes() θα μετριόταν ως favicon.
        const relTokens = rel.split(/\s+/).filter(Boolean);
        if (relTokens.includes("icon") || relTokens.includes("mask-icon")) facts.icons.icon = true;
        if (relTokens.some((token) => token.startsWith("apple-touch-icon"))) facts.icons.appleTouch = true;
        if (relTokens.includes("manifest")) facts.icons.manifest = true;
        if (rel.includes("canonical")) facts.canonical = href;
        if (rel.includes("stylesheet")) push(facts.stylesheets, href);
        if (rel.includes("preconnect") || rel.includes("dns-prefetch")) push(facts.preconnects, href);
        if (isHttps && href.startsWith("http://")) push(facts.insecureRefs, href, 20);
      },
    })
    .on("script", {
      element(el) {
        const src = attr(el, "src");
        const type = (attr(el, "type") || "").toLowerCase();

        if (type === "application/ld+json") {
          let buffer = "";
          // Το JSON-LD έρχεται σε κομμάτια· το μαζεύουμε και το κάνουμε parse στο τέλος.
          facts.jsonLdRaw.push({ get text() { return buffer; } });
          const slot = facts.jsonLdRaw[facts.jsonLdRaw.length - 1];
          Object.defineProperty(slot, "append", {
            value: (chunk) => {
              if (buffer.length < 200_000) buffer += chunk;
            },
          });
          facts._ldSlot = slot;
          return;
        }
        facts._ldSlot = null;

        if (src) {
          push(facts.scripts.external, src, 80);
          if (isHttps && src.startsWith("http://")) push(facts.insecureRefs, src, 20);
          const isDeferred = el.hasAttribute("defer") || el.hasAttribute("async");
          if (type === "module") facts.scripts.moduleCount += 1;
          // Τα type="module" είναι deferred εξ ορισμού.
          if (facts.inHead && !isDeferred && type !== "module") facts.scripts.blockingInHead += 1;
        } else if (type === "" || type === "text/javascript" || type === "module") {
          facts.scripts.inline += 1;
        }
      },
      text(chunk) {
        if (facts._ldSlot) facts._ldSlot.append(chunk.text);
      },
    })
    .on("img", {
      element(el) {
        const images = facts.images;
        images.total += 1;

        const alt = attr(el, "alt");
        if (alt !== null && alt.trim() !== "") images.withAlt += 1;
        else if (alt !== null) images.decorative += 1; // alt="" = διακοσμητική, σωστό

        if (el.hasAttribute("loading")) images.lazy += 1;
        if (!el.hasAttribute("width") || !el.hasAttribute("height")) images.missingDimensions += 1;

        const src = attr(el, "src") || attr(el, "data-src") || "";
        const srcset = attr(el, "srcset") || "";
        const haystack = `${src} ${srcset}`;
        // Το SVG είναι ήδη η βέλτιστη μορφή για ό,τι δεν είναι φωτογραφία, οπότε
        // μένει έξω από τον λόγο modern/raster αντί να μετρήσει ως αποτυχία.
        if (MODERN_IMAGE_RE.test(haystack)) images.modern += 1;
        else if (VECTOR_IMAGE_RE.test(haystack)) images.vector += 1;
        else if (RASTER_IMAGE_RE.test(haystack)) images.raster += 1;

        if (isHttps && src.startsWith("http://")) push(facts.insecureRefs, src, 20);
      },
    })
    .on("source", {
      element(el) {
        // Ξεχωριστός μετρητής, όχι +1 στο `modern`: ένα <picture> με avif ΚΑΙ webp
        // source έχει δύο <source> αλλά μία εικόνα — θα μετρούσαμε περισσότερες
        // «σύγχρονες» εικόνες από όσες υπάρχουν στη σελίδα.
        const srcset = attr(el, "srcset") || "";
        if (MODERN_IMAGE_RE.test(srcset)) facts.images.modernSources += 1;
      },
    })
    .on("a", {
      element(el) {
        const href = attr(el, "href");
        facts.controls.total += 1;
        if (attr(el, "aria-label")?.trim() || attr(el, "title")?.trim()) facts.controls.named += 1;
        else facts.controls._pendingA = (facts.controls._pendingA || 0) + 1;

        if (!href) return;
        facts.links.total += 1;

        if (href.startsWith("tel:")) facts.hasTel = true;
        if (href.startsWith("mailto:")) facts.hasMailto = true;
        push(facts.links.hrefs, href, 400);
        if (COMPANY_PAGE_RE.test(decodeHref(href))) push(facts.links.companyHrefs, href, 12);

        if (/^https?:\/\//i.test(href)) {
          try {
            if (pageOrigin && new URL(href).origin === pageOrigin) facts.links.internal += 1;
            else facts.links.external += 1;
          } catch {
            /* άκυρο href — δεν το μετράμε */
          }
        } else if (!href.startsWith("#") && !href.includes(":")) {
          facts.links.internal += 1;
        }
        if (isHttps && href.startsWith("http://")) push(facts.insecureRefs, href, 20);
      },
    })
    .on("button", {
      element(el) {
        facts.controls.total += 1;
        if (attr(el, "aria-label")?.trim() || attr(el, "title")?.trim()) facts.controls.named += 1;
      },
    })
    .on("form", {
      element() {
        facts.forms.count += 1;
      },
    })
    .on("label", {
      element(el) {
        const target = attr(el, "for");
        if (target) facts.labelFor.add(target);
      },
    })
    .on("input, select, textarea", {
      element(el) {
        const type = (attr(el, "type") || "").toLowerCase();
        // Τα κρυφά και τα κουμπιά δεν χρειάζονται ετικέτα.
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
        facts.forms.inputs += 1;
        const id = attr(el, "id");
        if (attr(el, "aria-label")?.trim() || attr(el, "aria-labelledby")?.trim() || attr(el, "title")?.trim()) {
          facts.forms.labelledInputs += 1;
        } else if (id) {
          facts.pendingInputs.push(id);
        }
      },
    })
    .on("h1", {
      element() {
        facts.h1Count += 1;
        facts.headingCounts.h1 += 1;
        if (facts.h1Texts.length < 5) facts.h1Texts.push("");
      },
      text(chunk) {
        // Το HTMLRewriter δίνει το κείμενο σε κομμάτια, ένα ανά text node: ένας
        // <h1>Α<br><span>Β</span></h1> έρχεται σε τρία. Τα ενώνουμε στον τίτλο
        // του τρέχοντος h1 αντί να τα κρατάμε ως ξεχωριστούς τίτλους.
        if (facts.h1Texts.length === 0 || facts.h1Texts.length > 5) return;
        const index = facts.h1Texts.length - 1;
        facts.h1Texts[index] = `${facts.h1Texts[index]} ${chunk.text}`;
      },
    })
    .on("h2", { element() { facts.headingCounts.h2 += 1; } })
    .on("h3", { element() { facts.headingCounts.h3 += 1; } })
    .on("header", { element() { facts.landmarks.header = true; } })
    .on("nav", { element() { facts.landmarks.nav = true; } })
    .on("main", {
      element() {
        facts.landmarks.main = true;
        facts.landmarks.mainCount += 1;
      },
    })
    .on("footer", { element() { facts.landmarks.footer = true; } })
    .on("iframe", {
      element(el) {
        const src = attr(el, "src") || "";
        if (isHttps && src.startsWith("http://")) push(facts.insecureRefs, src, 20);
      },
    });

  await rewriter.transform(new Response(html, { headers: { "content-type": "text/html" } })).arrayBuffer();

  // ── Υπολογισμοί που χρειάζονται όλη τη σελίδα ──────────────────────────────
  facts.title = facts.title.trim().replace(/\s+/g, " ");
  facts.h1Texts = facts.h1Texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  facts.forms.labelledInputs += facts.pendingInputs.filter((id) => facts.labelFor.has(id)).length;

  // Το ορατό κείμενο. Δεν το μαζεύουμε από το HTMLRewriter επειδή ένας text
  // handler σε <body> πιάνει και το περιεχόμενο των <script> — που θα φούσκωνε
  // τη μέτρηση λέξεων και θα ακύρωνε τον κανόνα LD-08 (SPA χωρίς περιεχόμενο).
  const text = htmlToText(html);
  facts.text = text.slice(0, 200_000);
  facts.wordCount = text ? text.split(/\s+/).length : 0;

  facts.jsonLd = facts.jsonLdRaw.map((slot) => slot.text).filter((raw) => raw.trim());
  delete facts.jsonLdRaw;
  delete facts._ldSlot;

  // Trackers: ψάχνουμε και στα src και στο ωμό HTML (πολλά μπαίνουν inline).
  const scriptHaystack = `${facts.scripts.external.join(" ")} ${html.slice(0, 400_000)}`;
  facts.trackers = TRACKER_PATTERNS.filter((tracker) => tracker.re.test(scriptHaystack)).map(
    ({ id, label }) => ({ id, label })
  );
  facts.consentHint = CONSENT_PATTERNS.test(html.slice(0, 400_000));

  // Το κείμενο των <a> δεν μπορεί να συσχετιστεί αξιόπιστα με το στοιχείο σε
  // streaming parsing. Χρησιμοποιούμε το ωμό HTML για μια συντηρητική εκτίμηση:
  // μετράμε μόνο τους συνδέσμους που είναι ολοφάνερα ανώνυμοι.
  const anonymousControls = (html.match(/<a\b[^>]*>\s*(?:<(?:img|svg|i|span)\b[^>]*>\s*)*<\/a>/gi) || [])
    .filter((snippet) => !/aria-label|title=|alt=["'][^"']+["']/i.test(snippet)).length;
  facts.controls.anonymous = anonymousControls;
  delete facts.controls._pendingA;

  delete facts.labelFor;
  delete facts.pendingInputs;
  delete facts.inHead;

  return facts;
}
