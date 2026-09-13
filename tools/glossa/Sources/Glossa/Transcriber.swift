import Foundation

/// Πελάτης του OpenAI `/v1/audio/transcriptions`.
///
/// Η γλώσσα στέλνεται ΠΑΝΤΑ ρητά. Αυτό είναι το σημείο όπου διορθώνεται το
/// αρχικό πρόβλημα: το μοντέλο δεν καλείται ποτέ να μαντέψει γλώσσα, άρα δεν
/// έχει καν τη δυνατότητα να γυρίσει κινέζικα.
final class Transcriber {

    enum TranscriberError: LocalizedError {
        case missingAPIKey
        case unauthorized
        case rateLimited
        case server(Int, String)
        case network(String)
        case emptyResponse

        var errorDescription: String? {
            switch self {
            case .missingAPIKey:
                return "Δεν έχει οριστεί κλειδί OpenAI. Ρυθμίσεις → Κλειδί API."
            case .unauthorized:
                return "Το κλειδί OpenAI απορρίφθηκε (401). Έλεγξέ το στις Ρυθμίσεις."
            case .rateLimited:
                return "Το OpenAI επέστρεψε όριο ρυθμού (429). Δοκίμασε ξανά σε λίγο."
            case .server(let code, let message):
                return "Σφάλμα OpenAI \(code): \(message)"
            case .network(let detail):
                return "Πρόβλημα δικτύου: \(detail)"
            case .emptyResponse:
                return "Δεν επιστράφηκε κείμενο."
            }
        }
    }

    private let endpoint = URL(string: "https://api.openai.com/v1/audio/transcriptions")!
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 120
        session = URLSession(configuration: config)
    }

    func transcribe(wav: Data, language: Lang, model: String, prompt: String?) async throws -> String {
        guard let apiKey = Keychain.readAPIKey() else { throw TranscriberError.missingAPIKey }

        // Δύο επαναλήψεις με αυξανόμενη αναμονή. Παραπάνω δεν έχει νόημα: ο
        // χρήστης περιμένει να κολλήσει κείμενο, δεν περιμένει λεπτά.
        let delays: [UInt64] = [0, 1_000_000_000, 3_000_000_000]
        var lastError: Error = TranscriberError.emptyResponse

        for (attempt, delay) in delays.enumerated() {
            if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
            do {
                return try await send(wav: wav, language: language, model: model,
                                      prompt: prompt, apiKey: apiKey)
            } catch let error as TranscriberError {
                lastError = error
                switch error {
                case .rateLimited, .network, .server:
                    if attempt == delays.count - 1 { throw error }
                    continue        // παροδικό — αξίζει νέα προσπάθεια
                default:
                    throw error     // 401 ή κενή απάντηση: η επανάληψη δεν αλλάζει τίποτα
                }
            }
        }
        throw lastError
    }

    // MARK: Αίτημα

    private func send(wav: Data, language: Lang, model: String,
                      prompt: String?, apiKey: String) async throws -> String {
        let boundary = "glossa-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var fields: [(String, String)] = [
            ("model", model),
            ("language", language.rawValue),
            ("response_format", "json"),
            ("temperature", "0"),
        ]
        if let prompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fields.append(("prompt", prompt))
        }

        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        for (name, value) in fields {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n")
        append("Content-Type: audio/wav\r\n\r\n")
        body.append(wav)
        append("\r\n--\(boundary)--\r\n")
        request.httpBody = body

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
        case 200:
            break
        case 401, 403:
            throw TranscriberError.unauthorized
        case 429:
            throw TranscriberError.rateLimited
        default:
            throw TranscriberError.server(http.statusCode, Transcriber.errorMessage(from: data))
        }

        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let text = object["text"] as? String
        else { throw TranscriberError.emptyResponse }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TranscriberError.emptyResponse }
        return trimmed
    }

    private static func errorMessage(from data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = object["error"] as? [String: Any],
           let message = error["message"] as? String {
            return message
        }
        return String(decoding: data.prefix(200), as: UTF8.self)
    }
}
