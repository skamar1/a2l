#if os(iOS)
import Combine
import Foundation

/// Ο ελεγκτής υπαγόρευσης του iOS — τον μοιράζονται η εφαρμογή και το
/// πληκτρολόγιο.
///
/// Διαφορά από το macOS: **δεν τρέχει τοπικό μοντέλο**. Ένα πληκτρολόγιο iOS
/// ζει με πολύ σφιχτό όριο μνήμης και ένα whisper tiny των 75 MB το σκοτώνει.
/// Άρα το επίπεδο 1 λείπει και τη δουλειά την κάνουν τα άλλα δύο: η γλώσσα
/// κλειδώνεται στην τελευταία που δούλεψε, και ο έλεγχος αλφαβήτου τη
/// διορθώνει όταν πέσει έξω. Μετά την πρώτη διόρθωση, η «κολλημένη» γλώσσα
/// είναι η σωστή — που για μια συνεχόμενη συζήτηση σημαίνει ότι το κόστος της
/// διόρθωσης πληρώνεται μία φορά, όχι σε κάθε πρόταση.
@MainActor
final class IOSDictation: ObservableObject {

    enum State: Equatable {
        case idle
        case recording
        case working(Lang)
        case error(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var level: Float = 0
    @Published private(set) var lastText: String = ""

    let history = History()

    private let prefs = Preferences.shared
    private let recorder = AudioRecorder()
    private let pipeline = TranscriptionPipeline()

    /// Πού πάει το κείμενο: στο πληκτρολόγιο είναι το `insertText`, στην
    /// εφαρμογή είναι η οθόνη.
    var onText: ((String) -> Void)?

    var isRecording: Bool { recorder.isRecording }

    /// Ρητοί publishers: το UIKit πληκτρολόγιο δεν είναι SwiftUI View και
    /// χρειάζεται συνδρομή, ενώ ο projected value μιας `private(set)`
    /// ιδιότητας δεν είναι προσβάσιμος από άλλο αρχείο.
    var statePublisher: AnyPublisher<State, Never> { $state.eraseToAnyPublisher() }
    var levelPublisher: AnyPublisher<Float, Never> { $level.eraseToAnyPublisher() }

    init() {
        recorder.onLevel = { [weak self] value in
            Task { @MainActor in self?.level = value }
        }
        recorder.onLimitReached = { [weak self] in
            Task { @MainActor in self?.stopAndProcess() }
        }
    }

    static func requestMicrophone() async -> Bool {
        await AudioRecorder.requestMicrophone()
    }

    static var microphoneAuthorized: Bool { AudioRecorder.microphoneAuthorized() }

    func toggle() {
        if recorder.isRecording {
            stopAndProcess()
        } else {
            start()
        }
    }

    func start() {
        guard !recorder.isRecording else { return }
        Task { @MainActor in
            guard await AudioRecorder.requestMicrophone() else {
                // Το πληκτρολόγιο δεν μπορεί να εμφανίσει το πρότυπο μήνυμα
                // του συστήματος — την άδεια τη ζητά η κύρια εφαρμογή.
                state = .error("Δεν υπάρχει άδεια μικροφώνου. Άνοιξε την εφαρμογή Glossa μία φορά.")
                return
            }
            do {
                try recorder.start(maxSeconds: prefs.maxSeconds)
                state = .recording
            } catch {
                state = .error(error.localizedDescription)
            }
        }
    }

    func cancel() {
        guard recorder.isRecording else { return }
        recorder.cancel()
        level = 0
        state = .idle
    }

    func stopAndProcess() {
        guard recorder.isRecording else { return }
        let samples = recorder.stop()
        level = 0

        let duration = Double(samples.count) / AudioRecorder.sampleRate
        guard duration >= prefs.minSeconds else {
            state = .idle
            return
        }

        let forced = prefs.languageMode.forced
        let options = TranscriptionPipeline.Options(
            forced: forced,
            fallback: prefs.stickyLanguage,
            confidenceThreshold: prefs.confidenceThreshold,
            scriptGuard: prefs.scriptGuardEnabled,
            provider: prefs.provider,
            prompts: [.el: prefs.prompt(for: .el), .en: prefs.prompt(for: .en)]
        )

        state = .working(forced ?? prefs.stickyLanguage)

        let pipeline = self.pipeline
        Task { @MainActor [weak self] in
            do {
                let result = try await pipeline.run(samples: samples, options: options, decider: nil)
                guard let self else { return }
                self.prefs.stickyLanguage = result.language
                self.prefs.addUsage(seconds: result.billedSeconds)
                self.history.add(Transcript(date: Date(), text: result.text,
                                            language: result.language,
                                            confidence: result.confidence,
                                            duration: duration, corrected: result.corrected))
                self.lastText = result.text
                self.onText?(result.text)
                self.state = .idle
            } catch {
                self?.state = .error(error.localizedDescription)
            }
        }
    }

    func clearError() {
        if case .error = state { state = .idle }
    }
}
#endif
