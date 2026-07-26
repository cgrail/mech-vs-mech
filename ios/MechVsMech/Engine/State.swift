import Foundation
import UIKit

/* ============================================================
   Difficulty settings — copied verbatim from game/core/state.js
============================================================ */

struct MechCfg {
    var hp, speed, damage, fireInterval, range, sight, spread, aimLead: Double
    var strafe: Bool
    var retarget: Double
}

struct TurretCfg {
    var hp, damage, range, fireInterval: Double
}

struct WaveCfg {
    var interval: Double
    var base, growthDiv, maxPerWave, maxAlive: Int
    var flank: Bool
}

struct Difficulty {
    var label: String
    var mech: MechCfg
    var turret: TurretCfg
    var redBaseHp: Double
    var wave: WaveCfg
    var salvageMult: Double
}

enum DifficultyKey: String, CaseIterable {
    case easy, medium, hard
}

let DIFFICULTIES: [DifficultyKey: Difficulty] = [
    .easy: Difficulty(
        label: "EASY",
        mech: MechCfg(hp: 90, speed: 8.5, damage: 6, fireInterval: 0.55, range: 32, sight: 50, spread: 0.12, aimLead: 0, strafe: false, retarget: 0.7),
        turret: TurretCfg(hp: 240, damage: 7, range: 40, fireInterval: 0.45),
        redBaseHp: 900,
        wave: WaveCfg(interval: 26, base: 2, growthDiv: 3, maxPerWave: 4, maxAlive: 7, flank: false),
        salvageMult: 1.25
    ),
    .medium: Difficulty(
        label: "MEDIUM",
        mech: MechCfg(hp: 130, speed: 10, damage: 8, fireInterval: 0.38, range: 42, sight: 64, spread: 0.06, aimLead: 0.6, strafe: true, retarget: 0.5),
        turret: TurretCfg(hp: 320, damage: 9, range: 46, fireInterval: 0.32),
        redBaseHp: 1200,
        wave: WaveCfg(interval: 21, base: 2, growthDiv: 2, maxPerWave: 6, maxAlive: 12, flank: true),
        salvageMult: 1
    ),
    .hard: Difficulty(
        label: "HARD",
        mech: MechCfg(hp: 170, speed: 11.5, damage: 10, fireInterval: 0.3, range: 50, sight: 80, spread: 0.03, aimLead: 1, strafe: true, retarget: 0.35),
        turret: TurretCfg(hp: 420, damage: 11, range: 52, fireInterval: 0.26),
        redBaseHp: 1600,
        wave: WaveCfg(interval: 17, base: 3, growthDiv: 2, maxPerWave: 8, maxAlive: 16, flank: true),
        salvageMult: 0.8
    ),
]

/* salvage is the only currency: machine guns are free, everything else costs */
enum Costs {
    static let rocket = 20.0
    static let turret = 100.0
}

enum Team {
    case blue, red
    var enemy: Team { self == .blue ? .red : .blue }
}

enum GamePhase {
    case menu, playing, over
}

/* ============================================================
   Game modes — mirrors MODES in game/core/state.js

   assault  the original: waves + destroy the enemy base
   ctf      capture the flag (Engine/CTF.swift) — both bases get a
            flag in their courtyard, carry the enemy's to your own
            stand. Bases stay destructible — levelling one stops
            that side's waves — but only captures win.
============================================================ */
enum GameMode: String, CaseIterable {
    case assault, ctf
    var label: String { self == .ctf ? "🚩 CAPTURE THE FLAG" : "⚔ BASE ASSAULT" }
}

enum ControlScheme: String, CaseIterable {
    case joystick, gyro
    var label: String { self == .gyro ? "📱 GYRO" : "🕹️ JOYSTICK" }
}

/* ============================================================
   Touch/mobile input — written by TouchControls (main thread) and
   CoreMotion, read by the engine on the SceneKit render thread.
   Mirrors the `touch` object in core/state.js.
============================================================ */
final class TouchInput {
    private let lock = NSLock()
    private var _move = 0.0        // forward/back, −1..1 (sign is what matters)
    private var _strafe = 0.0      // strafe, −1..1
    private var _boost = false     // stick pushed hard forward (or a hard lean): run, not walk
    private var _yaw: Double?      // gyro target yaw in radians (nil = yaw controlled directly)
    private var _firing = false    // machine guns held
    private var _jump = false      // one-shot jump request, consumed per frame
    private var _lookDX = 0.0      // accumulated look-drag pixels since last frame

    var move: Double {
        get { lock.lock(); defer { lock.unlock() }; return _move }
        set { lock.lock(); _move = newValue; lock.unlock() }
    }
    var strafe: Double {
        get { lock.lock(); defer { lock.unlock() }; return _strafe }
        set { lock.lock(); _strafe = newValue; lock.unlock() }
    }
    var boost: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _boost }
        set { lock.lock(); _boost = newValue; lock.unlock() }
    }
    var yaw: Double? {
        get { lock.lock(); defer { lock.unlock() }; return _yaw }
        set { lock.lock(); _yaw = newValue; lock.unlock() }
    }
    var firing: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _firing }
        set { lock.lock(); _firing = newValue; lock.unlock() }
    }

    /* one-shot jump request from the ⬆ button; the player update takes it */
    func requestJump() {
        lock.lock(); _jump = true; lock.unlock()
    }
    func takeJump() -> Bool {
        lock.lock(); defer { _jump = false; lock.unlock() }
        return _jump
    }

    func addLookDX(_ dx: Double) {
        lock.lock(); _lookDX += dx; lock.unlock()
    }
    /* the per-frame consumer: returns and clears the accumulated drag */
    func takeLookDX() -> Double {
        lock.lock(); defer { _lookDX = 0; lock.unlock() }
        return _lookDX
    }
}

/* ============================================================
   Small shared helpers
============================================================ */

func angDiff(_ a: Double, _ b: Double) -> Double { atan2(sin(a - b), cos(a - b)) }

func rand01() -> Double { Double.random(in: 0..<1) }

extension UIColor {
    /* 0xRRGGBB, like the three.js hex colors */
    convenience init(rgb: Int) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xff) / 255,
            green: CGFloat((rgb >> 8) & 0xff) / 255,
            blue: CGFloat(rgb & 0xff) / 255,
            alpha: 1
        )
    }
}
