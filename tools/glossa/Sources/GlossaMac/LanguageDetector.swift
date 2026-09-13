import Foundation

/// Οδηγεί τον βοηθό `glossa-lid` — μια μακρόβια διεργασία που κρατά φορτωμένο
/// το tiny μοντέλο του Whisper και απαντά σε ερωτήματα «ελληνικά ή αγγλικά;».
///
/// Είναι ξεχωριστή διεργασία και όχι βιβλιοθήκη επίτηδες: αν λείπει ή σκάσει,
/// η υπαγόρευση συνεχίζει με την εφεδρική γλώσσα αντί να πέσει η εφαρμογή.
final class LanguageDetector {

    struct Result {
        let language: Lang
        /// Κανονικοποιημένη πιθανότητα ΜΟΝΟ πάνω στις δύο γλώσσες (0.5–1.0).
        let confidence: Double
        /// Τι θα διάλεγε το Whisper χωρίς περιορισμό — μόνο για διαγνωστικά.
        let unconstrainedTop: String
    }

    enum Status: Equatable {
        case notStarted
        case missingHelper
        case missingModel
        case ready
        case failed(String)

        var isReady: Bool { self == .ready }

        var display: String {
            switch self {
            case .notStarted:      return "δεν ξεκίνησε"
            case .missingHelper:   return "λείπει το glossa-lid"
            case .missingModel:    return "λείπει το μοντέλο"
            case .ready:           return "έτοιμο"
            case .failed(let why): return "σφάλμα: \(why)"
            }
        }
    }

    private(set) var status: Status = .notStarted

    private let queue = DispatchQueue(label: "gr.a2l.glossa.lid")
    private var process: Process?
    private var toHelper: FileHandle?
    private var fromHelper: FileHandle?
    private var pending = Data()
    private let stderrLock = NSLock()
    private var stderrTail = ""

    private let startTimeout: TimeInterval = 20
    private let detectTimeout: TimeInterval = 15

    // MARK: Διαδρομές

    /// Ο βοηθός συνοδεύει την εφαρμογή μέσα στο bundle· εκτός bundle (π.χ.
    /// `swift run` κατά την ανάπτυξη) τον ψάχνουμε δίπλα στο εκτελέσιμο.
    static var helperURL: URL? {
        if let bundled = Bundle.main.url(forAuxiliaryExecutable: "glossa-lid") {
            return bundled
        }
        let candidates = [
            Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("glossa-lid"),
            URL(fileURLWithPath: CommandLine.arguments[0])
                .deletingLastPathComponent()
                .appendingPathComponent("glossa-lid"),
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    var diagnostics: String {
        stderrLock.lock()
        defer { stderrLock.unlock() }
        return stderrTail
    }

    // MARK: Εκκίνηση

    /// Ξεκινά τον βοηθό. Μπλοκάρει μέχρι να φορτώσει το μοντέλο, οπότε
    /// καλείται εκτός main thread.
    @discardableResult
    func startIfNeeded() -> Status {
        queue.sync { startLocked() }
    }

    private func startLocked() -> Status {
        if let process, process.isRunning, status.isReady { return status }

        shutdownLocked()

        guard let helper = LanguageDetector.helperURL else {
            status = .missingHelper
            return status
        }
        guard ModelStore.isInstalled else {
            status = .missingModel
            return status
        }

        let task = Process()
        task.executableURL = helper
        task.arguments = ["--model", ModelStore.modelURL.path,
                          "--threads", String(max(2, min(6, ProcessInfo.processInfo.activeProcessorCount / 2)))]

        let stdinPipe = Pipe(), stdoutPipe = Pipe(), stderrPipe = Pipe()
        task.standardInput = stdinPipe
        task.standardOutput = stdoutPipe
        task.standardError = stderrPipe

        // Κρατάμε την ουρά του stderr για το πάνελ διαγνωστικών· χωρίς αυτό,
        // ένα σφάλμα του ggml θα ήταν εντελώς αόρατο.
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            guard let self else { return }
            self.stderrLock.lock()
            self.stderrTail = String((self.stderrTail + text).suffix(4_000))
            self.stderrLock.unlock()
        }

        do {
            try task.run()
        } catch {
            status = .failed(error.localizedDescription)
            return status
        }

        process = task
        toHelper = stdinPipe.fileHandleForWriting
        fromHelper = stdoutPipe.fileHandleForReading
        pending = Data()

        guard let greeting = readLineLocked(timeout: startTimeout) else {
            shutdownLocked()
            status = .failed("ο βοηθός δεν απάντησε στην εκκίνηση")
            return status
        }
        guard greeting.hasPrefix("READY") else {
            shutdownLocked()
            status = .failed(greeting.hasPrefix("ERR ") ? String(greeting.dropFirst(4)) : greeting)
            return status
        }

        status = .ready
        return status
    }

    func shutdown() {
        queue.sync { shutdownLocked() }
    }

    private func shutdownLocked() {
        if let toHelper, let process, process.isRunning {
            try? toHelper.write(contentsOf: Data("QUIT\n".utf8))
        }
        if let process, process.isRunning {
            process.terminate()
        }
        (process?.standardError as? Pipe)?.fileHandleForReading.readabilityHandler = nil
        try? toHelper?.close()
        process = nil
        toHelper = nil
        fromHelper = nil
        pending = Data()
        if status.isReady { status = .notStarted }
    }

    // MARK: Ανίχνευση

    /// Μπλοκάρει μέχρι την απάντηση. Καλείται εκτός main thread.
    func detect(samples: [Float], among languages: [Lang] = Lang.allCases) -> Result? {
        queue.sync { () -> Result? in
            guard startLocked().isReady else { return nil }
            guard samples.count >= 4_000 else { return nil }   // < 0.25s: τίποτα να κριθεί

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("glossa-lid-\(UUID().uuidString).f32")
            defer { try? FileManager.default.removeItem(at: url) }

            // Ο βοηθός κοιτάζει ούτως ή άλλως μόνο τα πρώτα 30".
            let capped = samples.count > 480_000 ? Array(samples[0..<480_000]) : samples
            let data = capped.withUnsafeBufferPointer { Data(buffer: $0) }
            guard (try? data.write(to: url, options: .atomic)) != nil else { return nil }

            let codes = languages.map(\.rawValue).joined(separator: ",")
            // Η διαδρομή μπαίνει ΤΕΛΕΥΤΑΙΑ: ο βοηθός παίρνει ό,τι απομένει στη
            // γραμμή, άρα κενά στο όνομα χρήστη δεν χαλάνε το πρωτόκολλο.
            let request = "DETECT \(codes) \(url.path)\n"

            guard let toHelper, (try? toHelper.write(contentsOf: Data(request.utf8))) != nil else {
                status = .failed("διακόπηκε η επικοινωνία με τον βοηθό")
                shutdownLocked()
                return nil
            }

            guard let reply = readLineLocked(timeout: detectTimeout) else {
                status = .failed("ο βοηθός δεν απάντησε")
                shutdownLocked()
                return nil
            }
            return parse(reply, among: languages)
        }
    }

    private func parse(_ reply: String, among languages: [Lang]) -> Result? {
        guard reply.hasPrefix("OK ") else { return nil }

        var probabilities: [Lang: Double] = [:]
        var top = "?"

        for field in reply.dropFirst(3).split(separator: " ") {
            let parts = field.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = String(parts[0]), value = String(parts[1])
            if key == "top" {
                top = value
            } else if let lang = Lang(rawValue: key), let p = Double(value) {
                probabilities[lang] = p
            }
        }

        guard let best = languages
            .compactMap({ lang in probabilities[lang].map { (lang, $0) } })
            .max(by: { $0.1 < $1.1 })
        else { return nil }

        return Result(language: best.0, confidence: best.1, unconstrainedTop: top)
    }

    // MARK: Ανάγνωση γραμμής με χρονικό όριο

    private func readLineLocked(timeout: TimeInterval) -> String? {
        let deadline = Date().addingTimeInterval(timeout)

        while true {
            if let index = pending.firstIndex(of: 0x0A) {
                let line = pending[pending.startIndex..<index]
                pending.removeSubrange(pending.startIndex...index)
                return String(decoding: line, as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let fromHelper, Date() < deadline else { return nil }

            // Το availableData μπλοκάρει μέχρι να υπάρξουν bytes ή EOF. Το
            // χρονικό όριο το επιβάλλει ο επόπτης παρακάτω, σκοτώνοντας τη
            // διεργασία — που ξεμπλοκάρει την ανάγνωση με EOF.
            let victim = process
            let watchdog = DispatchWorkItem {
                if let victim, victim.isRunning { victim.terminate() }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + max(1, deadline.timeIntervalSinceNow),
                                              execute: watchdog)
            let chunk = fromHelper.availableData
            watchdog.cancel()

            if chunk.isEmpty { return nil }   // EOF: η διεργασία έφυγε
            pending.append(chunk)
        }
    }

    deinit { shutdownLocked() }
}


// MARK: - Συμμετοχή στον κοινό αγωγό

extension LanguageDetector: LanguageDecider {
    /// Ο βοηθός μπλοκάρει όσο περιμένει τη διεργασία, οπότε η κλήση φεύγει
    /// από το νήμα που την κάλεσε.
    func decideLanguage(samples: [Float]) async -> (language: Lang, confidence: Double)? {
        await Task.detached(priority: .userInitiated) { () -> (language: Lang, confidence: Double)? in
            guard let result = self.detect(samples: samples, among: Lang.allCases) else { return nil }
            return (language: result.language, confidence: result.confidence)
        }.value
    }
}
