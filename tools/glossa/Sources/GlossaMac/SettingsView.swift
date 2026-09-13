import AppKit
import AVFoundation
import SwiftUI

struct SettingsView: View {
    @ObservedObject private var prefs = Preferences.shared
    @ObservedObject var controller: DictationController

    @State private var downloading = false
    @State private var downloadProgress: Double = 0
    @State private var message: String?
    @State private var modelInstalled = ModelStore.isInstalled

    var body: some View {
        TabView {
            general.tabItem { Label("Γενικά", systemImage: "gearshape") }
            ProvidersView().tabItem { Label("Πάροχοι", systemImage: "cloud") }
            languageTab.tabItem { Label("Γλώσσα", systemImage: "globe") }
            vocabulary.tabItem { Label("Λεξιλόγιο", systemImage: "text.book.closed") }
            permissions.tabItem { Label("Άδειες", systemImage: "lock.shield") }
        }
        .frame(width: 560, height: 480)
        .padding(.top, 8)
    }

    // MARK: Γενικά

    private var general: some View {
        Form {
            Section("Πάροχος") {
                HStack {
                    Text(prefs.provider.name)
                    Spacer()
                    Text(prefs.provider.model).foregroundStyle(.secondary)
                }
                Text(Keychain.hasAPIKey(for: prefs.providerID)
                     ? "Το κλειδί είναι αποθηκευμένο στο Keychain."
                     : "Δεν έχει οριστεί κλειδί — δες την καρτέλα «Πάροχοι».")
                    .font(.caption)
                    .foregroundStyle(Keychain.hasAPIKey(for: prefs.providerID) ? .secondary : .orange)
            }

            Section("Πλήκτρα") {
                Picker("Πλήκτρο ομιλίας (κράτα πατημένο)", selection: $prefs.triggerKey) {
                    ForEach(TriggerKey.allCases, id: \.self) { Text($0.display).tag($0) }
                }
                Toggle("Εναλλαγή με ⌃⌥⌘Space", isOn: $prefs.toggleHotkeyEnabled)
                Text("⌃⌥⌘R επαναλαμβάνει την τελευταία ηχογράφηση στην άλλη γλώσσα. "
                     + "Το Escape ακυρώνει όσο ηχογραφείς.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Έξοδος") {
                Picker("Παράδοση κειμένου", selection: $prefs.outputMode) {
                    ForEach(OutputMode.allCases, id: \.self) { Text($0.display).tag($0) }
                }
                Toggle("Ήχοι", isOn: $prefs.playSounds)
                HStack {
                    Text("Μέγιστη διάρκεια")
                    Slider(value: $prefs.maxSeconds, in: 15...600, step: 15)
                    Text("\(Int(prefs.maxSeconds))s").monospacedDigit().frame(width: 46, alignment: .trailing)
                }
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) { messageBar }
    }

    // MARK: Γλώσσα

    private var languageTab: some View {
        Form {
            Section("Επιλογή γλώσσας") {
                Picker("Λειτουργία", selection: $prefs.languageMode) {
                    ForEach(LanguageMode.allCases, id: \.self) { Text($0.display).tag($0) }
                }
                Picker("Σε αμφιβολία προτίμησε", selection: $prefs.ambiguousFallback) {
                    ForEach(Lang.allCases, id: \.self) { Text($0.display).tag($0) }
                }
                HStack {
                    Text("Κατώφλι βεβαιότητας")
                    Slider(value: $prefs.confidenceThreshold, in: 0.5...0.95, step: 0.05)
                    Text(String(format: "%.0f%%", prefs.confidenceThreshold * 100))
                        .monospacedDigit().frame(width: 46, alignment: .trailing)
                }
                Text("Κάτω από αυτό το όριο οι δύο γλώσσες θεωρούνται ισοπαλία και "
                     + "χρησιμοποιείται η εφεδρική επιλογή.")
                    .font(.caption).foregroundStyle(.secondary)

                Toggle("Έλεγχος αλφαβήτου στο αποτέλεσμα", isOn: $prefs.scriptGuardEnabled)
                Text("Αν το κείμενο γυρίσει σε λάθος αλφάβητο, ζητείται αυτόματα ξανά "
                     + "στην άλλη γλώσσα (διπλή χρέωση μόνο για εκείνη τη φορά).")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Τοπικό μοντέλο αναγνώρισης") {
                HStack {
                    Text("Κατάσταση")
                    Spacer()
                    Text(controller.detectorStatus.display)
                        .foregroundStyle(controller.detectorStatus.isReady ? .green : .orange)
                }
                HStack {
                    Text("Μοντέλο")
                    Spacer()
                    Text(modelInstalled ? (ModelStore.installedSize ?? "εγκατεστημένο") : "δεν βρέθηκε")
                        .foregroundStyle(.secondary)
                }
                if downloading {
                    ProgressView(value: downloadProgress)
                    Text(String(format: "Λήψη… %.0f%%", downloadProgress * 100))
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack {
                        Button(modelInstalled ? "Επαναλήψη λήψης" : "Λήψη μοντέλου (~75 MB)") {
                            downloadModel()
                        }
                        if modelInstalled {
                            Button("Διαγραφή") {
                                ModelStore.remove()
                                modelInstalled = false
                                message = "Το μοντέλο διαγράφηκε."
                            }
                        }
                    }
                }
                Text("Το ggml-tiny χρησιμοποιείται ΜΟΝΟ για να κριθεί «ελληνικά ή αγγλικά». "
                     + "Το κείμενο το παράγει πάντα το OpenAI.")
                    .font(.caption).foregroundStyle(.secondary)
                if !controller.detectorDiagnostics.isEmpty {
                    DisclosureGroup("Διαγνωστικά") {
                        ScrollView {
                            Text(controller.detectorDiagnostics)
                                .font(.system(.caption, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .frame(height: 90)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) { messageBar }
    }

    // MARK: Λεξιλόγιο

    private var vocabulary: some View {
        Form {
            Section("Ελληνικά") {
                TextEditor(text: $prefs.promptGreek)
                    .font(.system(.body, design: .default))
                    .frame(height: 120)
            }
            Section("English") {
                TextEditor(text: $prefs.promptEnglish)
                    .font(.system(.body, design: .default))
                    .frame(height: 120)
            }
            Section {
                Button("Επαναφορά προεπιλογών") {
                    prefs.promptGreek = Preferences.defaultGreekPrompt
                    prefs.promptEnglish = Preferences.defaultEnglishPrompt
                }
                Text("Γράψε φυσικές προτάσεις που περιέχουν τα ονόματα και τους όρους που "
                     + "λες συχνά. Το μοντέλο τα χρησιμοποιεί σαν δείγμα ορθογραφίας, "
                     + "όχι σαν εντολή.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Άδειες

    private var permissions: some View {
        Form {
            Section("Απαιτούμενες άδειες") {
                permissionRow(
                    title: "Μικρόφωνο",
                    granted: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
                    detail: "Για την ηχογράφηση.",
                    pane: "Privacy_Microphone"
                )
                permissionRow(
                    title: "Προσβασιμότητα",
                    granted: HotkeyManager.accessibilityTrusted(),
                    detail: "Για τα καθολικά πλήκτρα και την επικόλληση στην ενεργή εφαρμογή.",
                    pane: "Privacy_Accessibility"
                )
            }
            Section {
                Text("Μετά από κάθε νέο χτίσιμο της εφαρμογής το macOS μπορεί να ζητήσει "
                     + "ξανά την άδεια Προσβασιμότητας, επειδή αλλάζει η υπογραφή του "
                     + "εκτελέσιμου. Αν συμβεί, αφαίρεσε την παλιά καταχώριση «Glossa» "
                     + "από τη λίστα και πρόσθεσε ξανά τη νέα.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func permissionRow(title: String, granted: Bool, detail: String, pane: String) -> some View {
        HStack(alignment: .top) {
            Image(systemName: granted ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(granted ? .green : .red)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Άνοιγμα") {
                let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
                NSWorkspace.shared.open(url)
            }
        }
    }

    // MARK: Βοηθητικά

    @ViewBuilder
    private var messageBar: some View {
        if let message {
            Text(message)
                .font(.caption)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(.thinMaterial)
        }
    }

    private func downloadModel() {
        downloading = true
        downloadProgress = 0
        message = nil
        Task { @MainActor in
            do {
                try await ModelStore.download { downloadProgress = $0 }
                modelInstalled = ModelStore.isInstalled
                message = "Το μοντέλο κατέβηκε. Επανεκκίνηση του ανιχνευτή…"
                controller.warmUp()
            } catch {
                message = error.localizedDescription
            }
            downloading = false
        }
    }
}
