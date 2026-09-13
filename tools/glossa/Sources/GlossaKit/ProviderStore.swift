import Foundation

/// Η λίστα των παρόχων του χρήστη.
///
/// Αποθηκεύεται ολόκληρη, μαζί με τους έτοιμους: έτσι μια αλλαγή σε έτοιμο
/// πάροχο (νέο μοντέλο, αλλαγμένο endpoint) διατηρείται, χωρίς ξεχωριστό
/// μηχανισμό «παρακάμψεων» που θα έπρεπε να συγχωνεύεται σε κάθε εκκίνηση.
final class ProviderStore: ObservableObject {

    static let shared = ProviderStore()

    private static let key = "providers"

    @Published private(set) var providers: [Provider]

    private init() {
        if let data = Defaults.store.data(forKey: ProviderStore.key),
           let stored = try? JSONDecoder().decode([Provider].self, from: data),
           !stored.isEmpty {
            providers = stored
        } else {
            providers = Provider.builtIns
        }
    }

    func provider(id: String) -> Provider? {
        providers.first { $0.id == id }
    }

    /// Ο πάροχος που θα χρησιμοποιηθεί τώρα. Ποτέ nil: αν η επιλογή δείχνει σε
    /// πάροχο που σβήστηκε, πέφτουμε στον πρώτο της λίστας.
    func resolved(id: String) -> Provider {
        provider(id: id) ?? providers.first ?? Provider.builtIns[0]
    }

    func upsert(_ provider: Provider) {
        if let index = providers.firstIndex(where: { $0.id == provider.id }) {
            providers[index] = provider
        } else {
            providers.append(provider)
        }
        persist()
    }

    func remove(id: String) {
        // Ποτέ δεν μένει άδεια η λίστα — η εφαρμογή χωρίς πάροχο δεν κάνει τίποτα.
        guard providers.count > 1 else { return }
        providers.removeAll { $0.id == id }
        persist()
    }

    @discardableResult
    func addCustom(named name: String = "Νέος πάροχος") -> Provider {
        var new = Provider.builtIns.first { $0.id == "custom" } ?? Provider.builtIns[0]
        new.id = "custom-\(UUID().uuidString.prefix(8).lowercased())"
        new.name = name
        new.isBuiltIn = false
        new.note = ""
        upsert(new)
        return new
    }

    /// Επαναφέρει τους έτοιμους στις εργοστασιακές τιμές, κρατώντας τους
    /// δικούς σου. Τα κλειδιά στο Keychain δεν πειράζονται.
    func restoreBuiltIns() {
        let custom = providers.filter { !$0.isBuiltIn }
        providers = Provider.builtIns + custom
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(providers) else { return }
        Defaults.store.set(data, forKey: ProviderStore.key)
    }
}
