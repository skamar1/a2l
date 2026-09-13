import Foundation

struct Transcript: Identifiable {
    let id = UUID()
    let date: Date
    let text: String
    let language: Lang
    /// Πόσο σίγουρος ήταν ο ανιχνευτής (0–1), ή nil όταν η γλώσσα ήταν κλειδωμένη.
    let confidence: Double?
    let duration: Double
    /// `true` όταν το ScriptGuard αναγκάστηκε να αλλάξει γλώσσα.
    let corrected: Bool

    var summary: String {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        let short = flat.count > 60 ? String(flat.prefix(60)) + "…" : flat
        let mark = corrected ? "↺ " : ""
        return "\(mark)[\(language.rawValue)] \(short)"
    }
}

final class History {
    private(set) var items: [Transcript] = []
    private let limit = 30

    func add(_ item: Transcript) {
        items.insert(item, at: 0)
        if items.count > limit { items.removeLast(items.count - limit) }
    }

    func clear() { items.removeAll() }
}
