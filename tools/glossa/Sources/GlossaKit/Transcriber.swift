import Foundation

/// Στέλνει τον ήχο σε όποιον πάροχο έχει επιλεγεί.
///
/// Η γλώσσα στέλνεται ΠΑΝΤΑ ρητά, όταν ο πάροχος τη δέχεται. Αυτό είναι το
/// σημείο όπου διορθώνεται το αρχικό πρόβλημα: το μοντέλο δεν καλείται ποτέ
/// να μαντέψει γλώσσα, άρα δεν έχει καν τη δυνατότητα να γυρίσει κινέζικα.
final class Transcriber {

    enum TranscriberError: LocalizedError {
        case missingAPIKey(String)
        case badEndpoint
        case unauthorized(String)
        case rateLimited(String)
        case server(Int, String)
        case network(String)
        case emptyResponse
        case unexpectedResponse(String)

        var errorDescription: String? {
            switch self {
            case .missingAPIKey(let provider):
                return "Δεν έχει οριστεί κλειδί για το \(provider). Ρυθμίσεις → Πάροχοι."
            case .badEndpoint:
                return "Άκυρο URL παρόχου. Έλεγξε το base URL στις Ρυθμίσεις."
            case .unauthorized(let provider):
                return "Το \(provider) απέρριψε το κλειδί (401/403)."
            case .rateLimited(let provider):
                return "Το \(provider) επέστρεψε όριο ρυθμού (429). Δοκίμασε ξανά σε λίγο."
            case .server(let code, let message):
                return "Σφάλμα παρόχου \(code): \(message)"
            case .network(let detail):
                return "Πρόβλημα δικτύου: \(detail)"
            case .emptyResponse:
                return "Δεν επιστράφηκε κείμενο."
            case .unexpectedResponse(let path):
                return "Η απάντηση δεν έχει κείμενο στο «\(path)». Έλεγξε τη διαδρομή απάντησης στις Ρυθμίσεις."
            }
        }
    }

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 120
        session = URLSession(configuration: config)
    }

    func transcribe(wav: Data, language: Lang, provider: Provider, prompt: String?) async throws -> String {
        guard let apiKey = Keychain.apiKey(for: provider.id) else {
            throw TranscriberError.missingAPIKey(provider.name)
        }

        // Δύο επαναλήψεις με αυξανόμενη αναμονή. Παραπάνω δεν έχει νόημα: ο
        // χρήστης περιμένει να κολλήσει κείμενο, δεν περιμένει λεπτά.
        let delays: [UInt64] = [0, 1_000_000_000, 3_000_000_000]
        var lastError: Error = TranscriberError.emptyResponse

        for (attempt, delay) in delays.enumerated() {
            if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
            do {
                return try await send(wav: wav, language: language, provider: provider,
                                      prompt: prompt, apiKey: apiKey)
            } catch let error as TranscriberError {
                lastError = error
                switch error {
                case .rateLimited, .network, .server:
                    if attempt == delays.count - 1 { throw error }
                    continue        // παροδικό — αξίζει νέα προσπάθεια
                default:
                    throw error     // λάθος κλειδί ή λάθος ρύθμιση: η επανάληψη δεν αλλάζει τίποτα
                }
            }
        }
        throw lastError
    }

    // MARK: Αίτημα

    private func send(wav: Data, language: Lang, provider: Provider,
                      prompt: String?, apiKey: String) async throws -> String {
        guard let endpoint = provider.endpoint else { throw TranscriberError.badEndpoint }

        // Τα πεδία που ο πάροχος δέχεται. Ένα κενό όνομα πεδίου σημαίνει
        // «αυτός ο πάροχος δεν το υποστηρίζει» — και τότε δεν στέλνεται.
        var fields = provider.extraFields
        if !provider.modelField.isEmpty, !provider.model.isEmpty {
            fields[provider.modelField] = provider.model
        }
        if provider.supportsLanguageLock {
            fields[provider.languageField] = provider.languageStyle.code(for: language)
        }
        if !provider.promptField.isEmpty,
           let prompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fields[provider.promptField] = prompt
        }

        var request: URLRequest
        switch provider.requestStyle {
        case .multipart:
            request = URLRequest(url: endpoint)
            let boundary = "glossa-\(UUID().uuidString)"
            request.setValue("multipart/form-data; boundary=\(boundary)",
                             forHTTPHeaderField: "Content-Type")
            request.httpBody = Transcriber.multipartBody(fields: fields, wav: wav,
                                                         fileField: provider.fileField,
                                                         boundary: boundary)
        case .binary:
            // Ο ήχος πάει ωμός στο σώμα και οι παράμετροι στο query string.
            guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
                throw TranscriberError.badEndpoint
            }
            components.queryItems = (components.queryItems ?? [])
                + fields.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            guard let url = components.url else { throw TranscriberError.badEndpoint }
            request = URLRequest(url: url)
            request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
            request.httpBody = wav
        }

        request.httpMethod = "POST"
        applyAuth(provider.auth, key: apiKey, to: &request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TranscriberError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw TranscriberError.network("μη αναμενόμενη απάντηση")
        }

        switch http.statusCode {
        case 200...299:
            break
        case 401, 403:
            throw TranscriberError.unauthorized(provider.name)
        case 429:
            throw TranscriberError.rateLimited(provider.name)
        default:
            throw TranscriberError.server(http.statusCode, Transcriber.errorMessage(from: data))
        }

        guard let object = try? JSONSerialization.jsonObject(with: data) else {
            throw TranscriberError.emptyResponse
        }
        guard let text = Transcriber.value(at: provider.textPath, in: object) else {
            throw TranscriberError.unexpectedResponse(provider.textPath)
        }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TranscriberError.emptyResponse }
        return trimmed
    }

    private func applyAuth(_ auth: Provider.Auth, key: String, to request: inout URLRequest) {
        switch auth {
        case .bearer:
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        case .token:
            request.setValue("Token \(key)", forHTTPHeaderField: "Authorization")
        case .header(let name):
            request.setValue(key, forHTTPHeaderField: name)
        case .query(let name):
            guard let url = request.url,
                  var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            else { return }
            components.queryItems = (components.queryItems ?? []) + [URLQueryItem(name: name, value: key)]
            request.url = components.url
        }
    }

    // MARK: Σώμα και απάντηση

    private static func multipartBody(fields: [String: String], wav: Data,
                                      fileField: String, boundary: String) -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        // Ταξινομημένα, ώστε το σώμα να είναι ίδιο σε κάθε κλήση — βοηθάει
        // όταν συγκρίνεις αιτήματα σε ένα proxy για να βρεις τι πάει στραβά.
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"audio.wav\"\r\n")
        append("Content-Type: audio/wav\r\n\r\n")
        body.append(wav)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    /// Ακολουθεί μια διαδρομή με τελείες μέσα σε JSON. Οι αριθμοί είναι
    /// δείκτες πίνακα, ώστε να καλύπτονται και απαντήσεις σαν του Deepgram:
    /// `results.channels.0.alternatives.0.transcript`.
    static func value(at path: String, in json: Any) -> String? {
        var current: Any? = json
        for component in path.split(separator: ".") {
            switch current {
            case let dictionary as [String: Any]:
                current = dictionary[String(component)]
            case let array as [Any]:
                guard let index = Int(component), array.indices.contains(index) else { return nil }
                current = array[index]
            default:
                return nil
            }
        }
        if let text = current as? String { return text }
        // Κάποιοι πάροχοι δίνουν το κείμενο σε κομμάτια αντί για μία συμβολοσειρά.
        if let parts = current as? [String] { return parts.joined(separator: " ") }
        return nil
    }

    private static func errorMessage(from data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = object["error"] as? [String: Any], let message = error["message"] as? String {
                return message
            }
            if let message = object["error"] as? String { return message }
            if let message = object["message"] as? String { return message }
            if let detail = object["detail"] as? String { return detail }
        }
        return String(decoding: data.prefix(200), as: UTF8.self)
    }
}

// MARK: - Δοκιμή σύνδεσης

extension Transcriber {

    /// Στέλνει ένα δευτερόλεπτο σχεδόν σιωπής για να ελεγχθεί ό,τι μπορεί να
    /// είναι λάθος χωρίς να μιλήσει κανείς: URL, κλειδί, όνομα μοντέλου,
    /// ονόματα πεδίων και διαδρομή απάντησης. Κοστίζει ένα δευτερόλεπτο ήχου.
    func test(provider: Provider, language: Lang = .el) async -> String {
        // Καθαρή σιωπή κάνει κάποιους παρόχους να απαντήσουν με σφάλμα «κενό
        // αρχείο»· λίγος θόρυβος αποφεύγει τη σύγχυση με πραγματικό πρόβλημα.
        let count = Int(AudioRecorder.sampleRate)
        var samples = [Float](repeating: 0, count: count)
        for i in 0..<count {
            samples[i] = Float.random(in: -0.0015...0.0015)
        }
        let wav = WavWriter.encode(samples: samples)

        do {
            let text = try await transcribe(wav: wav, language: language,
                                            provider: provider, prompt: nil)
            let preview = text.count > 40 ? String(text.prefix(40)) + "…" : text
            return "OK — ο πάροχος απάντησε («\(preview)»)."
        } catch let error as TranscriberError {
            switch error {
            case .emptyResponse:
                // Κενό κείμενο από ένα δευτερόλεπτο σιωπής είναι η σωστή
                // απάντηση: η διαδρομή δικτύου και πιστοποίησης δούλεψε.
                return "OK — ο πάροχος απάντησε χωρίς κείμενο, όπως αναμενόταν για σιωπή."
            default:
                return error.localizedDescription
            }
        } catch {
            return error.localizedDescription
        }
    }
}
