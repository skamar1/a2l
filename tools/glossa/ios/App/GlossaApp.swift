import SwiftUI

@main
struct GlossaApp: App {

    init() {
        // ΠΡΙΝ αγγίξει κανείς Preferences ή ProviderStore: αλλιώς η πρώτη
        // ανάγνωση πάει στο ιδιωτικό UserDefaults της εφαρμογής και το
        // πληκτρολόγιο δεν βλέπει ποτέ τις ρυθμίσεις.
        Defaults.configure(appGroup: AppIdentifiers.appGroup,
                           keychainAccessGroup: AppIdentifiers.keychainAccessGroup)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
