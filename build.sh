#!/usr/bin/env bash
#
# Builds the a2l.gr Hugo site with the EXACT Hugo version pinned in
# .tool-versions — the single source of truth shared by local, CI and
# Cloudflare Pages. This guarantees dev/prod parity: the version can never
# drift between environments.
#
# Cloudflare Pages build command:  bash build.sh
# CI (strict):                     HUGO_EXTRA_FLAGS="--panicOnWarning" bash build.sh
#
set -euo pipefail

# --- read pinned version from the single source of truth ---------------------
HUGO_VERSION="$(awk '/^hugo[[:space:]]/ {print $2; exit}' .tool-versions)"
if [ -z "${HUGO_VERSION:-}" ]; then
  echo "ERROR: no 'hugo <version>' line found in .tool-versions" >&2
  exit 1
fi
HUGO_EXTRA_FLAGS="${HUGO_EXTRA_FLAGS:-}"
echo "==> Hugo ${HUGO_VERSION} (extended)"

OS="$(uname -s)"; ARCH="$(uname -m)"

if [ "${OS}" = "Darwin" ]; then
  # Το επίσημο release δίνει tarball μόνο για Linux και Windows· για macOS
  # υπάρχει ΜΟΝΟ .pkg (hugo_extended_<ver>_darwin-universal.pkg). Δηλαδή το
  # κατέβασμα binary εδώ είναι αδύνατο, όχι απλώς άβολο.
  #
  # Άρα σε macOS χρησιμοποιούμε το τοπικά εγκατεστημένο hugo — αλλά μόνο αν
  # είναι ακριβώς η καρφιτσωμένη έκδοση και extended. Αν δεν είναι, ο έλεγχος
  # σταματάει με σαφές μήνυμα: καλύτερα να μη χτίσει, παρά να χτίσει με άλλη
  # έκδοση από αυτήν που θα τρέξει στην παραγωγή.
  if ! command -v hugo >/dev/null 2>&1; then
    echo "ERROR: δεν βρέθηκε hugo στο PATH." >&2
    echo "       Σε macOS δεν κατεβάζουμε binary (δεν υπάρχει tarball)." >&2
    echo "       Εγκατάστησε: brew install hugo   (χρειάζεται ${HUGO_VERSION} extended)" >&2
    exit 1
  fi
  HUGO_BIN="$(command -v hugo)"
  INSTALLED="$("${HUGO_BIN}" version)"
  case "${INSTALLED}" in
    *"v${HUGO_VERSION}+extended"*) ;;
    *)
      echo "ERROR: λάθος έκδοση Hugo." >&2
      echo "       Απαιτείται: v${HUGO_VERSION}+extended  (από το .tool-versions)" >&2
      echo "       Βρέθηκε:    ${INSTALLED}" >&2
      exit 1
      ;;
  esac
  echo "==> Τοπικό Hugo: ${HUGO_BIN}"
else
  # --- resolve platform ------------------------------------------------------
  case "${OS}-${ARCH}" in
    Linux-x86_64|Linux-amd64)   PLAT="linux-amd64" ;;
    Linux-aarch64|Linux-arm64)  PLAT="linux-arm64" ;;
    *) echo "ERROR: unsupported platform ${OS}-${ARCH}" >&2; exit 1 ;;
  esac

  # --- download that exact extended build ------------------------------------
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  URL="https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${PLAT}.tar.gz"
  echo "==> Downloading ${URL}"
  curl -fsSL "${URL}" -o "${TMP}/hugo.tar.gz"
  tar -xzf "${TMP}/hugo.tar.gz" -C "${TMP}" hugo
  HUGO_BIN="${TMP}/hugo"
fi

"${HUGO_BIN}" version

# --- build -------------------------------------------------------------------
# shellcheck disable=SC2086
"${HUGO_BIN}" --gc --minify ${HUGO_EXTRA_FLAGS}
echo "==> Build complete -> public/"
