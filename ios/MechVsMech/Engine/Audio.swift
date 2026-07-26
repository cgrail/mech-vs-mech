import Foundation
import AVFoundation

/* ============================================================
   Audio — ports the tiny WebAudio synth in systems/audio.js.
   Sounds are rendered once into PCM buffers (cached by their
   parameters) and played through a small AVAudioPlayerNode pool;
   music is the bundled CC0 loop via AVAudioPlayer.
============================================================ */

enum WaveType: String {
    case sine, square, sawtooth
}

final class AudioEngine {

    private let sampleRate = 44100.0
    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var nextPlayer = 0
    private var format: AVAudioFormat!
    private var cache: [String: AVAudioPCMBuffer] = [:]
    private let lock = NSLock()
    private var started = false
    private var music: AVAudioPlayer?      // all three guarded by `lock`
    private var musicLoading = false
    private var musicDucked = false

    /* the audioCtx() analog: lazily bring the engine up; failures are
       silent — the game must keep working without sound */
    private func ensureStarted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if started { return true }
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)
            for _ in 0..<10 {
                let p = AVAudioPlayerNode()
                engine.attach(p)
                engine.connect(p, to: engine.mainMixerNode, format: format)
                players.append(p)
            }
            engine.mainMixerNode.outputVolume = 0.9
            try engine.start()
            for p in players { p.play() }
            started = true
            return true
        } catch {
            return false
        }
    }

    private func makeBuffer(dur: Double) -> (AVAudioPCMBuffer, UnsafeMutablePointer<Float>, Int)? {
        let frames = AVAudioFrameCount(sampleRate * dur)
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        guard let data = buf.floatChannelData?[0] else { return nil }
        return (buf, data, Int(frames))
    }

    private func play(key: String, render: () -> AVAudioPCMBuffer?) {
        guard ensureStarted() else { return }
        lock.lock()
        var buf = cache[key]
        if buf == nil {
            buf = render()
            cache[key] = buf
        }
        let player: AVAudioPlayerNode? = buf != nil ? players[nextPlayer] : nil
        nextPlayer = (nextPlayer + 1) % players.count
        lock.unlock()
        guard let buf, let player else { return }
        player.scheduleBuffer(buf, at: nil)
    }

    // MARK: - Synth voices

    /* a frequency sweep f → f2 with an exponential fade, like beep() */
    func beep(f: Double, f2: Double, dur: Double, type: WaveType, vol: Double) {
        play(key: "beep:\(f):\(f2):\(dur):\(type.rawValue):\(vol)") {
            guard let (buf, data, n) = self.makeBuffer(dur: dur) else { return nil }
            let fEnd = max(f2, 1)
            var phase = 0.0
            for i in 0..<n {
                let t = Double(i) / self.sampleRate
                let freq = f * pow(fEnd / f, t / dur)
                phase += 2 * .pi * freq / self.sampleRate
                let osc: Double
                switch type {
                case .sine: osc = sin(phase)
                case .square: osc = sin(phase) >= 0 ? 1 : -1
                case .sawtooth:
                    let frac = phase / (2 * .pi)
                    osc = 2 * (frac - floor(frac)) - 1
                }
                let gain = vol * pow(0.001 / vol, t / dur)
                data[i] = Float(osc * gain)
            }
            return buf
        }
    }

    /* punchy sci-fi laser zap: two detuned saws swept down through a bandpass */
    func laser(vol: Double = 0.06, startF: Double = 1800) {
        play(key: "laser:\(vol):\(startF)") {
            let dur = 0.12
            guard let (buf, data, n) = self.makeBuffer(dur: dur) else { return nil }
            let sweepDur = 0.11
            let detune = pow(2.0, 12.0 / 1200.0)  // +12 cents
            var phase1 = 0.0, phase2 = 0.0
            var bp = Biquad()
            for i in 0..<n {
                let t = Double(i) / self.sampleRate
                let sweep = min(t, sweepDur) / sweepDur
                let freq = startF * pow(0.09, sweep)
                phase1 += 2 * .pi * freq / self.sampleRate
                phase2 += 2 * .pi * freq * detune / self.sampleRate
                func saw(_ p: Double) -> Double {
                    let frac = p / (2 * .pi)
                    return 2 * (frac - floor(frac)) - 1
                }
                let fc = (startF * 1.2) * pow(300 / (startF * 1.2), t / dur)
                bp.setBandpass(freq: fc, q: 1.6, sampleRate: self.sampleRate)
                let filtered = bp.process(saw(phase1) + saw(phase2))
                let gain = vol * pow(0.001 / vol, t / dur)
                data[i] = Float(filtered * gain)
            }
            return buf
        }
    }

    /* filtered noise burst */
    func boom(vol: Double, dur: Double) {
        play(key: "boom:\(vol):\(dur)") {
            guard let (buf, data, n) = self.makeBuffer(dur: dur) else { return nil }
            var lp = Biquad()
            lp.setLowpass(freq: 700, q: 0.707, sampleRate: self.sampleRate)
            for i in 0..<n {
                let t = Double(i) / Double(n)
                let noise = (rand01() * 2 - 1) * pow(1 - t, 2)
                data[i] = Float(lp.process(noise) * vol)
            }
            return buf
        }
    }

    // MARK: - Music ("Rocky Musicloop" by johndekale, CC0)

    /* Called off the DEPLOY / ENTER LOBBY button. Everything in here is slow
       enough to be seen — activating the audio session, starting the engine,
       decoding a 400 KB loop — and on the main thread it stalls the run loop,
       which freezes the menu and the map orbiting behind it just as the player
       commits. So it runs on its own queue; the game never waits for sound. */
    func startMusic() {
        lock.lock()
        let already = music != nil || musicLoading
        musicLoading = true
        lock.unlock()
        if already { return }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            guard let url = Bundle.main.url(forResource: "rocky-musicloop", withExtension: "mp3"),
                  let mp = try? AVAudioPlayer(contentsOf: url) else {
                lock.lock(); musicLoading = false; lock.unlock()
                return
            }
            _ = ensureStarted()
            mp.numberOfLoops = -1
            mp.volume = musicDucked ? 0.08 : 0.3
            mp.play()
            lock.lock(); music = mp; musicLoading = false; lock.unlock()
        }
    }

    /* fade the music down, e.g. on the end screen. May land while the loop is
       still loading — hence the flag, which the load then starts out at. */
    func duckMusic() {
        lock.lock()
        musicDucked = true
        let mp = music
        lock.unlock()
        mp?.setVolume(0.08, fadeDuration: 1.5)
    }
}

/* RBJ biquad — enough filter for the laser bandpass + boom lowpass */
private struct Biquad {
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
    var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0

    mutating func setBandpass(freq: Double, q: Double, sampleRate: Double) {
        let w = 2 * .pi * min(freq, sampleRate * 0.45) / sampleRate
        let alpha = sin(w) / (2 * q)
        let a0 = 1 + alpha
        b0 = alpha / a0
        b1 = 0
        b2 = -alpha / a0
        a1 = -2 * cos(w) / a0
        a2 = (1 - alpha) / a0
    }

    mutating func setLowpass(freq: Double, q: Double, sampleRate: Double) {
        let w = 2 * .pi * min(freq, sampleRate * 0.45) / sampleRate
        let alpha = sin(w) / (2 * q)
        let cw = cos(w)
        let a0 = 1 + alpha
        b0 = (1 - cw) / 2 / a0
        b1 = (1 - cw) / a0
        b2 = (1 - cw) / 2 / a0
        a1 = -2 * cw / a0
        a2 = (1 - alpha) / a0
    }

    mutating func process(_ x: Double) -> Double {
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = x
        y2 = y1; y1 = y
        return y
    }
}
