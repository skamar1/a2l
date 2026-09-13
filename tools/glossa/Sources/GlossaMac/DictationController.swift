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
        let options = TranscriptionPipeline.Options(
            forced: forced,
            fallback: prefs.ambiguousFallback,
            confidenceThreshold: prefs.confidenceThreshold,
            scriptGuard: allowGuard && prefs.scriptGuardEnabled,
            provider: prefs.provider,
            prompts: [.el: prefs.prompt(for: .el), .en: prefs.prompt(for: .en)]
        )
        let outputMode = prefs.outputMode

        state = forced.map(State.transcribing) ?? .detecting
        notify()

        let detector = self.detector
        let pipeline = TranscriptionPipeline(transcriber: transcriber)

        Task.detached(priority: .userInitiated) { [weak self] in
            do {
                let result = try await pipeline.run(
                    samples: samples,
                    options: options,
                    decider: forced == nil ? detector : nil,
                    onLanguageChosen: { language in
                        Task { @MainActor in
                            self?.state = .transcribing(language)
                            self?.notify()
                        }
                    }
                )
                let status = detector.status
                await MainActor.run {
                    self?.detectorStatus = status
                    self?.deliver(result, duration: duration, mode: outputMode)
                }
            } catch {
                let message = error.localizedDescription
                await MainActor.run { self?.setError(message) }
            }
        }
    }

    private func deliver(_ result: PipelineResult, duration: Double, mode: OutputMode) {
        lastLanguage = result.language
        history.add(Transcript(date: Date(), text: result.text, language: result.language,
                               confidence: result.confidence, duration: duration,
                               corrected: result.corrected))
        prefs.addUsage(seconds: result.billedSeconds)

        TextInjector.deliver(result.text, mode: mode)
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
