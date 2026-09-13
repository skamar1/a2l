import AppKit
import CoreGraphics

/// Παράδοση του κειμένου στην εφαρμογή που έχει το focus.
enum TextInjector {

    private static let vKeyCode: CGKeyCode = 9   // V στο ANSI layout

    static func deliver(_ text: String, mode: OutputMode) {
        switch mode {
        case .clipboard:
            copy(text)
        case .paste:
            paste(text)
        case .typeText:
            type(text)
        }
    }

    static func copy(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    // MARK: Επικόλληση

    /// Βάζει το κείμενο στο πρόχειρο, στέλνει ⌘V και επαναφέρει το πρόχειρο.
    /// Η επαναφορά έχει σημασία: αλλιώς κάθε υπαγόρευση θα έσβηνε ό,τι είχε
    /// αντιγράψει ο χρήστης.
    private static func paste(_ text: String) {
        let pasteboard = NSPasteboard.general
        let snapshot = snapshotPasteboard(pasteboard)

        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // Μικρή αναμονή: αν ο χρήστης μόλις άφησε το πλήκτρο ομιλίας, το
        // σύστημα μπορεί να θεωρεί ακόμη πατημένο κάποιο modifier και το ⌘V
        // θα έφτανε παραμορφωμένο.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            postCommandV()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                restorePasteboard(pasteboard, from: snapshot)
            }
        }
    }

    private static func postCommandV() {
        let source = CGEventSource(stateID: .combinedSessionState)
        source?.setLocalEventsFilterDuringSuppressionState(
            [.permitLocalMouseEvents, .permitLocalKeyboardEvents],
            state: .eventSuppressionStateSuppressionInterval
        )

        guard
            let down = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false)
        else { return }

        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    // MARK: Πληκτρολόγηση

    /// Για εφαρμογές που αγνοούν το προγραμματιστικό ⌘V (κάποια terminals,
    /// απομακρυσμένες συνεδρίες). Πιο αργό, αλλά δεν αγγίζει το πρόχειρο.
    private static func type(_ text: String) {
        let source = CGEventSource(stateID: .combinedSessionState)

        // Σε δόσεις: ένα μόνο συμβάν με πολύ μεγάλο string χάνει χαρακτήρες.
        for chunk in Array(text.utf16).chunked(into: 16) {
            var buffer = chunk
            guard
                let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            else { continue }

            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: &buffer)
            up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: &buffer)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            usleep(3_000)
        }
    }

    // MARK: Πρόχειρο

    private struct PasteboardSnapshot {
        let items: [[NSPasteboard.PasteboardType: Data]]
    }

    private static func snapshotPasteboard(_ pasteboard: NSPasteboard) -> PasteboardSnapshot {
        let items = (pasteboard.pasteboardItems ?? []).map { item -> [NSPasteboard.PasteboardType: Data] in
            var stored: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { stored[type] = data }
            }
            return stored
        }
        return PasteboardSnapshot(items: items)
    }

    private static func restorePasteboard(_ pasteboard: NSPasteboard, from snapshot: PasteboardSnapshot) {
        guard !snapshot.items.isEmpty else { return }
        let restored = snapshot.items.map { stored -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in stored { item.setData(data, forType: type) }
            return item
        }
        pasteboard.clearContents()
        pasteboard.writeObjects(restored)
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
