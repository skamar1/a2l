import Combine
import UIKit

/// Το πληκτρολόγιο υπαγόρευσης: ένα μικρόφωνο, τρία κουμπιά γλώσσας και το
/// κείμενο πάει κατευθείαν στο πεδίο της εφαρμογής που έχεις μπροστά σου.
///
/// Δεν φορτώνει μοντέλο. Ένα πληκτρολόγιο iOS δουλεύει με πολύ σφιχτό όριο
/// μνήμης, οπότε εδώ γίνεται μόνο ηχογράφηση και μία κλήση HTTP — τα βαριά
/// μένουν στον πάροχο.
final class KeyboardViewController: UIInputViewController {

    private let dictation = IOSDictation()
    private var cancellables = Set<AnyCancellable>()

    private let micButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let languageControl = UISegmentedControl(items: ["Αυτόματα", "ΕΛ", "EN"])
    private let globeButton = UIButton(type: .system)
    private let deleteButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()

        // ΠΡΙΝ αγγίξει κανείς Preferences: αλλιώς το πληκτρολόγιο διαβάζει
        // δικές του, άδειες ρυθμίσεις και δεν βρίσκει ούτε πάροχο ούτε κλειδί.
        Defaults.configure(appGroup: AppIdentifiers.appGroup,
                           keychainAccessGroup: AppIdentifiers.keychainAccessGroup)

        buildInterface()
        bind()
        syncLanguageControl()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Το πληκτρολόγιο μπορεί να κλείσει στη μέση μιας πρότασης· αφήνουμε
        // το μικρόφωνο αντί να το κρατάμε ανοιχτό στο παρασκήνιο.
        dictation.cancel()
    }

    // MARK: Διεπαφή

    private func buildInterface() {
        view.backgroundColor = .clear

        languageControl.addTarget(self, action: #selector(languageChanged), for: .valueChanged)

        configure(micButton, systemImage: "mic.fill", pointSize: 34)
        micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
        micButton.tintColor = .white
        micButton.backgroundColor = .systemBlue
        micButton.layer.cornerRadius = 36

        configure(globeButton, systemImage: "globe", pointSize: 20)
        globeButton.addTarget(self, action: #selector(handleInputModeList(from:with:)),
                              for: .allTouchEvents)

        configure(deleteButton, systemImage: "delete.left", pointSize: 20)
        deleteButton.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)

        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 2
        statusLabel.adjustsFontSizeToFitWidth = true

        let bottomRow = UIStackView(arrangedSubviews: [globeButton, UIView(), deleteButton])
        bottomRow.axis = .horizontal
        bottomRow.distribution = .fill

        let stack = UIStackView(arrangedSubviews: [languageControl, micButton, statusLabel, bottomRow])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -8),

            languageControl.leadingAnchor.constraint(equalTo: stack.leadingAnchor),
            languageControl.trailingAnchor.constraint(equalTo: stack.trailingAnchor),
            bottomRow.leadingAnchor.constraint(equalTo: stack.leadingAnchor),
            bottomRow.trailingAnchor.constraint(equalTo: stack.trailingAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: stack.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: stack.trailingAnchor),

            micButton.widthAnchor.constraint(equalToConstant: 72),
            micButton.heightAnchor.constraint(equalToConstant: 72),

            // Τα πληκτρολόγια δεν παίρνουν ύψος από το περιεχόμενό τους —
            // πρέπει να το ζητήσουν ρητά.
            view.heightAnchor.constraint(equalToConstant: 248),
        ])
    }

    private func configure(_ button: UIButton, systemImage: String, pointSize: CGFloat) {
        let config = UIImage.SymbolConfiguration(pointSize: pointSize, weight: .medium)
        button.setImage(UIImage(systemName: systemImage, withConfiguration: config), for: .normal)
        button.translatesAutoresizingMaskIntoConstraints = false
    }

    // MARK: Σύνδεση

    private func bind() {
        dictation.onText = { [weak self] text in
            guard let self else { return }
            // Ένα κενό μπροστά, όταν η πρόταση δεν ξεκινά τώρα: αλλιώς το
            // κείμενο κολλάει στην προηγούμενη λέξη.
            let before = self.textDocumentProxy.documentContextBeforeInput ?? ""
            let needsSpace = !before.isEmpty && !before.hasSuffix(" ") && !before.hasSuffix("\n")
            self.textDocumentProxy.insertText(needsSpace ? " " + text : text)
        }

        dictation.statePublisher
            .receive(on: RunLoop.main)
            .sink { [weak self] state in self?.render(state) }
            .store(in: &cancellables)

        dictation.levelPublisher
            .receive(on: RunLoop.main)
            .sink { [weak self] level in
                guard let self, self.dictation.isRecording else { return }
                let scale = 1 + CGFloat(level) * 0.16
                self.micButton.transform = CGAffineTransform(scaleX: scale, y: scale)
            }
            .store(in: &cancellables)
    }

    private func render(_ state: IOSDictation.State) {
        switch state {
        case .idle:
            micButton.backgroundColor = .systemBlue
            micButton.isEnabled = true
            micButton.transform = .identity
            statusLabel.textColor = .secondaryLabel
            statusLabel.text = Preferences.shared.languageMode == .auto
                ? "Εικασία: \(Preferences.shared.stickyLanguage.display)"
                : Preferences.shared.languageMode.display
        case .recording:
            micButton.backgroundColor = .systemRed
            micButton.isEnabled = true
            statusLabel.textColor = .secondaryLabel
            statusLabel.text = "Ηχογράφηση… πάτα ξανά για τέλος"
        case .working(let language):
            micButton.backgroundColor = .systemGray
            micButton.isEnabled = false
            micButton.transform = .identity
            statusLabel.textColor = .secondaryLabel
            statusLabel.text = "Απομαγνητοφώνηση (\(language.display))…"
        case .error(let message):
            micButton.backgroundColor = .systemBlue
            micButton.isEnabled = true
            micButton.transform = .identity
            statusLabel.textColor = .systemRed
            statusLabel.text = message
        }
    }

    private func syncLanguageControl() {
        switch Preferences.shared.languageMode {
        case .auto:    languageControl.selectedSegmentIndex = 0
        case .greek:   languageControl.selectedSegmentIndex = 1
        case .english: languageControl.selectedSegmentIndex = 2
        }
    }

    // MARK: Ενέργειες

    @objc private func micTapped() {
        dictation.clearError()
        dictation.toggle()
    }

    @objc private func deleteTapped() {
        textDocumentProxy.deleteBackward()
    }

    @objc private func languageChanged() {
        switch languageControl.selectedSegmentIndex {
        case 1:  Preferences.shared.languageMode = .greek
        case 2:  Preferences.shared.languageMode = .english
        default: Preferences.shared.languageMode = .auto
        }
        render(dictation.state)
    }
}
