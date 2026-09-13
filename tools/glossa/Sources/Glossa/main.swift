import AppKit

// Εφαρμογή μόνο γραμμής μενού: χωρίς εικονίδιο στο Dock, χωρίς παράθυρο στην
// εκκίνηση. Το ίδιο δηλώνει και το LSUIElement στο Info.plist — εδώ το
// επαναλαμβάνουμε ώστε να ισχύει και όταν τρέχει με `swift run`, εκτός bundle.
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
