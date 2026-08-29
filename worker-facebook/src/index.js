/**
 * Αυτόματη κοινοποίηση νέων άρθρων του a2l.gr στη σελίδα A2 Labs στο Facebook.
 *
 * Η λογική είναι σκόπιμα βαρετή: διάβασε το feed, βρες τι δεν έχει ποσταριστεί,
 * πόσταρε ΕΝΑ πράγμα, γράψ' το στο KV. Ό,τι πάει στραβά καταλήγει σε email —
 * δεν υπάρχει περίπτωση να αποτύχει σιωπηλά και να το μάθουμε σε τρεις μήνες.
 */

const FEED = "https://a2l.gr/odigies-nea/index.xml";
const PAGE_ID = "109949147408092";
const API = "https://graph.facebook.com/v26.0";

// Το cron της Cloudflare είναι πάντα σε UTC, οπότε μια σταθερή ώρα UTC θα
// μετακινούνταν μία ώρα με τη θερινή ώρα. Χτυπάει λοιπόν και στις 07:00 και
// στις 08:00 UTC, και εδώ περνάει μόνο το χτύπημα που είναι 10:00 στην Αθήνα.
const TZ = "Europe/Athens";
const POST_HOUR = 10;

// Το γενικό banner του site. Όταν το άρθρο δεν έχει δική του εικόνα, το
// og:image πέφτει σε αυτό — και μια ανάρτηση-φωτογραφία με το λογότυπο δεν
// λέει τίποτα. Σε αυτή την περίπτωση βγαίνει κανονικό link post.
const DEFAULT_OG = "https://a2l.gr/images/og-image.png";

export default {
  async scheduled(event, env, ctx) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ,
        hour: "numeric",
        hour12: false,
      }).format(new Date(event.scheduledTime)),
    );
    if (hour !== POST_HOUR) {
      console.log(`Παράλειψη: ${hour}:00 Αθήνα, περιμένουμε ${POST_HOUR}:00`);
      return;
    }
    ctx.waitUntil(runGuarded(env, { dry: false }));
  },

  /**
   * Χειροκίνητη εκτέλεση και δοκιμή. Χωρίς το σωστό κλειδί δεν απαντάει καν
   * ότι υπάρχει — ο Worker έχει δημόσιο workers.dev URL.
   *   curl -H "X-Trigger-Key: ..." https://<worker>/run?dry=1
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = request.headers.get("X-Trigger-Key") || "";
    if (!env.TRIGGER_KEY || !timingSafeEqual(key, env.TRIGGER_KEY)) {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }
    const dry = url.searchParams.get("dry") === "1";
    const result = await runGuarded(env, { dry });
    return Response.json(result, {
      status: result.ok === false ? 500 : 200,
    });
  },
};

/** Τρέχει τη δουλειά και μετατρέπει κάθε σφάλμα σε email. */
async function runGuarded(env, opts) {
  try {
    const result = await run(env, opts);
    console.log(JSON.stringify(result));
    return { ok: true, ...result };
  } catch (err) {
    const message = err && err.stack ? err.stack : String(err);
    console.error(message);
    await alert(env, "Απέτυχε η ανάρτηση στο Facebook", message);
    return { ok: false, error: String(err) };
  }
}

async function run(env, { dry }) {
  requireBindings(env);

  const items = await readFeed();
  if (items.length === 0) throw new Error("Το feed γύρισε άδειο");

  // Πρώτη εκτέλεση: το KV είναι άδειο, άρα ΟΛΑ τα παλιά άρθρα μοιάζουν νέα.
  // Χωρίς αυτό ο Worker θα έριχνε έξι αναρτήσεις μονομιάς στη σελίδα.
  const seeded = await env.POSTED.get("meta:seeded");
  if (!seeded) {
    if (dry) return { action: "seed", would_mark: items.length };
    for (const item of items) {
      await env.POSTED.put(key(item.link), JSON.stringify({ seeded: true }));
    }
    await env.POSTED.put("meta:seeded", new Date().toISOString());
    return { action: "seed", marked: items.length };
  }

  const pending = [];
  for (const item of items) {
    if (!(await env.POSTED.get(key(item.link)))) pending.push(item);
  }
  if (pending.length === 0) return { action: "none", reason: "τίποτα νέο" };

  // Ένα ανά εκτέλεση. Αν γράψουμε τρία άρθρα σε μια βδομάδα, βγαίνουν σε
  // τρεις εβδομάδες — καλύτερα από τρεις αναρτήσεις στο ίδιο λεπτό.
  pending.sort((a, b) => b.date - a.date);
  const item = pending[0];

  const meta = await readPageMeta(item.link);
  const message = compose(item.title, meta.description, item.link);

  if (dry) {
    return {
      action: "dry",
      link: item.link,
      image: meta.image,
      as: meta.image && meta.image !== DEFAULT_OG ? "photo" : "link",
      message,
      queued: pending.length,
    };
  }

  const token = await pageToken(env);
  const post =
    meta.image && meta.image !== DEFAULT_OG
      ? await postPhoto(token, meta.image, message)
      : await postLink(token, item.link, message);

  // Το KV γράφεται ΜΕΤΑ την επιτυχία, αλλιώς ένα αποτυχημένο post θα έμενε
  // σημειωμένο ως δημοσιευμένο και το άρθρο δεν θα έβγαινε ποτέ. Αν αποτύχει
  // το γράψιμο, φεύγει email: αλλιώς την επόμενη φορά ξαναβγαίνει το ίδιο.
  try {
    await env.POSTED.put(
      key(item.link),
      JSON.stringify({ post_id: post.id, at: new Date().toISOString() }),
    );
  } catch (err) {
    await alert(
      env,
      "Η ανάρτηση βγήκε αλλά δεν καταγράφηκε",
      `Το ${item.link} δημοσιεύτηκε (${post.id}) αλλά το KV δεν ενημερώθηκε.\n` +
        `Αν δεν γραφτεί με το χέρι, θα ξαναδημοσιευτεί.\n\n${err}`,
    );
  }

  return { action: "posted", link: item.link, post_id: post.id, as: post.as };
}

function requireBindings(env) {
  const missing = ["POSTED", "FB_SYSTEM_TOKEN"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Λείπουν bindings: ${missing.join(", ")}`);
}

const key = (link) => `posted:${link}`;

/** Το RSS του Hugo είναι σταθερό και προβλέψιμο· δεν χρειάζεται parser. */
async function readFeed() {
  const res = await fetch(FEED, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`Το feed απάντησε ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const link = pick(block, "link");
    const title = pick(block, "title");
    const pub = pick(block, "pubDate");
    if (!link || !title) continue;
    items.push({ link, title, date: pub ? new Date(pub).getTime() || 0 : 0 });
  }
  return items;
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim()) : "";
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Διαβάζει og:image και og:description από τη σελίδα του άρθρου. */
async function readPageMeta(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Η σελίδα ${url} απάντησε ${res.status}`);

  const meta = { image: "", description: "" };
  await new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element: (el) => (meta.image = el.getAttribute("content") || ""),
    })
    .on('meta[property="og:description"]', {
      element: (el) => (meta.description = el.getAttribute("content") || ""),
    })
    .transform(res)
    .arrayBuffer();

  return meta;
}

function compose(title, description, link) {
  const parts = [title];
  if (description) parts.push(description);
  parts.push(link);
  return parts.join("\n\n");
}

/**
 * Το token του χρήστη συστήματος δεν λήγει ποτέ, οπότε ούτε το token της
 * σελίδας που παράγει λήγει. Το ζητάμε κάθε φορά αντί να το αποθηκεύσουμε:
 * ένα μυστικό λιγότερο, και ακολουθεί μόνο του τυχόν αλλαγή δικαιωμάτων.
 */
async function pageToken(env) {
  const res = await fetch(`${API}/${PAGE_ID}?fields=access_token`, {
    headers: { Authorization: `Bearer ${env.FB_SYSTEM_TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Δεν πάρθηκε page token: ${describe(data)}`);
  }
  return data.access_token;
}

async function postPhoto(token, image, message) {
  const body = new URLSearchParams({ url: image, message, published: "true" });
  const data = await graph(`${API}/${PAGE_ID}/photos`, token, body);
  return { id: data.post_id || data.id, as: "photo" };
}

async function postLink(token, link, message) {
  const body = new URLSearchParams({ link, message });
  const data = await graph(`${API}/${PAGE_ID}/feed`, token, body);
  return { id: data.id, as: "link" };
}

async function graph(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Graph API: ${describe(data)}`);
  return data;
}

function describe(data) {
  if (data && data.error) {
    const e = data.error;
    return `${e.code}/${e.error_subcode || "-"} ${e.message}`;
  }
  return JSON.stringify(data);
}

/**
 * Ειδοποίηση με το ίδιο SMTP2GO που χρησιμοποιεί η φόρμα επικοινωνίας.
 * Αν λείπει το κλειδί, το σφάλμα μένει τουλάχιστον στα logs — δεν ρίχνουμε
 * τον Worker επειδή απέτυχε η ειδοποίηση για μια αποτυχία.
 */
async function alert(env, subject, text) {
  if (!env.SMTP2GO_API_KEY) {
    console.error("Χωρίς SMTP2GO_API_KEY — η ειδοποίηση δεν στάλθηκε");
    return;
  }
  try {
    await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.SMTP2GO_API_KEY,
        to: ["info@a2l.gr"],
        sender: "A2Labs Facebook Poster <noreply@a2l.gr>",
        subject: `[a2l.gr] ${subject}`,
        text_body: text,
      }),
    });
  } catch (err) {
    console.error("Απέτυχε και η ειδοποίηση:", String(err));
  }
}

/** Σύγκριση σταθερού χρόνου, ώστε το κλειδί να μη βρίσκεται με μαντεψιές. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
