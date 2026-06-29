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

# --- resolve platform --------------------------------------------------------
OS="$(uname -s)"; ARCH="$(uname -m)"
case "${OS}-${ARCH}" in
  Linux-x86_64|Linux-amd64)   PLAT="linux-amd64" ;;
  Linux-aarch64|Linux-arm64)  PLAT="linux-arm64" ;;
  Darwin-arm64|Darwin-x86_64) PLAT="darwin-universal" ;;
  *) echo "ERROR: unsupported platform ${OS}-${ARCH}" >&2; exit 1 ;;
esac

# --- download that exact extended build --------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
URL="https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${PLAT}.tar.gz"
echo "==> Downloading ${URL}"
curl -fsSL "${URL}" -o "${TMP}/hugo.tar.gz"
tar -xzf "${TMP}/hugo.tar.gz" -C "${TMP}" hugo
HUGO_BIN="${TMP}/hugo"
"${HUGO_BIN}" version

# --- build -------------------------------------------------------------------
# shellcheck disable=SC2086
"${HUGO_BIN}" --gc --minify ${HUGO_EXTRA_FLAGS}
echo "==> Build complete -> public/"
