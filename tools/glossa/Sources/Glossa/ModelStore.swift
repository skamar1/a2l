import Foundation

/// Κατέβασμα του tiny μοντέλου που χρησιμοποιεί ο ανιχνευτής γλώσσας.
/// Δεν μπαίνει στο git ούτε στο bundle: είναι ~75 MB και κατεβαίνει μία φορά.
enum ModelStore {

    static let downloadURL = URL(
        string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
    )!

    enum DownloadError: LocalizedError {
        case badResponse(Int)
        case cannotWrite(String)

        var errorDescription: String? {
            switch self {
            case .badResponse(let code): return "Η λήψη απέτυχε (HTTP \(code))."
            case .cannotWrite(let why):  return "Δεν γράφτηκε το μοντέλο: \(why)"
            }
        }
    }

    static var isInstalled: Bool { LanguageDetector.modelExists }

    static var installedSize: String? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: LanguageDetector.modelURL.path),
              let bytes = attributes[.size] as? NSNumber
        else { return nil }
        return ByteCountFormatter.string(fromByteCount: bytes.int64Value, countStyle: .file)
    }

    static func download(progress: @escaping (Double) -> Void) async throws {
        try FileManager.default.createDirectory(at: LanguageDetector.modelDirectory,
                                                withIntermediateDirectories: true)
        let downloader = ModelDownloader(progress: progress)
        try await downloader.run(from: downloadURL, to: LanguageDetector.modelURL)
    }

    static func remove() {
        try? FileManager.default.removeItem(at: LanguageDetector.modelURL)
    }
}

/// Χρησιμοποιεί `URLSessionDownloadTask` και όχι `URLSession.bytes`: το
/// δεύτερο θα σήμαινε ένα `await` ανά byte, δηλαδή ~75 εκατομμύρια για ένα
/// μοντέλο 75 MB.
private final class ModelDownloader: NSObject, URLSessionDownloadDelegate {

    private let progress: (Double) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var destination: URL?

    init(progress: @escaping (Double) -> Void) {
        self.progress = progress
    }

    func run(from source: URL, to destination: URL) async throws {
        self.destination = destination
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            session.downloadTask(with: source).resume()
        }
    }

    private func finish(_ result: Result<Void, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let fraction = min(1, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
        DispatchQueue.main.async { self.progress(fraction) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // Το αρχείο στο `location` διαγράφεται μόλις επιστρέψει αυτή η
        // μέθοδος, οπότε η μετακίνηση γίνεται εδώ, σύγχρονα.
        guard let destination else {
            finish(.failure(ModelStore.DownloadError.cannotWrite("άγνωστος προορισμός")))
            return
        }
        if let response = downloadTask.response as? HTTPURLResponse, response.statusCode != 200 {
            finish(.failure(ModelStore.DownloadError.badResponse(response.statusCode)))
            return
        }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            DispatchQueue.main.async { self.progress(1) }
            finish(.success(()))
        } catch {
            finish(.failure(ModelStore.DownloadError.cannotWrite(error.localizedDescription)))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)) }
    }
}
