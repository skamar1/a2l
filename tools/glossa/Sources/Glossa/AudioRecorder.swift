import AVFoundation
import Foundation

/// Ηχογράφηση από το προεπιλεγμένο μικρόφωνο, με μετατροπή επί τόπου σε
/// 16 kHz mono float32 — τη μοναδική μορφή που θέλουν και το whisper.cpp και
/// το API. Έτσι δεν κρατάμε ποτέ στη μνήμη ήχο 48 kHz που θα πετούσαμε.
final class AudioRecorder {

    enum RecorderError: LocalizedError {
        case microphoneDenied
        case engineFailed(String)
        case noConverter

        var errorDescription: String? {
            switch self {
            case .microphoneDenied:
                return "Δεν δόθηκε άδεια μικροφώνου. Ρυθμίσεις Συστήματος → Απόρρητο και ασφάλεια → Μικρόφωνο."
            case .engineFailed(let detail):
                return "Δεν ξεκίνησε η ηχογράφηση: \(detail)"
            case .noConverter:
                return "Δεν υποστηρίζεται η μορφή ήχου της συσκευής εισόδου."
            }
        }
    }

    static let sampleRate: Double = 16_000

    private let engine = AVAudioEngine()
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                             sampleRate: AudioRecorder.sampleRate,
                                             channels: 1,
                                             interleaved: false)!
    private var converter: AVAudioConverter?
    private var buffer: [Float] = []
    private let lock = NSLock()
    private var limitFrames = 0

    private(set) var isRecording = false

    /// Στάθμη 0–1 για την ένδειξη στη γραμμή μενού. Καλείται στο main queue.
    var onLevel: ((Float) -> Void)?
    /// Καλείται όταν πιαστεί το όριο διάρκειας — το UI σταματά την ηχογράφηση.
    var onLimitReached: (() -> Void)?

    // MARK: Άδεια

    static func microphoneAuthorized() -> Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    static func requestMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        default:
            return false
        }
    }

    // MARK: Κύκλος ζωής

    func start(maxSeconds: Double) throws {
        guard !isRecording else { return }
        guard AudioRecorder.microphoneAuthorized() else { throw RecorderError.microphoneDenied }

        lock.lock()
        buffer.removeAll(keepingCapacity: true)
        buffer.reserveCapacity(Int(AudioRecorder.sampleRate * min(maxSeconds, 60)))
        lock.unlock()

        limitFrames = Int(AudioRecorder.sampleRate * maxSeconds)

        // Η μορφή του input διαβάζεται σε ΚΑΘΕ start: αν ο χρήστης άλλαξε
        // μικρόφωνο ή συνέδεσε ακουστικά, ο μετατροπέας πρέπει να ξαναχτιστεί.
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else { throw RecorderError.engineFailed("μηδενική συχνότητα δειγματοληψίας") }
        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw RecorderError.noConverter
        }
        self.converter = converter

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4_096, format: inputFormat) { [weak self] pcm, _ in
            self?.append(pcm)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw RecorderError.engineFailed(error.localizedDescription)
        }

        isRecording = true
    }

    /// Σταματά και επιστρέφει τα δείγματα. Ασφαλές να κληθεί δύο φορές.
    @discardableResult
    func stop() -> [Float] {
        guard isRecording else { return [] }
        isRecording = false

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil

        lock.lock()
        let samples = buffer
        buffer.removeAll(keepingCapacity: false)
        lock.unlock()

        return samples
    }

    func cancel() {
        _ = stop()
    }

    // MARK: Μετατροπή

    private func append(_ pcm: AVAudioPCMBuffer) {
        guard let converter else { return }

        // Το AVAudioConverter χρειάζεται χώρο για το αποτέλεσμα ΠΡΙΝ ξέρει
        // πόσα καρέ θα βγάλει· υπολογίζουμε από τον λόγο συχνοτήτων με
        // περιθώριο για τη λανθάνουσα καθυστέρηση του φίλτρου.
        let ratio = targetFormat.sampleRate / pcm.format.sampleRate
        let capacity = AVAudioFrameCount(Double(pcm.frameLength) * ratio) + 1_024
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

        var consumed = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return pcm
        }

        guard status != .error, error == nil, out.frameLength > 0,
              let channel = out.floatChannelData?[0]
        else { return }

        let count = Int(out.frameLength)
        var sumSquares: Float = 0
        for i in 0..<count {
            let v = channel[i]
            sumSquares += v * v
        }

        var hitLimit = false
        lock.lock()
        if buffer.count < limitFrames {
            buffer.append(contentsOf: UnsafeBufferPointer(start: channel, count: count))
            hitLimit = buffer.count >= limitFrames
        }
        lock.unlock()

        let rms = sumSquares > 0 ? (sumSquares / Float(count)).squareRoot() : 0
        // Λογαριθμική κλίμακα: η γραμμική RMS δείχνει σχεδόν μηδενική για
        // κανονική ομιλία και η ένδειξη μοιάζει νεκρή.
        let level = min(1, max(0, (20 * log10(max(rms, 1e-6)) + 50) / 50))

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.onLevel?(level)
            if hitLimit { self.onLimitReached?() }
        }
    }
}
