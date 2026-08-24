/**
 * site-check.js — η διεπαφή του δωρεάν ελέγχου.
 *
 * Ένα αρχείο, καμία εξάρτηση, κανένα inline script (βλ. partials/script.html):
 * το CSP του site είναι `script-src 'self'` χωρίς 'unsafe-inline'.
 */
(function () {
  "use strict";

  var form = document.getElementById("checkForm");
  if (!form) return;

  var input = document.getElementById("checkUrl");
  var submit = document.getElementById("checkSubmit");
  var errorBox = document.getElementById("checkError");
  var progress = document.getElementById("checkProgress");
  var resultBox = document.getElementById("checkResult");

  var STATE_LABELS = {
    pass: "Περνάει",
    partial: "Μερικώς",
    fail: "Αποτυγχάνει",
    na: "Δεν ελέγχθηκε",
  };

  // ── Εμφάνιση αποτελέσματος ────────────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // textContent παντού: το «measured» περιέχει τιμές από ξένο site και δεν
    // πρέπει ποτέ να ερμηνευτεί ως HTML.
    if (text != null) node.textContent = text;
    return node;
  }

  function renderScore(report) {
    var wrap = el("div", "score");
    var ring = el("div", "score__ring score__ring--" + (report.grade ? report.grade.id : "na"));
    ring.appendChild(el("span", "score__number", report.total == null ? "—" : String(report.total)));
    ring.appendChild(el("span", "score__max", "/100"));
    wrap.appendChild(ring);

    var meta = el("div", "score__meta");
    meta.appendChild(el("h2", "score__grade", report.grade ? report.grade.label : "Χωρίς βαθμό"));
    meta.appendChild(el("p", "score__summary", report.grade ? report.grade.summary : ""));

    var host = el("p", "score__target");
    var link = el("a", null, hostOf(report.finalUrl || report.url));
    link.href = report.finalUrl || report.url;
    link.rel = "nofollow noopener";
    link.target = "_blank";
    host.appendChild(link);
    host.appendChild(document.createTextNode(" · " + formatDate(report.checkedAt)));
    meta.appendChild(host);

    var counts = el("p", "score__counts");
    counts.textContent =
      report.counts.pass + " περνούν · " +
      report.counts.partial + " μερικώς · " +
      report.counts.fail + " αποτυγχάνουν" +
      (report.counts.na ? " · " + report.counts.na + " εκτός βαθμολογίας" : "");
    meta.appendChild(counts);

    wrap.appendChild(meta);
    return wrap;
  }

  function renderPriorities(report) {
    if (!report.priorities.length) return null;
    var section = el("section", "priorities");
    section.appendChild(el("h2", null, "Τι να διορθώσετε πρώτα"));
    section.appendChild(
      el("p", "priorities__intro", "Με τη σειρά που κοστίζει περισσότερους βαθμούς. Ο αριθμός δεξιά είναι πόσους βαθμούς κερδίζετε αν διορθωθεί.")
    );

    var list = el("ol", "priorities__list");
    report.priorities.slice(0, 5).forEach(function (item) {
      var li = el("li", "priorities__item priorities__item--" + item.state);
      var head = el("div", "priorities__head");
      head.appendChild(el("span", "priorities__title", item.title));
      head.appendChild(el("span", "priorities__impact", "+" + item.impact.toFixed(1)));
      li.appendChild(head);
      li.appendChild(el("p", "priorities__measured", item.measured));
      li.appendChild(el("p", "priorities__fix", item.fix));
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function renderCategory(category) {
    var details = el("details", "cat");
    // Ανοιχτές από την αρχή όσες έχουν πρόβλημα — εκεί κοιτάει ο χρήστης.
    if (category.score !== null && category.score < 100) details.open = true;

    var summary = el("summary", "cat__summary");
    summary.appendChild(el("span", "cat__name", category.label));
    summary.appendChild(el("span", "cat__weight", category.weight + "%"));
    summary.appendChild(
      el("span", "cat__score", category.score === null ? "—" : category.score + "/100")
    );

    var bar = el("span", "cat__bar");
    var fill = el("span", "cat__bar-fill");
    fill.style.width = (category.score === null ? 0 : category.score) + "%";
    bar.appendChild(fill);
    summary.appendChild(bar);
    details.appendChild(summary);

    var list = el("div", "rules");
    category.rules.forEach(function (rule) {
      var row = el("div", "rule rule--" + rule.state);
      var head = el("div", "rule__head");
      head.appendChild(el("span", "rule__state", STATE_LABELS[rule.state]));
      head.appendChild(el("span", "rule__title", rule.title));
      head.appendChild(el("span", "rule__id", rule.id));
      row.appendChild(head);

      row.appendChild(el("p", "rule__measured", rule.measured));
      if (rule.note) row.appendChild(el("p", "rule__note", rule.note));

      if (rule.state !== "pass" && rule.state !== "na") {
        row.appendChild(el("p", "rule__meaning", rule.meaning));
        var fix = el("p", "rule__fix");
        fix.appendChild(el("strong", null, "Διόρθωση: "));
        fix.appendChild(document.createTextNode(rule.fix));
        row.appendChild(fix);
      }
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  function renderPermalink(report) {
    if (!report.permalink) return null;
    var box = el("p", "permalink");
    box.appendChild(document.createTextNode("Μόνιμος σύνδεσμος: "));
    var link = el("a", null, location.origin + report.permalink);
    link.href = report.permalink;
    box.appendChild(link);
    box.appendChild(el("span", "permalink__note", " (διατηρείται 90 ημέρες)"));
    return box;
  }

  function render(report) {
    resultBox.textContent = "";
    resultBox.appendChild(renderScore(report));

    var priorities = renderPriorities(report);
    if (priorities) resultBox.appendChild(priorities);

    var cats = el("section", "cats");
    cats.appendChild(el("h2", null, "Αναλυτικά"));
    report.categories.forEach(function (category) {
      cats.appendChild(renderCategory(category));
    });
    resultBox.appendChild(cats);

    var permalink = renderPermalink(report);
    if (permalink) resultBox.appendChild(permalink);

    var cta = el("div", "check-cta");
    cta.appendChild(el("h2", null, "Θέλετε να τα διορθώσουμε εμείς;"));
    cta.appendChild(
      el("p", null, "Στείλτε μας το αποτέλεσμα και σας λέμε τι κοστίζει και πόσο θα πάρει — χωρίς χρέωση για την εκτίμηση.")
    );
    var ctaLink = el("a", "btn btn--primary", "Επικοινωνία →");
    ctaLink.href = "/epikoinonia/";
    cta.appendChild(ctaLink);
    resultBox.appendChild(cta);

    resultBox.style.display = "";
  }

  // ── Βοηθητικά ─────────────────────────────────────────────────────────────

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return url;
    }
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString("el-GR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "";
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.textContent = busy ? "Ελέγχουμε…" : "Έλεγχος →";
    progress.style.display = busy ? "" : "none";
  }

  // ── Υποβολή ───────────────────────────────────────────────────────────────

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    errorBox.style.display = "none";
    resultBox.style.display = "none";

    var url = input.value.trim();
    if (!url) {
      showError("Δώστε τη διεύθυνση της ιστοσελίδας.");
      input.focus();
      return;
    }

    var tokenField = form.querySelector('[name="cf-turnstile-response"]');
    var token = tokenField ? tokenField.value : "";

    setBusy(true);

    fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, token: token }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          showError(result.data.error || "Ο έλεγχος δεν ολοκληρώθηκε.");
          // Το Turnstile token είναι μιας χρήσης — χωρίς reset η δεύτερη
          // προσπάθεια θα αποτύγχανε στην επαλήθευση, όχι στον έλεγχο.
          if (window.turnstile) window.turnstile.reset();
          return;
        }
        render(result.data);
        if (result.data.permalink) {
          history.replaceState(null, "", result.data.permalink);
        }
        if (window.turnstile) window.turnstile.reset();
        resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function () {
        showError("Δεν ήταν δυνατή η σύνδεση. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.");
        if (window.turnstile) window.turnstile.reset();
      })
      .then(function () {
        setBusy(false);
      });
  });

  // ── Μόνιμος σύνδεσμος ─────────────────────────────────────────────────────
  // Η function /elegxos/r/<id> εμβολιάζει το αποθηκευμένο αποτέλεσμα εδώ.

  var stored = document.getElementById("a2-result");
  if (stored) {
    try {
      var report = JSON.parse(stored.textContent);
      if (report.url) input.value = report.url;
      render(report);
    } catch (e) {
      showError("Το αποθηκευμένο αποτέλεσμα δεν μπόρεσε να διαβαστεί.");
    }
  }
})();
