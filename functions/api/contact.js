import { isLocalRequest } from "../../lib/local.js";

const SUBJECT_LABELS = {
  support:    "Τεχνική Υποστήριξη",
  demo:       "Αίτημα Demo",
  "a2crm":    "Πληροφορίες A2 CRM",
  soft1:      "Πληροφορίες SoftOne ERP",
  entersoftone: "Πληροφορίες EntersoftOne",
  "result-crm": "Πληροφορίες Dynasoft (Result CRM)",
  megasoft:   "Πληροφορίες Megasoft",
  plano:      "Πληροφορίες Qorrect (Plano ERP)",
  hardware:   "Προσφορά Υπολογιστών / Hardware",
  website:    "Κατασκευή Ιστοσελίδας",
  other:      "Άλλο",
};

/**
 * Όρια μήκους. Δεν είναι θέμα βάσης δεδομένων — δεν αποθηκεύουμε τίποτα — αλλά
 * του παραλήπτη: ένα μήνυμα 2 MB δεν είναι ερώτηση πελάτη, είναι κατάχρηση.
 */
const LIMITS = { name: 100, email: 254, company: 120, phone: 40, message: 5000 };

// Σκόπιμα ανεκτικό: η σοβαρή επαλήθευση ενός email είναι να σταλεί μήνυμα σε
// αυτό. Εδώ κόβουμε μόνο ό,τι είναι προφανώς άκυρο, ώστε το reply_to να μη
// γεμίσει σκουπίδια. Το 254 είναι το όριο του RFC 5321.
const EMAIL_RE = /^[^\s@,;:<>"]+@[^\s@,;:<>"]+\.[^\s@,;:<>".]{2,}$/;

/**
 * Το `name` καταλήγει μέσα στο Subject του email. Ένας χαρακτήρας νέας γραμμής
 * εκεί είναι κλασική απόπειρα header injection — και ακόμα κι όταν η βιβλιοθήκη
 * τον καθαρίζει, ένα Subject σε τρεις γραμμές είναι σπασμένο. Φεύγουν όλοι οι
 * χαρακτήρες ελέγχου από τα μονόγραμμα πεδία.
 */
const oneLine = (value) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

// Στο μήνυμα οι αλλαγές γραμμής είναι το περιεχόμενο· κρατιούνται.
const multiLine = (value) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

export async function onRequestPost(context) {
  const { request, env } = context;

  // Parse form body
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }

  const token    = formData.get("cf-turnstile-response") || "";
  const name     = oneLine(formData.get("name"));
  const email    = oneLine(formData.get("email"));
  const company  = oneLine(formData.get("company"));
  const phone    = oneLine(formData.get("phone"));
  const message  = multiLine(formData.get("message"));

  // Το θέμα μπαίνει στο Subject, οπότε δεν δεχόμαστε ελεύθερο κείμενο: ό,τι δεν
  // είναι γνωστό κλειδί γίνεται «Άλλο». Το πεδίο έρχεται από <select> — αν φτάσει
  // κάτι άλλο, δεν ήρθε από τη φόρμα μας.
  const rawSubject = oneLine(formData.get("subject"));
  const subjectKey = Object.hasOwn(SUBJECT_LABELS, rawSubject) ? rawSubject : "other";

  // Basic validation
  if (!name || !email || !message) {
    return json({ error: "Συμπληρώστε τα υποχρεωτικά πεδία." }, 400);
  }

  const tooLong = Object.entries(LIMITS).find(
    ([field, max]) => ({ name, email, company, phone, message })[field].length > max
  );
  if (tooLong) {
    return json(
      { error: `Το πεδίο υπερβαίνει τους ${tooLong[1]} χαρακτήρες.` },
      400
    );
  }

  if (!EMAIL_RE.test(email)) {
    return json({ error: "Ελέγξτε τη διεύθυνση email." }, 400);
  }

  // Verify Turnstile — τοπικά παρακάμπτεται (βλ. lib/local.js)
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!isLocalRequest(request)) {
    const verify = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: ip,
        }),
      }
    );
    const verifyData = await verify.json();

    if (!verifyData.success) {
      return json({ error: "Η επαλήθευση Turnstile απέτυχε. Δοκιμάστε ξανά." }, 400);
    }
  }

  // Build email body
  const subjectLabel = SUBJECT_LABELS[subjectKey];
  const emailSubject = `[a2l.gr] ${subjectLabel} — ${name}`;
  const emailText = [
    `Όνομα:     ${name}`,
    `Email:     ${email}`,
    `Εταιρεία:  ${company || "—"}`,
    `Τηλέφωνο:  ${phone   || "—"}`,
    `Θέμα:      ${subjectLabel}`,
    "",
    "Μήνυμα:",
    message,
  ].join("\n");

  // Send via SMTP2GO
  const smtp = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:   env.SMTP2GO_API_KEY,
      to:        [`info@a2l.gr`],
      sender:    "A2Labs Website <noreply@a2l.gr>",
      reply_to:  [email],
      subject:   emailSubject,
      text_body: emailText,
    }),
  });

  if (!smtp.ok) {
    const err = await smtp.text();
    console.error("SMTP2GO error:", err);
    return json({ error: "Σφάλμα αποστολής email. Παρακαλώ επικοινωνήστε τηλεφωνικά." }, 500);
  }

  const smtpData = await smtp.json();
  if (smtpData.data?.error) {
    console.error("SMTP2GO error:", smtpData.data.error);
    return json({ error: "Σφάλμα αποστολής email. Παρακαλώ επικοινωνήστε τηλεφωνικά." }, 500);
  }

  return json({ success: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
