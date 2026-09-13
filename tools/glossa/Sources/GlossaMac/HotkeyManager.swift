import AppKit
import ApplicationServices
import CoreGraphics

/// Καθολικά πλήκτρα μέσω CGEventTap.
///
/// Χρειαζόμαστε ούτως ή άλλως άδεια Προσβασιμότητας για να κάνουμε την
/// επικόλληση, οπότε το event tap δεν κοστίζει επιπλέον άδεια — και σε
/// αντάλλαγμα δίνει αυτό που το Carbon RegisterEventHotKey δεν δίνει:
/// ξεχωριστά συμβάντα πατήματος και αφήματος για ένα σκέτο modifier, δηλαδή
/// σωστό push-to-talk.
final class HotkeyManager {

    var onPushToTalkDown: (() -> Void)?
    var onPushToTalkUp: (() -> Void)?
    var onToggle: (() -> Void)?
    var onRetryOtherLanguage: (() -> Void)?
    var onCancel: (() -> Void)?

    /// Το Escape καταπίνεται μόνο όσο ηχογραφούμε· διαφορετικά θα χαλούσε
    /// κάθε άλλη εφαρμογή του συστήματος.
    var isRecording = false

    private(set) var isRunning = false
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var triggerKey: TriggerKey = .rightCommand
    private var toggleEnabled = true
    private var triggerIsDown = false

    private enum KeyCode {
        static let space: Int64 = 49
        static let r: Int64 = 15
        static let escape: Int64 = 53
    }

    // MARK: Άδεια

    static func accessibilityTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    static func promptForAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    // MARK: Κύκλος ζωής

    func configure(triggerKey: TriggerKey, toggleEnabled: Bool) {
        self.triggerKey = triggerKey
        self.toggleEnabled = toggleEnabled
        // Αν το πλήκτρο άλλαξε ενώ κρατιόταν πατημένο, το release δεν θα
        // ερχόταν ποτέ και θα μέναμε κολλημένοι σε «ηχογραφεί».
        if triggerIsDown {
            triggerIsDown = false
            onPushToTalkUp?()
        }
    }

    @discardableResult
    func start() -> Bool {
        guard !isRunning else { return true }
        guard HotkeyManager.accessibilityTrusted() else { return false }

        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, refcon in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(refcon).takeUnretainedValue()
                return manager.handle(type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            return false
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        self.tap = tap
        self.source = source
        isRunning = true
        return true
    }

    func stop() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
        isRunning = false
        triggerIsDown = false
    }

    // MARK: Χειρισμός συμβάντων

    private func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        // Το σύστημα απενεργοποιεί το tap αν αργήσουμε να απαντήσουμε. Χωρίς
        // αυτό, τα πλήκτρα απλώς σταματούν σιωπηλά να δουλεύουν.
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags

        if type == .flagsChanged {
            if keyCode == triggerKey.keyCode {
                let down = (flags.rawValue & triggerKey.deviceMask) != 0
                if down != triggerIsDown {
                    triggerIsDown = down
                    DispatchQueue.main.async { [weak self] in
                        if down {
                            self?.onPushToTalkDown?()
                        } else {
                            self?.onPushToTalkUp?()
                        }
                    }
                }
            }
            // Τα modifiers δεν καταπίνονται ποτέ: θα σπάγαμε κάθε συντόμευση
            // που τα χρησιμοποιεί μαζί με άλλο πλήκτρο.
            return Unmanaged.passUnretained(event)
        }

        guard type == .keyDown else { return Unmanaged.passUnretained(event) }

        if isRecording, keyCode == KeyCode.escape, !flags.contains(.maskCommand) {
            DispatchQueue.main.async { [weak self] in self?.onCancel?() }
            return nil
        }

        // ⌃⌥⌘ + Space / R — συνδυασμός με τρία modifiers ώστε να μη
        // συγκρούεται με το Spotlight, το Finder ή τους editors.
        let trio: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand]
        let hasTrio = flags.contains(trio) && !flags.contains(.maskShift)

        if toggleEnabled, hasTrio, keyCode == KeyCode.space {
            DispatchQueue.main.async { [weak self] in self?.onToggle?() }
            return nil
        }
        if hasTrio, keyCode == KeyCode.r {
            DispatchQueue.main.async { [weak self] in self?.onRetryOtherLanguage?() }
            return nil
        }

        return Unmanaged.passUnretained(event)
    }
}
