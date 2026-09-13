// swift-tools-version: 5.9
import PackageDescription

// Ένα module, δύο φάκελοι: το GlossaKit είναι ο κοινός πυρήνας που μοιράζεται
// με την εφαρμογή iOS (το Xcode project το τραβάει σαν πηγαία αρχεία), το
// GlossaMac είναι ό,τι μιλάει AppKit. Δεν είναι ξεχωριστό library target
// επίτηδες: ένα όριο module θα σήμαινε `public` σε κάθε τύπο, χωρίς κανένα
// κέρδος για δύο εφαρμογές που χτίζονται μαζί.
//
// Η εφαρμογή δεν έχει native εξαρτήσεις. Το whisper.cpp ζει αποκλειστικά στο
// ξεχωριστό εκτελέσιμο glossa-lid (lid/build.sh).
let package = Package(
    name: "Glossa",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Glossa",
            path: "Sources",
            sources: ["GlossaKit", "GlossaMac"]
        )
    ]
)
