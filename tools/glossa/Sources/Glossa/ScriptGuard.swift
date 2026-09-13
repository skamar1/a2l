import Foundation

/// Τελευταία γραμμή άμυνας: κοιτάζει το ΑΠΟΤΕΛΕΣΜΑ και ρωτάει «είναι γραμμένο
/// στο αλφάβητο που περιμέναμε;».
///
/// Ο ανιχνευτής γλώσσας μπορεί να πέσει έξω. Αν πέσει, το κείμενο γυρίζει σε
/// λάθος αλφάβητο και αυτό φαίνεται με βεβαιότητα — δεν χρειάζεται μοντέλο,
/// αρκεί να μετρήσεις γράμματα. Τότε ξαναζητάμε το κείμενο στην άλλη γλώσσα.
enum ScriptGuard {

    struct Counts {
        var greek = 0
        var latin = 0
        var other = 0
        var total: Int { greek + latin + other }
    }

    static func counts(in text: String) -> Counts {
        var c = Counts()
        for scalar in text.unicodeScalars {
            // Μας ενδιαφέρουν μόνο γράμματα: ψηφία, σημεία στίξης και emoji
            // είναι κοινά σε όλες τις γλώσσες και δεν λένε τίποτα.
            guard CharacterSet.letters.contains(scalar) else { continue }
            switch scalar.value {
            case 0x0370...0x03FF, 0x1F00...0x1FFF:      // Ελληνικά + πολυτονικά
                c.greek += 1
            case 0x0041...0x005A, 0x0061...0x007A,      // Basic Latin
                 0x00C0...0x024F:                        // Latin-1 / Extended
                c.latin += 1
            default:
                c.other += 1
            }
        }
        return c
    }

    /// `true` όταν το κείμενο διαψεύδει καθαρά τη γλώσσα που κλειδώσαμε.
    ///
    /// Το κατώφλι είναι επίτηδες αυστηρό. Στα ελληνικά τεχνικά συμφραζόμενα
    /// λέμε συνέχεια «κάνε deploy το SoftOne» — λατινικά γράμματα μέσα σε
    /// ελληνική πρόταση είναι ο κανόνας, όχι σφάλμα. Άρα μιλάμε για διάψευση
    /// μόνο όταν ΔΕΝ υπάρχει ούτε ένα ελληνικό γράμμα.
    static func contradicts(_ text: String, lockedTo lang: Lang) -> Bool {
        let c = counts(in: text)

        // Πολύ λίγα γράμματα («OK», «Ναι», «Zoom») δεν αποδεικνύουν τίποτα.
        guard c.total >= 8 else { return false }

        // Τρίτο αλφάβητο (κυριλλικά, CJK, αραβικά) σε ποσότητα σημαίνει ότι
        // κάτι πήγε πολύ στραβά, ό,τι γλώσσα κι αν είχαμε ζητήσει.
        if Double(c.other) / Double(c.total) > 0.20 { return true }

        switch lang {
        case .el:
            return c.greek == 0 && c.latin >= 8
        case .en:
            // Αντίστροφα, αγγλική πρόταση σχεδόν ποτέ δεν έχει ελληνικά
            // γράμματα· αν κυριαρχούν, μιλούσαμε ελληνικά.
            return Double(c.greek) / Double(c.total) > 0.60
        }
    }
}
