#!/usr/bin/env bash
#
# Κατεβάζει το ggml-tiny — το μοντέλο που κρίνει ΜΟΝΟ τη γλώσσα. Δεν παράγει
# ποτέ κείμενο, οπότε δεν χρειάζεται κάτι μεγαλύτερο: η διάκριση ελληνικών
# από αγγλικά είναι ασύγκριτα ευκολότερη από την απομαγνητοφώνηση.
#
# Το ίδιο κάνει και το κουμπί «Λήψη μοντέλου» στις Ρυθμίσεις της εφαρμογής.
#
set -euo pipefail

MODEL="${MODEL:-tiny}"
DEST_DIR="${HOME}/Library/Application Support/Glossa"
DEST="${DEST_DIR}/ggml-${MODEL}.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

if [ -f "${DEST}" ]; then
  echo "==> Υπάρχει ήδη: ${DEST}"
  echo "    Για εκ νέου λήψη, σβήσ' το πρώτα."
  exit 0
fi

mkdir -p "${DEST_DIR}"
echo "==> Λήψη ${URL}"
# Σε προσωρινό αρχείο: μια διακοπή στη μέση δεν πρέπει να αφήσει μισό μοντέλο
# που θα φαινόταν έγκυρο και θα έριχνε τον βοηθό σε κάθε εκκίνηση.
curl -fL --progress-bar "${URL}" -o "${DEST}.partial"
mv "${DEST}.partial" "${DEST}"
echo "==> Έτοιμο: ${DEST}"
