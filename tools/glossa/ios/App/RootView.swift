import UIKit
import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            DictateView()
                .tabItem { Label("Υπαγόρευση", systemImage: "mic") }
            ProvidersView()
                .tabItem { Label("Πάροχοι", systemImage: "cloud") }
            LanguageSettingsView()
                .tabItem { Label("Γλώσσα", systemImage: "globe") }
            SetupView()
                .tabItem { Label("Οδηγίες", systemImage: "questionmark.circle") }
        }
    }
}

// MARK: - Υπαγόρευση

struct DictateView: View {
    @StateObject private var dictation = IOSDictation()
    @ObservedObject private var prefs = Preferences.shared
    @State private var micAuthorized = IOSDictation.microphoneAuthorized

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Picker("Γλώσσα", selection: $prefs.languageMode) {
                    Text("Αυτόματα").tag(LanguageMode.auto)
                    Text("Ελληνικά").tag(LanguageMode.greek)
                    Text("English").tag(LanguageMode.english)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                Spacer()

                Button(action: { dictation.toggle() }) {
                    ZStack {
                        Circle()
                            .fill(isRecording ? Color.red : Color.accentColor)
                            .frame(width: 132, height: 132)
                            .scaleEffect(1 + CGFloat(dictation.level) * 0.18)
                            .animation(.easeOut(duration: 0.1), value: dictation.level)
                        Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 46))
                            .foregroundStyle(.white)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isWorking)

                Text(statusText)
                    .font(.callout)
                    .foregroundStyle(isError ? .red : .secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()

                if !dictation.lastText.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(dictation.lastText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack {
                            Button("Αντιγραφή") { UIPasteboard.general.string = dictation.lastText }
                            Spacer()
                            ShareLink(item: dictation.lastText)
                        }
                        .font(.callout)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal)
                }

                if !micAuthorized {
                    Button("Χορήγηση άδειας μικροφώνου") {
                        Task { micAuthorized = await IOSDictation.requestMicrophone() }
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.bottom)
                }
            }
            .padding(.vertical)
            .navigationTitle("Glossa")
        }
        .task {
            // Το πληκτρολόγιο δεν μπορεί να εμφανίσει το μήνυμα του
            // συστήματος· η άδεια πρέπει να δοθεί εδώ, μία φορά.
            if !micAuthorized { micAuthorized = await IOSDictation.requestMicrophone() }
        }
    }

    private var isRecording: Bool {
        if case .recording = dictation.state { return true }
        return false
    }

    private var isWorking: Bool {
        if case .working = dictation.state { return true }
        return false
    }

    private var isError: Bool {
        if case .error = dictation.state { return true }
        return false
    }

    private var statusText: String {
        switch dictation.state {
        case .idle:
            return prefs.languageMode == .auto
                ? "Πάτα και μίλα. Εικασία: \(prefs.stickyLanguage.display) — διορθώνεται αυτόματα."
                : "Πάτα και μίλα."
        case .recording:      return "Ηχογράφηση… πάτα ξανά για τέλος."
        case .working(let l): return "Απομαγνητοφώνηση (\(l.display))…"
        case .error(let m):   return m
        }
    }
}

// MARK: - Γλώσσα

struct LanguageSettingsView: View {
    @ObservedObject private var prefs = Preferences.shared

    var body: some View {
        NavigationStack {
            Form {
                Section("Επιλογή γλώσσας") {
                    Picker("Λειτουργία", selection: $prefs.languageMode) {
                        ForEach(LanguageMode.allCases, id: \.self) { Text($0.display).tag($0) }
                    }
                    Picker("Τρέχουσα εικασία", selection: $prefs.stickyLanguage) {
                        ForEach(Lang.allCases, id: \.self) { Text($0.display).tag($0) }
                    }
                    Toggle("Έλεγχος αλφαβήτου στο αποτέλεσμα", isOn: $prefs.scriptGuardEnabled)
                } footer: {
                    Text("Στο iPhone δεν τρέχει τοπικό μοντέλο αναγνώρισης — το όριο "
                         + "μνήμης ενός πληκτρολογίου δεν το σηκώνει. Στη θέση του, η "
                         + "γλώσσα κλειδώνεται σε αυτήν που δούλεψε τελευταία και ο "
                         + "έλεγχος αλφαβήτου τη διορθώνει όταν αλλάξεις γλώσσα. Το "
                         + "τίμημα είναι μία διπλή χρέωση στην πρώτη πρόταση μετά την "
                         + "αλλαγή, όχι σε κάθε πρόταση.")
                }

                Section("Λεξιλόγιο (Ελληνικά)") {
                    TextEditor(text: $prefs.promptGreek).frame(height: 110)
                }
                Section("Λεξιλόγιο (English)") {
                    TextEditor(text: $prefs.promptEnglish).frame(height: 110)
                }

                Section("Χρήση") {
                    Text(String(format: "%.1f λεπτά ήχου αυτόν τον μήνα",
                                prefs.secondsThisMonth / 60))
                }
            }
            .navigationTitle("Γλώσσα")
        }
    }
}

// MARK: - Οδηγίες

struct SetupView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Ενεργοποίηση πληκτρολογίου") {
                    Label("Ρυθμίσεις → Γενικά → Πληκτρολόγιο → Πληκτρολόγια", systemImage: "1.circle")
                    Label("Προσθήκη νέου πληκτρολογίου → Glossa", systemImage: "2.circle")
                    Label("Άγγιξε το Glossa → ενεργοποίησε το «Πλήρης πρόσβαση»", systemImage: "3.circle")
                }
                Section {
                    Text("Το «Πλήρης πρόσβαση» χρειάζεται επειδή το πληκτρολόγιο πρέπει "
                         + "να στείλει τον ήχο στον πάροχο· χωρίς αυτό, τα πληκτρολόγια "
                         + "iOS δεν έχουν δίκτυο.")
                        .font(.caption)
                }
                Section("Πριν την πρώτη χρήση") {
                    Label("Δώσε άδεια μικροφώνου από την καρτέλα Υπαγόρευση", systemImage: "mic")
                    Label("Βάλε κλειδί παρόχου στην καρτέλα Πάροχοι", systemImage: "key")
                }
            }
            .navigationTitle("Οδηγίες")
        }
    }
}
