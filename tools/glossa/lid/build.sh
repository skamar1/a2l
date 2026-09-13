#!/usr/bin/env bash
#
# Χτίζει τον βοηθό glossa-lid: κατεβάζει το whisper.cpp σε καρφιτσωμένη
# έκδοση, το χτίζει σαν στατικές βιβλιοθήκες και τις ενώνει με το
# glossa-lid.c. Το αποτέλεσμα είναι ΕΝΑ αυτόνομο εκτελέσιμο στο dist/.
#
# Δεν χρειάζεται Xcode — μόνο τα Command Line Tools και cmake:
#     xcode-select --install
#     brew install cmake
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Καρφιτσωμένη έκδοση: το build πρέπει να βγάζει το ίδιο αποτέλεσμα σήμερα
# και σε έναν χρόνο. Αναβάθμιση = συνειδητή αλλαγή αυτής της γραμμής.
WHISPER_TAG="${WHISPER_TAG:-v1.9.4}"
WHISPER_REPO="${WHISPER_REPO:-https://github.com/ggml-org/whisper.cpp.git}"

# Από προεπιλογή χτίζουμε για την αρχιτεκτονική του μηχανήματος. Για ένα
# universal binary (Apple Silicon + Intel):  GLOSSA_ARCHS="arm64;x86_64"
GLOSSA_ARCHS="${GLOSSA_ARCHS:-$(uname -m)}"

VENDOR="${ROOT}/vendor/whisper.cpp"
BUILD="${ROOT}/vendor/build"
DIST="${ROOT}/dist"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: το glossa-lid χτίζεται σε macOS." >&2
  exit 1
fi
command -v cmake >/dev/null 2>&1 || { echo "ERROR: λείπει το cmake — brew install cmake" >&2; exit 1; }

# --- 1. πηγαίος κώδικας whisper.cpp στην καρφιτσωμένη έκδοση ----------------
if [ ! -d "${VENDOR}/.git" ]; then
  echo "==> Λήψη whisper.cpp ${WHISPER_TAG}"
  rm -rf "${VENDOR}"
  mkdir -p "$(dirname "${VENDOR}")"
  git clone --depth 1 --branch "${WHISPER_TAG}" "${WHISPER_REPO}" "${VENDOR}"
else
  CURRENT="$(git -C "${VENDOR}" describe --tags --exact-match 2>/dev/null || echo "")"
  if [ "${CURRENT}" != "${WHISPER_TAG}" ]; then
    echo "==> Αλλαγή έκδοσης whisper.cpp: ${CURRENT:-άγνωστη} -> ${WHISPER_TAG}"
    git -C "${VENDOR}" fetch --depth 1 origin "refs/tags/${WHISPER_TAG}:refs/tags/${WHISPER_TAG}"
    git -C "${VENDOR}" checkout --force "${WHISPER_TAG}"
    rm -rf "${BUILD}"
  fi
fi

# --- 2. στατικές βιβλιοθήκες -------------------------------------------------
# Χωρίς Metal: το tiny μοντέλο κρίνει μόνο τη γλώσσα πάνω σε 30" ήχου, κάτι
# που η CPU το κάνει σε δεκάδες ms. Το Metal θα πρόσθετε shaders και χρόνο
# εκκίνησης χωρίς κανένα κέρδος εδώ.
echo "==> Build whisper.cpp (${GLOSSA_ARCHS})"
cmake -S "${VENDOR}" -B "${BUILD}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="${GLOSSA_ARCHS}" \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  -DGGML_METAL=OFF \
  -DGGML_OPENMP=OFF \
  >/dev/null
cmake --build "${BUILD}" --config Release -j "$(sysctl -n hw.ncpu)"

# Οι στατικές βιβλιοθήκες σκορπίζονται σε υποφακέλους του build και το
# ακριβές σύνολό τους αλλάζει ανά έκδοση (ggml-blas, ggml-cpu, ...). Αντί να
# μαντεύουμε ονόματα, τις μαζεύουμε όλες.
LIBS=()
while IFS= read -r lib; do LIBS+=("-Wl,-force_load,${lib}"); done \
  < <(find "${BUILD}" -name '*.a' -type f | sort)

if [ "${#LIBS[@]}" -eq 0 ]; then
  echo "ERROR: δεν βρέθηκε καμία στατική βιβλιοθήκη στο ${BUILD}" >&2
  exit 1
fi
echo "==> Βρέθηκαν ${#LIBS[@]} στατικές βιβλιοθήκες"

# --- 3. το εκτελέσιμο --------------------------------------------------------
# -force_load σε κάθε .a: οι βιβλιοθήκες του ggml έχουν κυκλικές εξαρτήσεις
# μεταξύ τους, οπότε η σειρά στη γραμμή εντολών δεν αρκεί.
ARCH_FLAGS=()
IFS=';' read -ra ARCH_LIST <<< "${GLOSSA_ARCHS}"
for a in "${ARCH_LIST[@]}"; do ARCH_FLAGS+=(-arch "${a}"); done

mkdir -p "${DIST}"
echo "==> Σύνδεση glossa-lid"
clang "${ARCH_FLAGS[@]}" -O2 -std=c11 \
  -I "${VENDOR}/include" \
  -I "${VENDOR}/ggml/include" \
  -o "${DIST}/glossa-lid" \
  "${ROOT}/lid/glossa-lid.c" \
  "${LIBS[@]}" \
  -lc++ \
  -framework Accelerate \
  -framework Foundation

echo "==> Έτοιμο: ${DIST}/glossa-lid"
"${DIST}/glossa-lid" 2>&1 | head -1 || true
