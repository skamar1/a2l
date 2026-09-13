import Foundation

/// Ό,τι μπορεί να αποφασίσει «ελληνικά ή αγγλικά;» πριν σταλεί ο ήχος.
///
/// Στο macOS το υλοποιεί το τοπικό whisper tiny. Στο iOS δεν υπάρχει
/// υλοποίηση: τα πληκτρολόγια ζουν με πολύ σφιχτό όριο μνήμης και ένα μοντέλο
/// 75 MB τα σκοτώνει. Εκεί η γλώσσα έρχεται από την τελευταία επιλογή και τη
/// διορθώνει ο έλεγχος αλφαβήτου.
protocol LanguageDecider: AnyObject {
    /// Επιστρέφει τη γλώσσα και τη βεβαιότητα (0.5–1.0), ή nil αν δεν μπόρεσε.
    func decideLanguage(samples: [Float]) async -> (language: Lang, confidence: Double)?
}

struct PipelineResult {
    let text: String
    let language: Lang
    /// nil όταν η γλώσσα ήταν κλειδωμένη ή δεν έτρεξε ανιχνευτής.
    let confidence: Double?
    /// `true` όταν ο έλεγχος αλφαβήτου αναγκάστηκε να αλλάξει γλώσσα.
    let corrected: Bool
    /// Δευτερόλεπτα ήχου που χρεώθηκαν — διπλάσια όταν έγινε διόρθωση.
    let billedSeconds: Double
}

/// Τα τρία επίπεδα, σε ένα σημείο, χωρίς καμία αναφορά σε UI ή πλατφόρμα.
/// macOS και iOS καλούν ΑΥΤΟ — η λογική που λύνει το πρόβλημα δεν υπάρχει
/// δύο φορές.
struct TranscriptionPipeline {

    struct Options {
        var forced: Lang?
        var fallback: Lang
        var confidenceThreshold: Double
        var scriptGuard: Bool
        var provider: Provider
        var prompts: [Lang: String]
    }

    let transcriber: Transcriber

    init(transcriber: Transcriber = Transcriber()) {
        self.transcriber = transcriber
    }

    func run(samples: [Float],
             options: Options,
             decider: LanguageDecider?,
             onLanguageChosen: @escaping @Sendable (Lang) -> Void = { _ in }) async throws -> PipelineResult {

        let duration = Double(samples.count) / AudioRecorder.sampleRate
        let provider = options.provider

        // --- Επίπεδο 1: περιορισμένη αναγνώριση ---------------------------
        var language: Lang
        var confidence: Double?

        if let forced = options.forced {
            language = forced
        } else if let decision = await decider?.decideLanguage(samples: samples) {
            // Χαμηλή βεβαιότητα σημαίνει «σχεδόν ισοπαλία». Εκεί η δηλωμένη
            // προτίμηση του χρήστη είναι καλύτερος σύμβουλος από ένα οριακό argmax.
            language = decision.confidence >= options.confidenceThreshold
                ? decision.language
                : options.fallback
            confidence = decision.confidence
        } else {
            language = options.fallback
        }

        onLanguageChosen(language)

        // --- Επίπεδο 2: κλειδωμένη γλώσσα ---------------------------------
        // Το `language` περνάει ρητά στο αίτημα (όταν ο πάροχος το δέχεται),
        // οπότε τρίτη γλώσσα είναι δομικά αδύνατη.
        let wav = WavWriter.encode(samples: samples)
        var text = try await transcriber.transcribe(
            wav: wav, language: language, provider: provider, prompt: options.prompts[language]
        )
        var corrected = false

        // --- Επίπεδο 3: έλεγχος αλφαβήτου ---------------------------------
        // Χωρίς κλείδωμα γλώσσας η επανάληψη θα έστελνε το ΙΔΙΟ αίτημα και θα
        // έπαιρνε το ίδιο λάθος — σκέτη διπλή χρέωση.
        if options.scriptGuard, provider.supportsLanguageLock,
           ScriptGuard.contradicts(text, lockedTo: language) {
            let flipped = language.other
            onLanguageChosen(flipped)
            if let second = try? await transcriber.transcribe(
                wav: wav, language: flipped, provider: provider, prompt: options.prompts[flipped]
            ), !ScriptGuard.contradicts(second, lockedTo: flipped) {
                text = second
                language = flipped
                corrected = true
            }
        }

        return PipelineResult(text: text, language: language, confidence: confidence,
                              corrected: corrected,
                              billedSeconds: corrected ? duration * 2 : duration)
    }
}
