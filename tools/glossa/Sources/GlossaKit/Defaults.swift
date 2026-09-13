import Foundation

/// Πού γράφονται οι ρυθμίσεις.
///
/// Στο macOS είναι απλώς το `UserDefaults.standard`. Στο iOS η εφαρμογή και το
/// πληκτρολόγιο είναι δύο διεργασίες, οπότε πρέπει να μοιράζονται App Group —
/// αλλιώς ρυθμίζεις γλώσσα στην εφαρμογή και το πληκτρολόγιο δεν το μαθαίνει ποτέ.
enum Defaults {

    /// Ορίζεται ΠΡΙΝ αγγίξει κανείς το `Preferences.shared` ή το
    /// `ProviderStore.shared`, αλλιώς η πρώτη ανάγνωση πάει στο λάθος μέρος.
    private(set) static var suiteName: String?
    private static var cached: UserDefaults?

    static func configure(appGroup: String?, keychainAccessGroup: String? = nil) {
        suiteName = appGroup
        cached = appGroup.flatMap(UserDefaults.init(suiteName:))
        Keychain.accessGroup = keychainAccessGroup
    }

    static var store: UserDefaults { cached ?? .standard }
}
