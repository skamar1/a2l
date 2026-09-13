import Foundation

// MARK: - Γλώσσα

/// Οι γλώσσες που υποστηρίζει η εφαρμογή. Το ότι ο τύπος έχει ΑΚΡΙΒΩΣ δύο
/// τιμές είναι το κεντρικό σχεδιαστικό στοίχημα: όσο η γλώσσα εκφράζεται με
/// αυτόν τον τύπο, είναι αδύνατο να ζητηθεί από το API κινέζικα.
enum Lang: String, CaseIterable, Codable {
    case el
    case en

    var display: String {
        switch self {
        case .el: return "Ελληνικά"
        case .en: return "English"
        }
    }

    var other: Lang {
        switch self {
        case .el: return .en
        case .en: return .el
        }
    }
}

enum LanguageMode: String, CaseIterable {
    case auto
    case greek
    case english

    var display: String {
        switch self {
        case .auto:    return "Αυτόματα (Ελληνικά / English)"
        case .greek:   return "Πάντα Ελληνικά"
        case .english: return "Πάντα English"
        }
    }

    /// nil σημαίνει «να αποφασίσει ο ανιχνευτής».
    var forced: Lang? {
        switch self {
        case .auto:    return nil
        case .greek:   return .el
        case .english: return .en
        }
    }
}

// MARK: - Έξοδος

enum OutputMode: String, CaseIterable {
    case paste
    case typeText
    case clipboard

    var display: String {
        switch self {
        case .paste:     return "Επικόλληση (⌘V) στην ενεργή εφαρμογή"
        case .typeText:  return "Πληκτρολόγηση χαρακτήρα-χαρακτήρα"
        case .clipboard: return "Μόνο αντιγραφή στο πρόχειρο"
        }
    }
}

// MARK: - Πλήκτρο ομιλίας

/// Πλήκτρα τροποποίησης που δεν παράγουν χαρακτήρα από μόνα τους, άρα
/// μπορούν να κρατηθούν πατημένα σαν push-to-talk χωρίς παρενέργειες.
enum TriggerKey: String, CaseIterable {
    case rightCommand
    case rightOption
    case rightControl
    case rightShift
    case fn

    var display: String {
        switch self {
        case .rightCommand: return "Δεξί ⌘ Command"
        case .rightOption:  return "Δεξί ⌥ Option"
        case .rightControl: return "Δεξί ⌃ Control"
        case .rightShift:   return "Δεξί ⇧ Shift"
        case .fn:           return "fn"
        }
    }

    var keyCode: Int64 {
        switch self {
        case .rightShift:   return 60
        case .rightCommand: return 54
        case .rightOption:  return 61
        case .rightControl: return 62
        case .fn:           return 63
        }
    }

    /// Το bit που δηλώνει «αυτό ΤΟ πλήκτρο είναι κάτω». Τα γενικά masks
    /// (.maskCommand κ.λπ.) δεν κάνουν: αν κρατάς αριστερό ⌘ και αφήσεις το
    /// δεξί, το γενικό bit παραμένει αναμμένο και το release χάνεται.
    var deviceMask: UInt64 {
        switch self {
        case .rightShift:   return 0x0000_0004   // NX_DEVICERSHIFTKEYMASK
        case .rightCommand: return 0x0000_0010   // NX_DEVICERCMDKEYMASK
        case .rightOption:  return 0x0000_0040   // NX_DEVICERALTKEYMASK
        case .rightControl: return 0x0000_2000   // NX_DEVICERCTLKEYMASK
        case .fn:           return 0x0080_0000   // NX_SECONDARYFNMASK
        }
    }
}

// MARK: - Ρυθμίσεις

final class Preferences: ObservableObject {
    static let shared = Preferences()

    private let defaults = UserDefaults.standard

    @Published var languageMode: LanguageMode { didSet { set(languageMode.rawValue, "languageMode") } }
    @Published var ambiguousFallback: Lang    { didSet { set(ambiguousFallback.rawValue, "ambiguousFallback") } }
    @Published var confidenceThreshold: Double { didSet { set(confidenceThreshold, "confidenceThreshold") } }

    @Published var model: String              { didSet { set(model, "model") } }
    @Published var promptGreek: String        { didSet { set(promptGreek, "promptGreek") } }
    @Published var promptEnglish: String      { didSet { set(promptEnglish, "promptEnglish") } }

    @Published var triggerKey: TriggerKey     { didSet { set(triggerKey.rawValue, "triggerKey") } }
    @Published var toggleHotkeyEnabled: Bool  { didSet { set(toggleHotkeyEnabled, "toggleHotkeyEnabled") } }
    @Published var outputMode: OutputMode     { didSet { set(outputMode.rawValue, "outputMode") } }

    @Published var maxSeconds: Double         { didSet { set(maxSeconds, "maxSeconds") } }
    @Published var minSeconds: Double         { didSet { set(minSeconds, "minSeconds") } }
    @Published var playSounds: Bool           { didSet { set(playSounds, "playSounds") } }
    @Published var scriptGuardEnabled: Bool   { didSet { set(scriptGuardEnabled, "scriptGuardEnabled") } }

    /// Δευτερόλεπτα ήχου που στάλθηκαν στο API — για μια χονδρική εικόνα κόστους.
    @Published var secondsThisMonth: Double   { didSet { set(secondsThisMonth, "secondsThisMonth") } }
    @Published var usageMonth: String         { didSet { set(usageMonth, "usageMonth") } }

    /// Τα διαθέσιμα μοντέλα απομαγνητοφώνησης του OpenAI, από το πιο ακριβές
    /// προς το πιο φθηνό.
    static let availableModels = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"]

    private init() {
        // Τοπική αναφορά, όχι self.defaults: μέσα στο init το self δεν
        // επιτρέπεται να διαφύγει σε ένθετη συνάρτηση πριν αρχικοποιηθούν
        // όλα τα μέλη.
        let store = UserDefaults.standard

        func str(_ key: String, _ fallback: String) -> String {
            store.string(forKey: key) ?? fallback
        }
        func num(_ key: String, _ fallback: Double) -> Double {
            store.object(forKey: key) as? Double ?? fallback
        }
        func flag(_ key: String, _ fallback: Bool) -> Bool {
            store.object(forKey: key) as? Bool ?? fallback
        }

        languageMode        = LanguageMode(rawValue: str("languageMode", "auto")) ?? .auto
        ambiguousFallback   = Lang(rawValue: str("ambiguousFallback", "el")) ?? .el
        confidenceThreshold = num("confidenceThreshold", 0.60)
        model               = str("model", "gpt-4o-transcribe")
        promptGreek         = str("promptGreek", Preferences.defaultGreekPrompt)
        promptEnglish       = str("promptEnglish", Preferences.defaultEnglishPrompt)
        triggerKey          = TriggerKey(rawValue: str("triggerKey", "rightCommand")) ?? .rightCommand
        toggleHotkeyEnabled = flag("toggleHotkeyEnabled", true)
        outputMode          = OutputMode(rawValue: str("outputMode", "paste")) ?? .paste
        maxSeconds          = num("maxSeconds", 120)
        minSeconds          = num("minSeconds", 0.4)
        playSounds          = flag("playSounds", true)
        scriptGuardEnabled  = flag("scriptGuardEnabled", true)
        secondsThisMonth    = num("secondsThisMonth", 0)
        usageMonth          = str("usageMonth", Preferences.currentMonthKey())
    }

    private func set(_ value: Any, _ key: String) {
        defaults.set(value, forKey: key)
    }

    // MARK: Λεξιλόγιο

    /// Το `prompt` του Whisper δεν είναι εντολή· είναι δείγμα κειμένου που
    /// σπρώχνει τον αποκωδικοποιητή προς συγκεκριμένη ορθογραφία. Γι' αυτό
    /// γράφεται σαν φυσική πρόταση, όχι σαν λίστα.
    static let defaultGreekPrompt =
        "Συζήτηση για μηχανογράφηση επιχειρήσεων: SoftOne, EntersoftOne, Entersoft, Megasoft, "
        + "Dynasoft, Qorrect, A2 Labs, Skroutz, WooCommerce, WordPress, Cloudflare, τιμολόγιο, "
        + "ΑΦΜ, ΔΟΥ, myDATA, παραστατικό, αποθήκη, πελατολόγιο, backup, deploy."

    static let defaultEnglishPrompt =
        "A conversation about business software and web development: SoftOne, EntersoftOne, "
        + "Megasoft, Qorrect, A2 Labs, Skroutz, WooCommerce, WordPress, Cloudflare, Hugo, "
        + "C#, .NET, Keyboard Maestro, 1Password, TextExpander, repository, deploy, invoice."

    func prompt(for lang: Lang) -> String {
        switch lang {
        case .el: return promptGreek
        case .en: return promptEnglish
        }
    }

    // MARK: Χρήση

    static func currentMonthKey() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM"
        return f.string(from: Date())
    }

    func addUsage(seconds: Double) {
        let month = Preferences.currentMonthKey()
        if month != usageMonth {
            usageMonth = month
            secondsThisMonth = 0
        }
        secondsThisMonth += seconds
    }
}
