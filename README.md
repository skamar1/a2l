# A2Labs — a2l.gr

Εταιρικό site της **A2Labs**, κατασκευασμένο με [Hugo](https://gohugo.io/) και custom theme. Αντικατέστησε WordPress με στατικό site για μέγιστη ταχύτητα και ασφάλεια.

## Stack

| Τεχνολογία | Χρήση |
|---|---|
| [Hugo](https://gohugo.io/) v0.145.0 | Static site generator |
| Custom theme | Σχεδιασμός από το μηδέν (no Tailwind, no framework) |
| CSS custom properties | Design system (dark/tech aesthetic) |
| Inter (Google Fonts) | Typography με πλήρη Greek Unicode support |
| Cloudflare Pages | Hosting & CDN |

## Τοπική εκτέλεση

```bash
# Προαπαιτούμενο: Hugo extended v0.145.0+
hugo server
```

Ανοίξτε [http://localhost:1313](http://localhost:1313).

## Build

```bash
hugo --minify
```

Το αποτέλεσμα βγαίνει στον φάκελο `public/`.

## Δομή

```
content/          # Σελίδες σε Markdown
layouts/          # Hugo templates
assets/           # CSS, JS (processed by Hugo pipeline)
static/           # Εικόνες, favicon, fonts
data/             # Δεδομένα YAML/JSON
```

## Σελίδες

- **Αρχική** — Hero, services, CTA
- **Προγράμματα** — A2 CRM, EntersoftOne, Dynasoft, Megasoft, Qorrect
- **Υπολογιστές** — Hardware
- **Σχετικά** — Εταιρικό προφίλ
- **Νέα & Οδηγίες** — Blog
- **Επικοινωνία** — Φόρμα επικοινωνίας

## Deploy

Αυτόματο deploy μέσω **Cloudflare Pages** σε κάθε push στο `master` branch.

---

**A2Labs** · [a2l.gr](https://a2l.gr) · info@a2l.gr · 210 224 1787
