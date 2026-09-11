/*
 * contrast-probe.js — μέτρηση αντίθεσης κειμένου/φόντου (WCAG AA).
 *
 * Το τρέχει ο έλεγχος site (/elegxos/) ΜΕΣΑ στη σελίδα που ελέγχεται, μέσω
 * του Browser Rendering της Cloudflare. Φορτώνεται ως εξωτερικό script από
 * αυτή τη διεύθυνση και όχι inline, γιατί οι σελίδες με αυστηρό CSP (όπως η
 * δική μας: script-src 'self') μπλοκάρουν τα inline scripts.
 *
 * Είναι ES5 και τυλιγμένο σε try ώστε ένα σφάλμα να βγάλει {error} αντί να
 * αφήσει το αποτέλεσμα κενό. Γράφει JSON στο data-result ενός <div
 * id="a2l-contrast"> που το διαβάζει πίσω ο ελεγκτής (lib/checker/contrast.js).
 *
 * Πώς βρίσκει το φόντο: ΟΧΙ μόνο από τους γονείς. Ρωτάει τον browser τι
 * ζωγραφίζεται ακριβώς κάτω από το κέντρο του κειμένου (elementsFromPoint)
 * και συνθέτει τα χρώματα από πάνω προς τα κάτω μέχρι να βρει αδιαφανές.
 * Έτσι ένα λευκό κείμενο πάνω σε <img> ή σε ένα absolute «πανό» δεν μετριέται
 * λάθος ως «λευκό σε λευκό». Εικόνα, βίντεο ή gradient στη στοίβα σημαίνει
 * «δεν μετριέται» (unmeasured): δεν υπάρχει ένα χρώμα φόντου για σύγκριση.
 *
 * Ένα κείμενο μετράει «μεγάλο» (όριο 3:1 αντί 4.5:1) στα 24px, ή στα 18.66px
 * αν είναι bold — οι ορισμοί του WCAG για 18pt / 14pt bold.
 */
(function () {
  var out = document.createElement("div");
  out.id = "a2l-contrast";
  try {
    var MAX_NODES = 3000;
    var EXAMPLES = 5;
    var PAINTED = /^(img|video|canvas|svg|picture|iframe|object|embed)$/i;

    function parse(c) {
      var m = /rgba?\(([^)]+)\)/.exec(c || "");
      if (!m) return null;
      var a = m[1].split(",").map(parseFloat);
      return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 };
    }
    function chan(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function lum(c) { return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b); }
    function over(top, under) {
      var a = top.a;
      return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
    }
    function canvas() {
      var root = parse(getComputedStyle(document.documentElement).backgroundColor);
      return root && root.a >= 1 ? root : { r: 255, g: 255, b: 255, a: 1 };
    }
    // Συνθέτει μια λίστα στοιχείων (από πάνω προς τα κάτω) σε ένα χρώμα φόντου.
    // Επιστρέφει null αν κάτι στη διαδρομή δεν έχει «ένα» χρώμα.
    function compose(layers) {
      var acc = null;
      for (var i = 0; i < layers.length; i++) {
        var e = layers[i];
        if (PAINTED.test(e.tagName)) return null;
        var cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
        var c = parse(cs.backgroundColor);
        if (!c || c.a === 0) continue;
        var op = parseFloat(cs.opacity);
        if (op < 1) c = { r: c.r, g: c.g, b: c.b, a: c.a * op };
        acc = acc ? over(acc, c) : c;
        if (c.a >= 1) return acc;
      }
      return acc ? over(acc, canvas()) : canvas();
    }
    function ancestors(el) {
      var list = [], e = el;
      while (e && e !== document.documentElement) { list.push(e); e = e.parentElement; }
      return list;
    }
    function transparent(e) {
      if (PAINTED.test(e.tagName)) return false;
      var cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return false;
      var c = parse(cs.backgroundColor);
      return !c || c.a === 0;
    }
    // Τι ζωγραφίζεται κάτω από το σημείο (x,y), από πάνω προς τα κάτω.
    // Ξεκινά από το el (ή τον πρώτο πρόγονό του που βρίσκεται στη στοίβα του
    // browser) και ενώνει τη στοίβα με τους προγόνους που λείπουν από αυτήν
    // (pointer-events: none — π.χ. ένα fixed πανό που αφήνει τα κλικ να
    // περνούν αλλά ζωγραφίζει φόντο).
    // Επιστρέφει null όταν το κείμενο ΔΕΝ φαίνεται: το καλύπτει κάτι μη
    // διάφανο (π.χ. η ενεργή διαφάνεια ενός carousel), ή ένας μη
    // hit-testable πρόγονός του έχει opacity 0 (κρυμμένο πανό/slide).
    function layersUnder(el, x, y) {
      var stack = document.elementsFromPoint(x, y);
      var anc = ancestors(el);
      var j = -1, i;
      for (i = 0; i < stack.length; i++) {
        if (stack[i] === el || stack[i].contains(el)) { j = i; break; }
      }
      if (j === -1) return null;
      for (i = 0; i < j; i++) if (!transparent(stack[i])) return null;
      var layers = [], k = 0;
      for (i = j; i < stack.length; i++) {
        var s = stack[i];
        if (s === el || s.contains(el)) {
          while (k < anc.length) {
            var a = anc[k++];
            if (i === j && a !== s && parseFloat(getComputedStyle(a).opacity) === 0) return null;
            layers.push(a);
            if (a === s) break;
          }
        } else {
          layers.push(s);
        }
      }
      while (k < anc.length) layers.push(anc[k++]);
      return layers;
    }
    function label(el) {
      var s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      else if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/)[0];
      return s.slice(0, 60);
    }
    // Το κέντρο της πρώτης γραμμής του κειμένου, μέσα στο viewport. Κάνει scroll
    // αν χρειάζεται — το elementsFromPoint δουλεύει μόνο για ορατά σημεία.
    function pointOf(node) {
      var range = document.createRange();
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      if (!rects.length) return null;
      var r = rects[0];
      if (!r.width || !r.height) return null;
      var vh = window.innerHeight, vw = window.innerWidth;
      if (r.top < 0 || r.bottom > vh) {
        // Άμεσο scroll, όχι smooth: με scroll-behavior: smooth το scrollBy
        // κινείται σταδιακά και το rect που ξαναδιαβάζουμε είναι ακόμη το παλιό.
        window.scrollTo({ top: window.scrollY + r.top - vh / 2, left: 0, behavior: "instant" });
        r = range.getClientRects()[0];
        if (!r) return null;
      }
      var x = r.left + Math.min(r.width, 40) / 2, y = r.top + r.height / 2;
      if (x < 0 || x >= vw || y < 0 || y >= vh) return null;
      return { x: x, y: y };
    }

    // Ό,τι κινείται ακόμη (transition/animation, π.χ. cookie banner που
    // ξεθωριάζει από opacity 0 σε 1) πάει κατευθείαν στην τελική του κατάσταση.
    // Αλλιώς μετράμε ενδιάμεσα, μισοδιάφανα χρώματα που δεν βλέπει κανείς.
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) { try { a.finish(); } catch (e) { /* άπειρο animation */ } });
    }

    var measured = 0, unmeasured = 0, failing = 0, examples = [];
    var seen = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node, visited = 0;
    while ((node = walker.nextNode()) && visited < MAX_NODES) {
      visited++;
      var text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;
      var el = node.parentElement;
      if (!el || seen.indexOf(el) !== -1) continue;
      seen.push(el);
      // Το [role=img] είναι γραφικό με δικό του accessible name (π.χ. αστεράκια
      // αξιολόγησης): οι χαρακτήρες του δεν είναι κείμενο για τον κανόνα 1.4.3.
      if (el.closest("script,style,noscript,template,[hidden],[aria-hidden='true'],[role='img'],select,option")) continue;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      // Κείμενο με gradient γέμισμα (-webkit-text-fill-color: transparent).
      if (cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") { unmeasured++; continue; }
      var fg = parse(cs.color);
      if (!fg || fg.a === 0) continue;
      var pt = pointOf(node);
      if (!pt) continue;
      var layers = layersUnder(el, pt.x, pt.y);
      if (!layers) continue;
      var bg = compose(layers);
      if (!bg) { unmeasured++; continue; }
      var f = fg.a < 1 ? over(fg, bg) : fg;
      var l1 = lum(f), l2 = lum(bg);
      var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      var size = parseFloat(cs.fontSize);
      var bold = parseInt(cs.fontWeight, 10) >= 700;
      var need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      measured++;
      if (ratio < need) {
        failing++;
        if (examples.length < EXAMPLES) {
          examples.push({ t: text.slice(0, 40), s: label(el), r: Math.round(ratio * 100) / 100, n: need });
        }
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    out.setAttribute("data-result", JSON.stringify({ measured: measured, unmeasured: unmeasured, failing: failing, examples: examples, truncated: visited >= MAX_NODES }));
  } catch (error) {
    out.setAttribute("data-result", JSON.stringify({ error: String(error && error.message || error) }));
  }
  // Μέσα στο <body>, όχι στο <html>: ο scraper της Cloudflare ψάχνει τους
  // selectors μέσα στο body, οπότε στοιχείο κρεμασμένο δίπλα του δεν βρίσκεται.
  (document.body || document.documentElement).appendChild(out);
})();
