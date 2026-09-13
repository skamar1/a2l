import Foundation

/// Περιγραφή ενός παρόχου απομαγνητοφώνησης.
///
/// Δεν υπάρχει τίποτα καρφωμένο για το OpenAI: κάθε πάροχος είναι δεδομένα.
/// Οι έτοιμες επιλογές παρακάτω είναι απλώς προσυμπληρωμένες τιμές αυτής της
/// δομής — ό,τι μπορεί να κάνει μια από αυτές, μπορεί να το κάνει και ένας
/// πάροχος που θα προσθέσεις εσύ.
struct Provider: Codable, Identifiable, Hashable {

    // MARK: Τρόπος πιστοποίησης

    enum Auth: Codable, Hashable {
        /// `Authorization: Bearer <κλειδί>` — OpenAI, Groq, SiliconFlow, Fireworks…
        case bearer
        /// `Authorization: Token <κλειδί>` — Deepgram
        case token
        /// Δικό της κεφαλίδα, π.χ. `xi-api-key` — ElevenLabs
        case header(String)
        /// Παράμετρος στο URL. Τελευταία επιλογή: το κλειδί καταλήγει σε logs.
        case query(String)
    }

    // MARK: Μορφή αιτήματος

    enum RequestStyle: String, Codable, Hashable {
        /// `multipart/form-data` με πεδίο αρχείου — η συντριπτική πλειοψηφία.
        case multipart
        /// Ωμά bytes ήχου στο σώμα, παράμετροι στο query string — Deepgram.
        case binary
    }

    // MARK: Μορφή κωδικού γλώσσας

    enum LanguageStyle: String, Codable, Hashable {
        /// `el`, `en`
        case iso639_1
        /// `el-GR`, `en-US`
        case bcp47

        func code(for lang: Lang) -> String {
            switch self {
            case .iso639_1:
                return lang.rawValue
            case .bcp47:
                switch lang {
                case .el: return "el-GR"
                case .en: return "en-US"
                }
            }
        }
    }

    var id: String
    var name: String

    /// Χωρίς κάθετο στο τέλος, π.χ. `https://api.groq.com/openai/v1`.
    var baseURL: String
    /// Με κάθετο στην αρχή, π.χ. `/audio/transcriptions`.
    var path: String
    var model: String

    var auth: Auth
    var requestStyle: RequestStyle

    /// Το όνομα του πεδίου του αρχείου (`file`, `audio`…). Αγνοείται σε `binary`.
    var fileField: String
    /// Το πεδίο του μοντέλου (`model`, `model_id`…). Κενό = δεν στέλνεται.
    var modelField: String
    /// Το πεδίο της γλώσσας (`language`, `language_code`…). Κενό = ο πάροχος
    /// δεν δέχεται κλειδωμένη γλώσσα — τότε μένει μόνο το ScriptGuard.
    var languageField: String
    var languageStyle: LanguageStyle
    /// Το πεδίο του λεξιλογίου (`prompt`, `keywords`…). Κενό = δεν στέλνεται.
    var promptField: String

    /// Σταθερά πεδία που θέλει ο πάροχος (`response_format=json`, `smart_format=true`…).
    var extraFields: [String: String]

    /// Πού βρίσκεται το κείμενο στην απάντηση JSON, με τελείες. Οι αριθμοί
    /// είναι δείκτες πίνακα, π.χ.
    /// `results.channels.0.alternatives.0.transcript`.
    var textPath: String

    /// Σημείωση που φαίνεται στις Ρυθμίσεις — π.χ. ότι ένα μοντέλο δεν
    /// υποστηρίζει ελληνικά.
    var note: String

    var isBuiltIn: Bool

    init(id: String, name: String, baseURL: String, path: String, model: String,
                auth: Auth = .bearer, requestStyle: RequestStyle = .multipart,
                fileField: String = "file", modelField: String = "model",
                languageField: String = "language", languageStyle: LanguageStyle = .iso639_1,
                promptField: String = "prompt", extraFields: [String: String] = [:],
                textPath: String = "text", note: String = "", isBuiltIn: Bool = false) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
        self.path = path
        self.model = model
        self.auth = auth
        self.requestStyle = requestStyle
        self.fileField = fileField
        self.modelField = modelField
        self.languageField = languageField
        self.languageStyle = languageStyle
        self.promptField = promptField
        self.extraFields = extraFields
        self.textPath = textPath
        self.note = note
        self.isBuiltIn = isBuiltIn
    }

    // MARK: Βοηθήματα για το UI
    //
    // Το `Auth` έχει συνδεδεμένες τιμές, που δεν μπαίνουν σε Picker. Εδώ
    // σπάει σε «είδος» και «όνομα πεδίου», όπως το βλέπει ο χρήστης.

    enum AuthKind: String, CaseIterable, Identifiable {
        case bearer, token, header, query
        var id: String { rawValue }

        var display: String {
            switch self {
            case .bearer: return "Authorization: Bearer"
            case .token:  return "Authorization: Token"
            case .header: return "Δική της κεφαλίδα"
            case .query:  return "Παράμετρος URL"
            }
        }

        var needsName: Bool { self == .header || self == .query }
    }

    var authKind: AuthKind {
        switch auth {
        case .bearer:   return .bearer
        case .token:    return .token
        case .header:   return .header
        case .query:    return .query
        }
    }

    var authName: String {
        switch auth {
        case .header(let name), .query(let name): return name
        default: return ""
        }
    }

    mutating func setAuth(kind: AuthKind, name: String) {
        switch kind {
        case .bearer: auth = .bearer
        case .token:  auth = .token
        case .header: auth = .header(name.isEmpty ? "x-api-key" : name)
        case .query:  auth = .query(name.isEmpty ? "key" : name)
        }
    }

    var endpoint: URL? {
        URL(string: baseURL.trimmingTrailingSlash() + path)
    }

    /// `true` όταν ο πάροχος δέχεται κλειδωμένη γλώσσα. Χωρίς αυτό χάνεται το
    /// δεύτερο επίπεδο άμυνας και μένουν μόνο η τοπική αναγνώριση κι ο
    /// έλεγχος αλφαβήτου.
    var supportsLanguageLock: Bool { !languageField.isEmpty }
}

// MARK: - Έτοιμοι πάροχοι

extension Provider {

    /// Οι τιμές είναι σημείο εκκίνησης, όχι δόγμα: τα API αλλάζουν και κάθε
    /// πεδίο είναι επεξεργάσιμο στις Ρυθμίσεις.
    static let builtIns: [Provider] = [
        Provider(
            id: "openai",
            name: "OpenAI",
            baseURL: "https://api.openai.com/v1",
            path: "/audio/transcriptions",
            model: "gpt-4o-transcribe",
            extraFields: ["response_format": "json", "temperature": "0"],
            note: "Η καλύτερη ακρίβεια στα ελληνικά από όσα δοκιμάζονται εύκολα. "
                + "Εναλλακτικά μοντέλα: gpt-4o-mini-transcribe, whisper-1.",
            isBuiltIn: true
        ),
        Provider(
            id: "groq",
            name: "Groq",
            baseURL: "https://api.groq.com/openai/v1",
            path: "/audio/transcriptions",
            model: "whisper-large-v3-turbo",
            extraFields: ["response_format": "json", "temperature": "0"],
            note: "Ίδια βάρη Whisper, ~9 φορές φθηνότερα από το OpenAI και πολύ "
                + "γρήγορα. Κληρονομεί όμως και τις παραισθήσεις του Whisper στη σιωπή.",
            isBuiltIn: true
        ),
        Provider(
            id: "siliconflow",
            name: "SiliconFlow",
            baseURL: "https://api.siliconflow.cn/v1",
            path: "/audio/transcriptions",
            model: "FunAudioLLM/SenseVoiceSmall",
            languageField: "",
            promptField: "",
            note: "ΠΡΟΣΟΧΗ: το SenseVoiceSmall καλύπτει κινέζικα, καντονέζικα, "
                + "αγγλικά, ιαπωνικά και κορεάτικα — ΟΧΙ ελληνικά. Φθηνό, αλλά "
                + "άχρηστο για τη μισή σου χρήση.",
            isBuiltIn: true
        ),
        Provider(
            id: "elevenlabs",
            name: "ElevenLabs Scribe",
            baseURL: "https://api.elevenlabs.io/v1",
            path: "/speech-to-text",
            model: "scribe_v1",
            auth: .header("xi-api-key"),
            modelField: "model_id",
            languageField: "language_code",
            promptField: "",
            note: "Δεν το έχω επαληθεύσει σε ζωντανή κλήση — αν το API έχει "
                + "αλλάξει, διόρθωσε τα πεδία εδώ.",
            isBuiltIn: true
        ),
        Provider(
            id: "deepgram",
            name: "Deepgram",
            baseURL: "https://api.deepgram.com/v1",
            path: "/listen",
            model: "nova-3",
            auth: .token,
            requestStyle: .binary,
            promptField: "",
            extraFields: ["smart_format": "true"],
            textPath: "results.channels.0.alternatives.0.transcript",
            note: "Στέλνει ωμά bytes με παραμέτρους στο URL. Δεν το έχω "
                + "επαληθεύσει σε ζωντανή κλήση.",
            isBuiltIn: true
        ),
        Provider(
            id: "custom",
            name: "Δικός μου (συμβατός με OpenAI)",
            baseURL: "https://",
            path: "/audio/transcriptions",
            model: "",
            extraFields: ["response_format": "json"],
            note: "Για οποιονδήποτε πάροχο μιλάει τη διάλεκτο του OpenAI: "
                + "συμπλήρωσε base URL, μοντέλο και κλειδί.",
            isBuiltIn: true
        ),
    ]
}

extension String {
    func trimmingTrailingSlash() -> String {
        hasSuffix("/") ? String(dropLast()) : self
    }
}
