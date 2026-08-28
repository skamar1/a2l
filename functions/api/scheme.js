/** ΠΡΟΣΩΡΙΝΟ διαγνωστικό — αναπαράγει το probe του ελεγκτή από μέσα από Worker. */
async function look(target) {
  try {
    const r = await fetch(target, { redirect: "manual", headers: { "User-Agent": "a2l-diag" } });
    return {
      target,
      status: r.status,
      location: r.headers.get("location") || null,
      mw: r.headers.get("x-mw") || null,
      server: r.headers.get("server") || null,
    };
  } catch (e) {
    return { target, error: String(e).slice(0, 120) };
  }
}

export async function onRequestGet({ request }) {
  const self = new URL(request.url);
  const out = {
    incoming: { url: request.url, protocol: self.protocol },
    probes: await Promise.all([
      look(`http://${self.host}/`),
      look(`https://${self.host}/`),
      look("http://www.a2l.gr/"),
    ]),
  };
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
