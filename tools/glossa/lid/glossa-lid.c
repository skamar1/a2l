// glossa-lid — μικρός βοηθός αναγνώρισης γλώσσας (Language ID) πάνω στο whisper.cpp.
//
// Γιατί υπάρχει: το Whisper, όταν του ζητήσεις "auto" γλώσσα, διαλέγει το
// argmax πάνω σε ~99 γλώσσες. Σε σύντομο ή θορυβώδη ήχο αυτό βγάζει
// Κινέζικα/Ουαλικά/ό,τι να 'ναι. Εδώ ζητάμε τις πιθανότητες ΟΛΩΝ των γλωσσών
// και κρατάμε το argmax ΜΟΝΟ πάνω στις γλώσσες που δηλώνει ο χρήστης
// (π.χ. el, en). Η επιλογή γίνεται έτσι δυαδική και σχεδόν πάντα σωστή.
//
// Τρέχει σαν μακρόβια διεργασία ώστε το μοντέλο να φορτώνεται μία φορά.
// Πρωτόκολλο (γραμμές κειμένου, UTF-8, σε stdin/stdout):
//
//   <-- READY <πλήθος γλωσσών>            (μία φορά, μετά τη φόρτωση)
//   --> DETECT <lang1,lang2,...> <path>   (path = ό,τι απομένει στη γραμμή)
//   <-- OK el=0.981234 en=0.014000 top=el
//   --> PING            <-- PONG
//   --> QUIT            (τερματίζει)
//   <-- ERR <μήνυμα>    (σε οποιοδήποτε σφάλμα)
//
// Το <path> δείχνει σε ΑΚΑΤΕΡΓΑΣΤΑ δείγματα float32 little-endian, mono,
// 16 kHz — χωρίς header. Τα γράφει η εφαρμογή Swift, οπότε δεν χρειάζεται
// parser για WAV εδώ.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#include "whisper.h"

#define MAX_LINE      8192
#define MAX_LANGS     16
// Το Whisper κοιτάζει ούτως ή άλλως μόνο το πρώτο παράθυρο των 30".
// Πιο πάνω από αυτό, ο υπολογισμός του mel είναι σκέτη σπατάλη χρόνου.
#define MAX_SAMPLES   (30 * WHISPER_SAMPLE_RATE)
#define MIN_SAMPLES   (WHISPER_SAMPLE_RATE / 4)   // 0.25s — κάτω από αυτό δεν κρίνεται τίποτα

static void silent_log(enum ggml_log_level level, const char *text, void *user_data) {
    (void)level; (void)text; (void)user_data;   // το whisper/ggml να μη λερώνει τα streams
}

static void fail(const char *msg) {
    printf("ERR %s\n", msg);
    fflush(stdout);
}

// Διαβάζει ολόκληρο το αρχείο σαν float32. Επιστρέφει NULL σε αποτυχία.
static float *read_samples(const char *path, int *n_out) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long bytes = ftell(f);
    if (bytes < 0) { fclose(f); return NULL; }
    rewind(f);

    long n = bytes / (long)sizeof(float);
    if (n > MAX_SAMPLES) n = MAX_SAMPLES;
    if (n <= 0) { fclose(f); return NULL; }

    float *buf = (float *)malloc((size_t)n * sizeof(float));
    if (!buf) { fclose(f); return NULL; }

    size_t got = fread(buf, sizeof(float), (size_t)n, f);
    fclose(f);
    if (got != (size_t)n) { free(buf); return NULL; }

    *n_out = (int)n;
    return buf;
}

// Κόβει το "el,en" σε ids. Επιστρέφει το πλήθος, ή -1 αν κάποιος κωδικός
// είναι άγνωστος (καλύτερα σφάλμα παρά σιωπηλή αγνόηση).
static int parse_langs(char *spec, int *ids, char codes[][8], int max) {
    int n = 0;
    for (char *tok = strtok(spec, ","); tok && n < max; tok = strtok(NULL, ",")) {
        int id = whisper_lang_id(tok);
        if (id < 0) return -1;
        ids[n] = id;
        snprintf(codes[n], 8, "%s", tok);
        n++;
    }
    return n;
}

static void handle_detect(struct whisper_context *ctx, int n_threads,
                          float *probs, int n_probs, char *args) {
    // args == "<langs> <path>" — το path παίρνει ό,τι απομένει, ώστε να
    // επιτρέπονται κενά στη διαδρομή.
    char *sp = strchr(args, ' ');
    if (!sp) { fail("bad-request"); return; }
    *sp = '\0';
    const char *path = sp + 1;
    while (*path == ' ') path++;
    if (*path == '\0') { fail("missing-path"); return; }

    int  ids[MAX_LANGS];
    char codes[MAX_LANGS][8];
    int  n_langs = parse_langs(args, ids, codes, MAX_LANGS);
    if (n_langs <= 0) { fail("bad-languages"); return; }

    int    n_samples = 0;
    float *samples   = read_samples(path, &n_samples);
    if (!samples) { fail("cannot-read-samples"); return; }
    if (n_samples < MIN_SAMPLES) { free(samples); fail("too-short"); return; }

    if (whisper_pcm_to_mel(ctx, samples, n_samples, n_threads) != 0) {
        free(samples);
        fail("mel-failed");
        return;
    }
    free(samples);

    int top = whisper_lang_auto_detect(ctx, 0, n_threads, probs);
    if (top < 0) { fail("detect-failed"); return; }

    // Κανονικοποίηση ΜΟΝΟ πάνω στις ζητούμενες γλώσσες: αυτό είναι όλο το
    // νόημα του εργαλείου. Το "top" το στέλνουμε μόνο για διαγνωστικά.
    double sum = 0.0;
    for (int i = 0; i < n_langs; i++) {
        if (ids[i] < n_probs) sum += (double)probs[ids[i]];
    }

    char out[MAX_LINE];
    int  len = snprintf(out, sizeof out, "OK");
    for (int i = 0; i < n_langs && len < (int)sizeof(out); i++) {
        double p = (ids[i] < n_probs) ? (double)probs[ids[i]] : 0.0;
        double norm = (sum > 0.0) ? p / sum : 1.0 / (double)n_langs;
        len += snprintf(out + len, sizeof(out) - (size_t)len, " %s=%.6f", codes[i], norm);
    }

    const char *top_code = whisper_lang_str(top);
    snprintf(out + len, sizeof(out) - (size_t)len, " top=%s\n", top_code ? top_code : "?");

    fputs(out, stdout);
    fflush(stdout);
}

int main(int argc, char **argv) {
    const char *model     = NULL;
    int         n_threads = 4;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--model") == 0 && i + 1 < argc) {
            model = argv[++i];
        } else if (strcmp(argv[i], "--threads") == 0 && i + 1 < argc) {
            n_threads = atoi(argv[++i]);
            if (n_threads < 1) n_threads = 1;
        } else {
            fprintf(stderr, "χρήση: glossa-lid --model <ggml-*.bin> [--threads N]\n");
            return 2;
        }
    }
    if (!model) {
        fprintf(stderr, "χρήση: glossa-lid --model <ggml-*.bin> [--threads N]\n");
        return 2;
    }

    whisper_log_set(silent_log, NULL);

    struct whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;   // για ένα tiny μοντέλο σε 30" ήχου η CPU αρκεί

    struct whisper_context *ctx = whisper_init_from_file_with_params(model, cparams);
    if (!ctx) {
        fail("model-load-failed");
        return 1;
    }

    int    n_probs = whisper_lang_max_id() + 1;
    float *probs   = (float *)malloc((size_t)n_probs * sizeof(float));
    if (!probs) {
        whisper_free(ctx);
        fail("out-of-memory");
        return 1;
    }

    printf("READY %d\n", n_probs);
    fflush(stdout);

    char line[MAX_LINE];
    while (fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\r\n")] = '\0';

        if (strncmp(line, "DETECT ", 7) == 0) {
            handle_detect(ctx, n_threads, probs, n_probs, line + 7);
        } else if (strcmp(line, "PING") == 0) {
            printf("PONG\n");
            fflush(stdout);
        } else if (strcmp(line, "QUIT") == 0) {
            break;
        } else if (line[0] != '\0') {
            fail("unknown-command");
        }
    }

    free(probs);
    whisper_free(ctx);
    return 0;
}
