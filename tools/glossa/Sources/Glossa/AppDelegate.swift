import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var controller: DictationController!
    private var statusItem: StatusItemController!
    private let hotkeys = HotkeyManager()
    private var settingsWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()
    private var accessibilityTimer: Timer?
    private let prefs = Preferences.shared

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = DictationController()
        self.controller = controller

        statusItem = StatusItemController(controller: controller)
        statusItem.onOpenSettings = { [weak self] in
            Task { @MainActor in self?.showSettings() }
        }

        controller.onStateChange = { [weak self] in
            guard let self else { return }
            self.statusItem.refresh()
            self.hotkeys.isRecording = self.controller.isRecording
        }

        wireHotkeys()
        observePreferences()

        controller.warmUp()
        presentFirstRunIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) {
        accessibilityTimer?.invalidate()
        hotkeys.stop()
        controller?.shutdown()
    }

    // MARK: Πλήκτρα

    private func wireHotkeys() {
        // Τα callbacks έρχονται από το event tap, όχι από το UI, γι' αυτό
        // περνούν ρητά στον main actor πριν αγγίξουν τον controller.
        hotkeys.onPushToTalkDown = { [weak self] in
            Task { @MainActor in self?.controller.startRecording() }
        }
        hotkeys.onPushToTalkUp = { [weak self] in
            Task { @MainActor in self?.controller.stopAndProcess() }
        }
        hotkeys.onToggle = { [weak self] in
            Task { @MainActor in self?.controller.toggle() }
        }
        hotkeys.onRetryOtherLanguage = { [weak self] in
            Task { @MainActor in self?.controller.retryInOtherLanguage() }
        }
        hotkeys.onCancel = { [weak self] in
            Task { @MainActor in self?.controller.cancelRecording() }
        }

        applyHotkeySettings()
        _ = hotkeys.start()
    }

    private func applyHotkeySettings() {
        hotkeys.configure(triggerKey: prefs.triggerKey, toggleEnabled: prefs.toggleHotkeyEnabled)
    }

    private func observePreferences() {
        // Το objectWillChange χτυπάει ΠΡΙΝ γραφτεί η νέα τιμή· η ανάγνωση
        // αναβάλλεται για τον επόμενο κύκλο του run loop ώστε να δούμε τη νέα.
        prefs.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.applyHotkeySettings()
                    self.statusItem.refresh()
                }
            }
            .store(in: &cancellables)
    }

    // MARK: Πρώτη εκκίνηση

    private func presentFirstRunIfNeeded() {
        if !HotkeyManager.accessibilityTrusted() {
            HotkeyManager.promptForAccessibility()
            waitForAccessibility()
        }

        if Keychain.readAPIKey() == nil || !ModelStore.isInstalled {
            showSettings()
        }
    }

    /// Το event tap δεν μπορεί να δημιουργηθεί πριν δοθεί η άδεια. Αντί να
    /// ζητάμε από τον χρήστη να κάνει επανεκκίνηση, δοκιμάζουμε περιοδικά.
    private func waitForAccessibility() {
        accessibilityTimer?.invalidate()
        accessibilityTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { timer in
            Task { @MainActor [weak self] in
                guard let self else {
                    timer.invalidate()
                    return
                }
                guard HotkeyManager.accessibilityTrusted() else { return }
                timer.invalidate()
                self.accessibilityTimer = nil
                self.applyHotkeySettings()
                _ = self.hotkeys.start()
                self.statusItem.refresh()
            }
        }
    }

    // MARK: Ρυθμίσεις

    private func showSettings() {
        if let window = settingsWindow {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 480),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Glossa — Ρυθμίσεις"
        window.contentView = NSHostingView(rootView: SettingsView(controller: controller))
        window.isReleasedWhenClosed = false
        window.center()

        settingsWindow = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}
