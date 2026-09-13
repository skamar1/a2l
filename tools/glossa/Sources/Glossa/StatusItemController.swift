import AppKit

/// Το εικονίδιο στη γραμμή μενού και το μενού του.
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let controller: DictationController
    private let prefs = Preferences.shared

    var onOpenSettings: (() -> Void)?

    init(controller: DictationController) {
        self.controller = controller
        super.init()

        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        refresh()
    }

    // MARK: Εικονίδιο

    func refresh() {
        guard let button = statusItem.button else { return }

        let (symbol, fallback, tint): (String, String, NSColor?) = {
            switch controller.state {
            case .idle:          return ("mic", "🎙", nil)
            case .recording:     return ("mic.fill", "🔴", .systemRed)
            case .detecting:     return ("waveform.badge.magnifyingglass", "…", .systemBlue)
            case .transcribing:  return ("waveform", "…", .systemBlue)
            case .error:         return ("exclamationmark.triangle.fill", "⚠️", .systemOrange)
            }
        }()

        if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Glossa") {
            image.isTemplate = (tint == nil)
            button.image = image
            button.title = ""
        } else {
            // Κάποια σύμβολα SF υπάρχουν μόνο σε νεότερες εκδόσεις· καλύτερα
            // ένα emoji παρά κενό εικονίδιο που δεν πατιέται.
            button.image = nil
            button.title = fallback
        }
        button.contentTintColor = tint
        button.toolTip = statusLine()
    }

    private func statusLine() -> String {
        switch controller.state {
        case .idle:
            return "Glossa — έτοιμο (\(prefs.languageMode.display))"
        case .recording:
            return "Ηχογράφηση…"
        case .detecting:
            return "Αναγνώριση γλώσσας…"
        case .transcribing(let lang):
            return "Απομαγνητοφώνηση (\(lang.display))…"
        case .error(let message):
            return message
        }
    }

    // MARK: Μενού

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        let header = NSMenuItem(title: statusLine(), action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)

        if case .failed(let why) = controller.detectorStatus {
            let warning = NSMenuItem(title: "Ανιχνευτής γλώσσας: \(why)", action: nil, keyEquivalent: "")
            warning.isEnabled = false
            menu.addItem(warning)
        } else if !controller.detectorStatus.isReady, prefs.languageMode == .auto {
            let warning = NSMenuItem(
                title: "Ανιχνευτής γλώσσας: \(controller.detectorStatus.display) — χρήση εφεδρικής (\(prefs.ambiguousFallback.display))",
                action: nil, keyEquivalent: ""
            )
            warning.isEnabled = false
            menu.addItem(warning)
        }

        menu.addItem(.separator())

        let toggleTitle = controller.isRecording ? "Διακοπή και απομαγνητοφώνηση" : "Έναρξη υπαγόρευσης"
        let toggle = NSMenuItem(title: toggleTitle, action: #selector(toggleDictation), keyEquivalent: " ")
        toggle.keyEquivalentModifierMask = [.control, .option, .command]
        toggle.target = self
        menu.addItem(toggle)

        let retry = NSMenuItem(title: "Επανάληψη στην άλλη γλώσσα",
                               action: #selector(retryOther), keyEquivalent: "r")
        retry.keyEquivalentModifierMask = [.control, .option, .command]
        retry.target = self
        menu.addItem(retry)

        menu.addItem(.separator())
        menu.addItem(languageMenuItem())
        menu.addItem(historyMenuItem())

        let minutes = controller.usageMinutesThisMonth
        let usage = NSMenuItem(title: String(format: "Χρήση μήνα: %.1f λεπτά ήχου", minutes),
                               action: nil, keyEquivalent: "")
        usage.isEnabled = false
        menu.addItem(usage)

        menu.addItem(.separator())

        let settings = NSMenuItem(title: "Ρυθμίσεις…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        let quit = NSMenuItem(title: "Έξοδος από το Glossa", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    private func languageMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "Γλώσσα", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        for mode in LanguageMode.allCases {
            let entry = NSMenuItem(title: mode.display, action: #selector(selectLanguageMode(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = mode.rawValue
            entry.state = (mode == prefs.languageMode) ? .on : .off
            submenu.addItem(entry)
        }
        item.submenu = submenu
        return item
    }

    private func historyMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "Ιστορικό", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        let items = controller.history.items

        if items.isEmpty {
            let empty = NSMenuItem(title: "— κενό —", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            submenu.addItem(empty)
        } else {
            for transcript in items {
                let entry = NSMenuItem(title: transcript.summary,
                                       action: #selector(copyTranscript(_:)), keyEquivalent: "")
                entry.target = self
                entry.representedObject = transcript.text
                entry.toolTip = transcript.text
                submenu.addItem(entry)
            }
            submenu.addItem(.separator())
            let clear = NSMenuItem(title: "Καθαρισμός ιστορικού",
                                   action: #selector(clearHistory), keyEquivalent: "")
            clear.target = self
            submenu.addItem(clear)
        }
        item.submenu = submenu
        return item
    }

    // MARK: Ενέργειες

    @objc private func toggleDictation() { controller.toggle() }
    @objc private func retryOther() { controller.retryInOtherLanguage() }
    @objc private func openSettings() { onOpenSettings?() }
    @objc private func clearHistory() { controller.history.clear() }

    @objc private func selectLanguageMode(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let mode = LanguageMode(rawValue: raw) else { return }
        prefs.languageMode = mode
        refresh()
    }

    @objc private func copyTranscript(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        TextInjector.copy(text)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

extension DictationController {
    var usageMinutesThisMonth: Double {
        Preferences.shared.secondsThisMonth / 60
    }
}
