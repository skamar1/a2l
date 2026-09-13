import Foundation
import Security

/// Τα κλειδιά των παρόχων ζουν στο Keychain και πουθενά αλλού — ούτε σε
/// UserDefaults, ούτε σε αρχείο ρυθμίσεων, ούτε στα logs. Ένας λογαριασμός
/// ανά πάροχο, ώστε να μπορείς να έχεις ταυτόχρονα OpenAI, Groq και ό,τι άλλο.
enum Keychain {

    static let service = "gr.a2l.glossa"

    /// Στο iOS η εφαρμογή και το πληκτρολόγιο είναι ΔΥΟ διεργασίες· χωρίς
    /// κοινή ομάδα πρόσβασης το πληκτρολόγιο δεν βλέπει το κλειδί που
    /// αποθήκευσε η εφαρμογή. Ορίζεται στην εκκίνηση, μένει nil στο macOS.
    static var accessGroup: String?

    static func apiKey(for providerID: String) -> String? {
        read(account: account(for: providerID))
    }

    @discardableResult
    static func setAPIKey(_ key: String, for providerID: String) -> Bool {
        write(key, account: account(for: providerID))
    }

    @discardableResult
    static func deleteAPIKey(for providerID: String) -> Bool {
        delete(account: account(for: providerID))
    }

    static func hasAPIKey(for providerID: String) -> Bool {
        apiKey(for: providerID) != nil
    }

    private static func account(for providerID: String) -> String {
        "apikey.\(providerID)"
    }

    // MARK: Πρωτογενείς πράξεις

    private static func read(account: String) -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let key = String(data: data, encoding: .utf8),
              !key.isEmpty
        else { return nil }
        return key
    }

    private static func write(_ value: String, account: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return delete(account: account) }

        let data = Data(trimmed.utf8)
        let query = baseQuery(account: account)

        if SecItemUpdate(query as CFDictionary,
                         [kSecValueData as String: data] as CFDictionary) == errSecSuccess {
            return true
        }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    private static func delete(account: String) -> Bool {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    private static func baseQuery(account: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}
