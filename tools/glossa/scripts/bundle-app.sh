#!/usr/bin/env bash
#
# Συναρμολογεί το Glossa.app. Το SwiftPM βγάζει σκέτο εκτελέσιμο· το macOS
# όμως δίνει άδειες μικροφώνου και προσβασιμότητας μόνο σε υπογεγραμμένο
# bundle με Info.plist, οπότε το πακετάρισμα δεν είναι καλλωπισμός.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT}/dist"
APP="${DIST}/Glossa.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: το Glossa χτίζεται σε macOS." >&2
  exit 1
fi

echo "==> Build (release)"
swift build -c release --package-path "${ROOT}"
BINARY="$(swift build -c release --package-path "${ROOT}" --show-bin-path)/Glossa"
[ -x "${BINARY}" ] || { echo "ERROR: δεν βρέθηκε το εκτελέσιμο ${BINARY}" >&2; exit 1; }

echo "==> Συναρμολόγηση bundle"
rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp "${BINARY}" "${APP}/Contents/MacOS/Glossa"
cp "${ROOT}/Resources/Info.plist" "${APP}/Contents/Info.plist"

# Ο βοηθός αναγνώρισης γλώσσας ταξιδεύει μέσα στο bundle, ώστε η εφαρμογή να
# τον βρίσκει με Bundle.main.url(forAuxiliaryExecutable:).
if [ -x "${DIST}/glossa-lid" ]; then
  cp "${DIST}/glossa-lid" "${APP}/Contents/MacOS/glossa-lid"
else
  echo "ΠΡΟΣΟΧΗ: δεν βρέθηκε το ${DIST}/glossa-lid."
  echo "         Η εφαρμογή θα δουλέψει, αλλά χωρίς αυτόματη αναγνώριση"
  echo "         γλώσσας. Τρέξε πρώτα:  make lid"
fi

# --- υπογραφή ----------------------------------------------------------------
# Χωρίς δικό σου πιστοποιητικό, το ad-hoc "-" αρκεί για να τρέξει η εφαρμογή
# τοπικά. Το μειονέκτημα: η υπογραφή αλλάζει σε κάθε build, οπότε το macOS
# μπορεί να ξαναζητήσει την άδεια Προσβασιμότητας. Με σταθερή ταυτότητα:
#     CODESIGN_IDENTITY="Developer ID Application: ..." make app
IDENTITY="${CODESIGN_IDENTITY:--}"
echo "==> Υπογραφή (${IDENTITY})"
if [ -f "${APP}/Contents/MacOS/glossa-lid" ]; then
  codesign --force --sign "${IDENTITY}" "${APP}/Contents/MacOS/glossa-lid"
fi
codesign --force --sign "${IDENTITY}" "${APP}"

echo "==> Έτοιμο: ${APP}"
echo "    Εγκατάσταση:  cp -R \"${APP}\" /Applications/"
