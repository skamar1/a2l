import Foundation

/// Κωδικοποίηση σε WAV 16-bit PCM. Στέλνουμε 16-bit αντί για float32 επειδή
/// στα 16 kHz mono δεν υπάρχει ακουστική διαφορά για την απομαγνητοφώνηση,
/// ενώ το ανέβασμα γίνεται μισό.
enum WavWriter {
    static func encode(samples: [Float], sampleRate: Int = 16_000) -> Data {
        let channels = 1
        let bitsPerSample = 16
        let byteRate = sampleRate * channels * bitsPerSample / 8
        let blockAlign = channels * bitsPerSample / 8
        let dataSize = samples.count * 2

        var data = Data(capacity: 44 + dataSize)

        func ascii(_ s: String) { data.append(contentsOf: Array(s.utf8)) }
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }

        ascii("RIFF"); u32(UInt32(36 + dataSize)); ascii("WAVE")
        ascii("fmt "); u32(16); u16(1); u16(UInt16(channels))
        u32(UInt32(sampleRate)); u32(UInt32(byteRate))
        u16(UInt16(blockAlign)); u16(UInt16(bitsPerSample))
        ascii("data"); u32(UInt32(dataSize))

        var pcm = [Int16]()
        pcm.reserveCapacity(samples.count)
        for sample in samples {
            let clamped = max(-1.0, min(1.0, sample))
            pcm.append(Int16(clamped * 32_767.0))
        }
        pcm.withUnsafeBufferPointer { data.append(Data(buffer: $0)) }

        return data
    }
}
