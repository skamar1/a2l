const SUBJECT_LABELS = {
  support:    "Τεχνική Υποστήριξη",
  demo:       "Αίτημα Demo",
  "a2crm":    "Πληροφορίες A2 CRM",
  soft1:      "Πληροφορίες EntersoftOne",
  "result-crm": "Πληροφορίες Dynasoft (Result CRM)",
  megasoft:   "Πληροφορίες Megasoft",
  plano:      "Πληροφορίες Qorrect (Plano ERP)",
  hardware:   "Προσφορά Υπολογιστών / Hardware",
  website:    "Κατασκευή Ιστοσελίδας",
  other:      "Άλλο",
};

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
  const name     = (formData.get("name")    || "").trim();
  const email    = (formData.get("email")   || "").trim();
  const company  = (formData.get("company") || "").trim();
  const phone    = (formData.get("phone")   || "").trim();
  const subjectKey = (formData.get("subject") || "other").trim();
  const message  = (formData.get("message") || "").trim();

  // Basic validation
  if (!name || !email || !message) {
    return json({ error: "Συμπληρώστε τα υποχρεωτικά πεδία." }, 400);
  }

  // Verify Turnstile
  const ip = request.headers.get("CF-Connecting-IP") || "";
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

  // Build email body
  const subjectLabel = SUBJECT_LABELS[subjectKey] || subjectKey;
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
