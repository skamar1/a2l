import SwiftUI

/// Διαχείριση παρόχων — κοινή για macOS και iOS.
struct ProvidersView: View {
    @ObservedObject private var store = ProviderStore.shared
    @ObservedObject private var prefs = Preferences.shared

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(store.providers) { provider in
                        NavigationLink {
                            ProviderEditor(provider: provider)
                        } label: {
                            row(for: provider)
                        }
                    }
                } header: {
                    Text("Πάροχοι")
                } footer: {
                    Text("Ο επιλεγμένος πάροχος δέχεται τον ήχο. Κάθε πάροχος έχει "
                         + "δικό του κλειδί στο Keychain — μπορείς να τους αλλάζεις "
                         + "χωρίς να ξαναγράφεις κλειδιά.")
                }

                Section {
                    Button("Προσθήκη παρόχου") { store.addCustom() }
                    Button("Επαναφορά έτοιμων στις προεπιλογές") { store.restoreBuiltIns() }
                }
            }
            .navigationTitle("Πάροχοι")
        }
    }

    private func row(for provider: Provider) -> some View {
        HStack(alignment: .top) {
            Image(systemName: provider.id == prefs.providerID ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(provider.id == prefs.providerID ? Color.accentColor : .secondary)
                .onTapGesture { prefs.providerID = provider.id }

            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                Text(provider.model.isEmpty ? "— χωρίς μοντέλο —" : provider.model)
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Keychain.hasAPIKey(for: provider.id) ? "κλειδί ✓" : "χωρίς κλειδί")
                    .font(.caption)
                    .foregroundStyle(Keychain.hasAPIKey(for: provider.id) ? .green : .orange)
                if !provider.supportsLanguageLock {
                    Text("χωρίς κλείδωμα γλώσσας")
                        .font(.caption2).foregroundStyle(.orange)
                }
            }
        }
    }
}

/// Επεξεργασία ενός παρόχου. Κάθε πεδίο του πρωτοκόλλου είναι εδώ: αν ένα API
/// αλλάξει, δεν χρειάζεται νέα έκδοση της εφαρμογής.
struct ProviderEditor: View {
    @ObservedObject private var store = ProviderStore.shared
    @ObservedObject private var prefs = Preferences.shared

    @State private var draft: Provider
    @State private var apiKey: String
    @State private var authKind: Provider.AuthKind
    @State private var authName: String
    @State private var extras: String
    @State private var testing = false
    @State private var message: String?

    init(provider: Provider) {
        _draft = State(initialValue: provider)
        _apiKey = State(initialValue: Keychain.apiKey(for: provider.id) ?? "")
        _authKind = State(initialValue: provider.authKind)
        _authName = State(initialValue: provider.authName)
        _extras = State(initialValue: provider.extraFields
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "\n"))
    }

    var body: some View {
        Form {
            if !draft.note.isEmpty {
                Section { Text(draft.note).font(.caption) }
            }

            Section("Ταυτότητα") {
                TextField("Όνομα", text: $draft.name)
                TextField("Base URL", text: $draft.baseURL)
                TextField("Διαδρομή", text: $draft.path)
                TextField("Μοντέλο", text: $draft.model)
            }

            Section("Κλειδί") {
                SecureField("Κλειδί API", text: $apiKey)
                Picker("Τρόπος", selection: $authKind) {
                    ForEach(Provider.AuthKind.allCases) { Text($0.display).tag($0) }
                }
                if authKind.needsName {
                    TextField("Όνομα κεφαλίδας / παραμέτρου", text: $authName)
                }
            }

            Section("Πρωτόκολλο") {
                Picker("Μορφή αιτήματος", selection: $draft.requestStyle) {
                    Text("multipart/form-data").tag(Provider.RequestStyle.multipart)
                    Text("Ωμά bytes + query").tag(Provider.RequestStyle.binary)
                }
                TextField("Πεδίο αρχείου", text: $draft.fileField)
                TextField("Πεδίο μοντέλου", text: $draft.modelField)
                TextField("Πεδίο γλώσσας", text: $draft.languageField)
                Picker("Μορφή κωδικού γλώσσας", selection: $draft.languageStyle) {
                    Text("el / en").tag(Provider.LanguageStyle.iso639_1)
                    Text("el-GR / en-US").tag(Provider.LanguageStyle.bcp47)
                }
                TextField("Πεδίο λεξιλογίου", text: $draft.promptField)
                TextField("Διαδρομή κειμένου στην απάντηση", text: $draft.textPath)
                Text("Κενό όνομα πεδίου σημαίνει «ο πάροχος δεν το υποστηρίζει». "
                     + "Χωρίς πεδίο γλώσσας χάνεται το κλείδωμα και μένει μόνο ο "
                     + "έλεγχος αλφαβήτου.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Επιπλέον πεδία") {
                TextEditor(text: $extras)
                    .font(.system(.caption, design: .monospaced))
                    .frame(height: 80)
                Text("Ένα ανά γραμμή, σε μορφή κλειδί=τιμή.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                Button("Αποθήκευση") { save() }
                Button(testing ? "Δοκιμή…" : "Δοκιμή σύνδεσης") { runTest() }
                    .disabled(testing)
                if prefs.providerID != draft.id {
                    Button("Χρήση αυτού του παρόχου") {
                        save()
                        prefs.providerID = draft.id
                    }
                }
                if !draft.isBuiltIn {
                    Button("Διαγραφή", role: .destructive) {
                        Keychain.deleteAPIKey(for: draft.id)
                        store.remove(id: draft.id)
                    }
                }
                if let message {
                    Text(message).font(.caption)
                }
            }
        }
        .navigationTitle(draft.name)
    }

    private func save() {
        draft.setAuth(kind: authKind, name: authName)
        draft.extraFields = ProviderEditor.parseExtras(extras)
        store.upsert(draft)
        Keychain.setAPIKey(apiKey, for: draft.id)
        message = "Αποθηκεύτηκε."
    }

    private func runTest() {
        save()
        testing = true
        message = "Στέλνω ένα δευτερόλεπτο ήχου…"
        let provider = draft
        Task { @MainActor in
            message = await Transcriber().test(provider: provider)
            testing = false
        }
    }

    static func parseExtras(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            result[key] = value
        }
        return result
    }
}
