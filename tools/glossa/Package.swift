// swift-tools-version: 5.9
import PackageDescription

// Η εφαρμογή είναι καθαρή Swift, χωρίς native εξαρτήσεις. Το whisper.cpp
// ζει αποκλειστικά μέσα στο ξεχωριστό εκτελέσιμο glossa-lid (lid/build.sh),
// ώστε ένα πρόβλημα στο cmake build να μη μπορεί ποτέ να χαλάσει το build
// της εφαρμογής — και η εφαρμογή να τρέχει, με μειωμένες δυνατότητες, ακόμη
// κι αν ο βοηθός λείπει.
let package = Package(
    name: "Glossa",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "Glossa", path: "Sources/Glossa")
    ]
)
