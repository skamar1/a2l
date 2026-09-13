import AppKit
import Foundation

/// Ο ενορχηστρωτής: ηχογράφηση → επιλογή γλώσσας → απομαγνητοφώνηση →
/// έλεγχος αλφαβήτου → παράδοση κειμένου.
@MainActor
final class DictationController: ObservableObject {

    enum State: Equatable {
        case idle
        case recording
        case detecting
        case transcribing(Lang)
        case error(String)

        var isBusy: Bool {
            switch self {
            case .detecting, .transcribing: return true
            default: return false
            }
        }
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var level: Float = 0
    @Published private(set) var detectorStatus: LanguageDetector.Status = .notStarted

    let history = History()

    private let prefs = Preferences.shared
    private let recorder = AudioRecorder()
    private let detector = LanguageDetector()
    private let transcriber = Transcriber()

    /// Κρατιέται για την «επανάληψη στην άλλη γλώσσα»: αν πέσει έξω η
    /// αναγνώριση, δεν έχει νόημα να ξαναμιλήσει ο χρήστης — έχουμε τον ήχο.
    private var lastSamples: [Float] = []
    private var lastLanguage: Lang?

    var onStateChange: (() -> Void)?

    var isRecording: Bool { recorder.isRecording }

    /// Η ουρά του stderr του βοηθού — το μόνο παράθυρο σε ό,τι πάει στραβά
    /// μέσα στο whisper.cpp.
    var detectorDiagnostics: String { detector.diagnostics }

    init() {
        recorder.onLevel = { [weak self] value in
            Task { @MainActor in self?.level = value }
        }
        recorder.onLimitReached = { [weak self] in
            Task { @MainActor in self?.stopAndProcess() }
        }
    }

    // MARK: Προθέρμανση

    /// Φορτώνει το μοντέλο στο παρασκήνιο ώστε η πρώτη υπαγόρευση να μην
    /// πληρώσει τον χρόνο εκκίνησης του βοηθού.
    func warmUp() {
        let detector = self.detector
        Task.detached(priority: .utility) { [weak self] in
            let status = detector.startIfNeeded()
            await MainActor.run {
                self?.detectorStatus = status
                self?.notify()
            }
        }
    }

    func shutdown() {
        detector.shutdown()
    }

    // MARK: Χειρισμός από το UI

    func startRecording() {
        guard !state.isBusy, !recorder.isRecording else { return }

        Task { @MainActor in
            guard await AudioRecorder.requestMicrophone() else {
                setError(AudioRecorder.RecorderError.microphoneDenied.localizedDescription)
                return
            }
            do {
                try recorder.start(maxSeconds: prefs.maxSeconds)
                state = .recording
                play(.start)
                notify()
            } catch {
                setError(error.localizedDescription)
            }
        }
    }

    func stopAndProcess() {
        guard recorder.isRecording else { return }
        let samples = recorder.stop()
        level = 0

        let duration = Double(samples.count) / AudioRecorder.sampleRate
        guard duration >= prefs.minSeconds else {
            // Στιγμιαίο πάτημα — πιθανότατα κατά λάθος. Σιωπηλή επιστροφή.
            state = .idle
            notify()
            return
        }

        lastSamples = samples
        process(samples: samples, forcing: prefs.languageMode.forced, allowGuard: true)
    }

    func cancelRecording() {
        guard recorder.isRecording else { return }
        recorder.cancel()
        level = 0
        state = .idle
        play(.cancel)
        notify()
    }

    func toggle() {
        if recorder.isRecording {
            stopAndProcess()
        } else {
            startRecording()
        }
    }

    /// Ξαναζητά την τελευταία ηχογράφηση στην άλλη γλώσσα — το εργαλείο
    /// διόρθωσης, για τη σπάνια φορά που όλα τα αυτόματα πέφτουν έξω.
    func retryInOtherLanguage() {
        guard !state.isBusy, !recorder.isRecording,
              !lastSamples.isEmpty, let last = lastLanguage
        else {
            play(.error)
            return
        }
        process(samples: lastSamples, forcing: last.other, allowGuard: false)
    }

    func clearError() {
        if case .error = state {
            state = .idle
            notify()
        }
    }

    // MARK: Ο αγωγός

    private func process(samples: [Float], forcing forced: Lang?, allowGuard: Bool) {
        let duration = Double(samples.count) / AudioRecorder.sampleRate

        // Όλες οι ρυθμίσεις διαβάζονται ΕΔΩ, στο main thread, και ταξιδεύουν
        // σαν απλές τιμές: η εργασία στο παρασκήνιο δεν αγγίζει κοινή κατάσταση.
        let model = prefs.model
        let fallback = prefs.ambiguousFallback
        let threshold = prefs.confidenceThreshold
        let useGuard = allowGuard && prefs.scriptGuardEnabled
        let outputMode = prefs.outputMode
        let prompts: [Lang: String] = [.el: prefs.prompt(for: .el), .en: prefs.prompt(for: .en)]

        state = forced.map(State.transcribing) ?? .detecting
        notify()

        let detector = self.detector
        let transcriber = self.transcriber

        Task.detached(priority: .userInitiated) { [weak self] in
            var confidence: Double? = nil
            var language: Lang

            if let forced {
                language = forced
            } else {
                let detection = detector.detect(samples: samples, among: Lang.allCases)
                let status = detector.status
                await MainActor.run { self?.detectorStatus = status }

                if let detection {
                    // Χαμηλή βεβαιότητα σημαίνει «σχεδόν ισοπαλία». Εκεί η
                    // δηλωμένη προτίμηση του χρήστη είναι καλύτερος σύμβουλος
                    // από ένα οριακό argmax.
                    language = detection.confidence >= threshold ? detection.language : fallback
                    confidence = detection.confidence
                } else {
                    language = fallback
                }
            }

            let chosen = language
            await MainActor.run {
                self?.state = .transcribing(chosen)
                self?.notify()
            }

            let wav = WavWriter.encode(samples: samples)

            do {
                var text = try await transcriber.transcribe(
                    wav: wav, language: language, model: model, prompt: prompts[language]
                )
                var corrected = false

                // Δεύτερη ευκαιρία: αν το κείμενο βγήκε σε λάθος αλφάβητο, η
                // γλώσσα ήταν λάθος — και αυτό το ξέρουμε με βεβαιότητα, χωρίς
                // μοντέλο, μετρώντας γράμματα.
                if useGuard, ScriptGuard.contradicts(text, lockedTo: language) {
                    let flipped = language.other
                    await MainActor.run {
                        self?.state = .transcribing(flipped)
                        self?.notify()
                    }
                    if let second = try? await transcriber.transcribe(
                        wav: wav, language: flipped, model: model, prompt: prompts[flipped]
                    ), !ScriptGuard.contradicts(second, lockedTo: flipped) {
                        text = second
                        language = flipped
                        corrected = true
                    }
                }

                let finalText = text
                let finalLanguage = language
                let wasCorrected = corrected
                let finalConfidence = confidence

                await MainActor.run {
                    self?.deliver(finalText, language: finalLanguage, confidence: finalConfidence,
                                  duration: duration, corrected: wasCorrected, mode: outputMode)
                }
            } catch {
                let message = error.localizedDescription
                await MainActor.run { self?.setError(message) }
            }
        }
    }

    private func deliver(_ text: String, language: Lang, confidence: Double?,
                         duration: Double, corrected: Bool, mode: OutputMode) {
        lastLanguage = language
        history.add(Transcript(date: Date(), text: text, language: language,
                               confidence: confidence, duration: duration, corrected: corrected))
        // Μια διόρθωση από το ScriptGuard σημαίνει ότι ο ίδιος ήχος στάλθηκε
        // δύο φορές — και χρεώθηκε δύο φορές.
        prefs.addUsage(seconds: corrected ? duration * 2 : duration)

        TextInjector.deliver(text, mode: mode)
        state = .idle
        play(.done)
        notify()
    }

    private func setError(_ message: String) {
        state = .error(message)
        play(.error)
        notify()
        // Το σφάλμα δεν πρέπει να κρατήσει το εικονίδιο κόκκινο για πάντα.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            self?.clearError()
        }
    }

    private func notify() {
        onStateChange?()
    }

    // MARK: Ήχοι

    private enum Cue: String {
        case start = "Pop"
        case done = "Glass"
        case cancel = "Bottle"
        case error = "Basso"
    }

    private func play(_ cue: Cue) {
        guard prefs.playSounds else { return }
        NSSound(named: NSSound.Name(cue.rawValue))?.play()
    }
}
