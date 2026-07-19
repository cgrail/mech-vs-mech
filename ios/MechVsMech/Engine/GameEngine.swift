import Foundation
import SceneKit
import UIKit

/* ============================================================
   GameEngine — the module graph of the web version collapsed
   into one object: scene.js (renderer/lights/camera), main.js
   (frame loop + chase/orbit camera) and flow.js (start / end /
   applyDifficulty).

   One engine == one loaded level. Restart or level switch throws
   the engine away and builds a new one (the web version's
   location.reload() analog) — there is no reset logic.

   step(time:) runs on the SceneKit render thread. UI actions
   come in through enqueue(); everything the UI needs to know
   goes out through EngineDelegate (called on the render thread —
   the delegate hops to main itself).
============================================================ */

struct Stats {
    var salvage = 150.0
    var turretsBuilt = 0
    var kills = 0
    var wave = 0
}

struct HudSnapshot: Equatable {
    var hpFrac = 1.0
    var salvage = 150
    var turrets = 0
    var myBaseFrac = 1.0
    var foeBaseFrac = 1.0
    var canRocket = true
    var canTurret = true
}

protocol EngineDelegate: AnyObject {
    func engineMessage(_ text: String, colorHex: Int)
    func engineBuildHint(_ text: String)
    func engineRespawnVisible(_ visible: Bool)
    func engineGameOver(victory: Bool, reason: String?)
    func engineHud(_ hud: HudSnapshot)
}

final class GameEngine {

    let levelInfo: LevelInfo
    let level: Level
    var difficulty: Difficulty

    // multiplayer: nil in single player. When set, red-side AI/waves are off,
    // the player joins mp.myTeam, and damage to the enemy team is network-routed.
    let mp: MPConfig?
    weak var net: Net?
    var netRegistry: [String: Entity] = [:]  // netId -> entity, for hit/hp/die events
    var peers: [Int: Peer] = [:]             // playerId -> replica of another player
    var sendAcc = 0.0                        // state-tick pacing (remote.js SEND_DT)

    var isMP: Bool { mp != nil }
    var myTeam: Team { mp?.myTeam ?? .blue }
    var enemyTeam: Team { mp?.enemyTeam ?? .red }
    var myPlayerId: Int { mp?.playerId ?? 0 }

    let scene = SCNScene()
    let cameraNode = SCNNode()

    var phase: GamePhase = .menu
    /// Single-player pause: freezes the sim while the in-game menu overlay is
    /// open. Multiplayer never sets this (a networked match can't be paused).
    var paused = false
    var elapsed = 0.0

    var entities: [Entity] = []
    var projectiles: [Projectile] = []
    var particles: [Particle] = []
    var stats = Stats()
    let touch = TouchInput()
    let audio = AudioEngine()

    var player: Entity!
    var blueBase: Entity!
    var redBase: Entity!
    var spawnPos = P2()
    var spawnYaw = 0.0
    var gunSide = 1.0
    var nextWaveAt = 5.0
    private var salvageTrickle = 0.0
    private var lastTime: TimeInterval?
    var viewAspect = 1.8   // written by the render delegate each frame

    weak var delegate: EngineDelegate?
    private var actions: [() -> Void] = []
    private let actionLock = NSLock()
    private var lastHud: HudSnapshot?

    init(levelInfo: LevelInfo, difficultyKey: DifficultyKey, mp: MPConfig? = nil, net: Net? = nil) throws {
        self.levelInfo = levelInfo
        self.level = try Level(text: levelInfo.text, name: levelInfo.name)
        self.difficulty = DIFFICULTIES[difficultyKey]!
        self.mp = mp
        self.net = net

        // renderer/scene/lights — ports world/scene.js
        scene.background.contents = UIColor(rgb: 0x0b0d16)
        scene.fogColor = UIColor(rgb: 0x0b0d16)
        scene.fogDensityExponent = 1
        // menu shows the whole map — fog pulled back until DEPLOY (flow.js)
        scene.fogStartDistance = 300
        scene.fogEndDistance = 900

        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.color = UIColor(rgb: 0x9db4d8)   // hemisphere-light stand-in
        ambient.intensity = 500
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        scene.rootNode.addChildNode(ambientNode)

        let sun = SCNLight()
        sun.type = .directional
        sun.color = UIColor(rgb: 0xfff2d8)
        sun.intensity = 1200
        sun.castsShadow = true
        sun.shadowMapSize = CGSize(width: 2048, height: 2048)
        sun.shadowSampleCount = 8
        sun.shadowRadius = 3
        sun.automaticallyAdjustsShadowProjection = true
        let sunNode = SCNNode()
        sunNode.light = sun
        sunNode.position = SCNVector3(60, 120, 40)
        sunNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(sunNode)

        let camera = SCNCamera()
        camera.fieldOfView = 55
        camera.zNear = 0.1
        camera.zFar = 600
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 40, 140)
        scene.rootNode.addChildNode(cameraNode)

        buildWorld(level: level, parent: scene.rootNode)

        // bases are shared; enemy defense turrets are placed by the level's
        // markers in single player only (PvP is pure: both sides build their own)
        blueBase = makeBaseEntity(team: .blue, x: level.blueBase.x, z: level.blueBase.z)
        redBase = makeBaseEntity(team: .red, x: level.redBase.x, z: level.redBase.z)
        if !isMP {
            for t in level.redTurrets {
                makeTurretEntity(team: .red, x: t.x, z: t.z)
            }
        }
        setupPlayer()
        if isMP { initMatch() }   // spawn replicas for every other player
    }

    /* UI-thread entry point: run `action` at the start of the next frame,
       on the render thread, where all game state lives */
    func enqueue(_ action: @escaping () -> Void) {
        actionLock.lock()
        actions.append(action)
        actionLock.unlock()
    }

    func requestStart(difficultyKey: DifficultyKey) {
        audio.startMusic()   // must start from the user gesture path
        enqueue { self.startGame(difficultyKey: difficultyKey) }
    }
    func requestRocket() { enqueue { if self.phase == .playing { self.fireRocket() } } }
    func requestTurret() { enqueue { if self.phase == .playing { self.placeTurretDirect() } } }
    func pauseSim()  { enqueue { self.paused = true } }
    func resumeSim() { enqueue { self.paused = false } }

    /* the DEPLOY button (ports flow.js startGame); in multiplayer the
       ready-handshake's "go" drives this instead of a local button */
    private func startGame(difficultyKey: DifficultyKey) {
        guard phase == .menu else { return }
        difficulty = DIFFICULTIES[difficultyKey]!
        scene.fogStartDistance = 90
        scene.fogEndDistance = 280
        if !isMP { applyDifficulty() }   // PvP is symmetric: no difficulty scaling
        phase = .playing
        delegate?.engineMessage("DESTROY THE ENEMY BASE", colorHex: 0xffd23c)
    }

    /* the red side gets its stats from the chosen difficulty */
    private func applyDifficulty() {
        let cfg = difficulty
        for e in entities where e.alive && e.team == .red && e.kind == .turret {
            e.hp = cfg.turret.hp
            e.maxHp = cfg.turret.hp
            e.damage = cfg.turret.damage
            e.range = cfg.turret.range
            e.fireInterval = cfg.turret.fireInterval
            e.bar?.set(1)
        }
        redBase.hp = cfg.redBaseHp
        redBase.maxHp = cfg.redBaseHp
    }

    /* the ready-handshake's "go" starts a multiplayer match (no local
       difficulty picker — PvP is symmetric) */
    func requestMatchGo() {
        audio.startMusic()
        enqueue { self.startGame(difficultyKey: .medium) }
    }

    func endGame(victory: Bool, reason: String? = nil) {
        if phase == .over { return }
        phase = .over
        delegate?.engineMessage(victory ? "ENEMY BASE DESTROYED" : "YOUR BASE HAS FALLEN",
                                colorHex: victory ? 0x7CFF6B : 0xff5040)
        audio.boom(vol: 0.5, dur: 1.2)
        audio.duckMusic()
        delegate?.engineGameOver(victory: victory, reason: reason)   // delegate delays the overlay 1.4s
    }

    /* ============================================================
       Frame loop — ports main.js animate()
    ============================================================ */
    func step(time: TimeInterval) {
        let dt = min(lastTime.map { time - $0 } ?? 0, 0.05)
        lastTime = time

        actionLock.lock()
        let pending = actions
        actions.removeAll()
        actionLock.unlock()
        for action in pending { action() }

        if phase == .playing && !paused {
            elapsed += dt

            updatePlayer(dt: dt)
            if !isMP { updateWaves() }   // PvP has no AI waves
            for e in entities where e.alive {
                // remote entities are replicas driven by the network, never local AI
                if e.kind == .turret && !e.remote { updateTurret(e, dt: dt) }
                else if e.kind == .mech && !isMP { updateEnemyMech(e, dt: dt) }
            }
            separateMechs()
            updateProjectiles(dt: dt)

            // passive salvage income (fixed rate in PvP so both sides earn the same)
            salvageTrickle += dt
            if salvageTrickle >= 1 {
                salvageTrickle -= 1
                stats.salvage += 3 * (isMP ? 1 : difficulty.salvageMult)
            }
        }
        remoteUpdate(dt: dt)   // MP: state send + replica easing (no-op in SP)

        updateParticles(dt: dt)
        if phase != .menu {
            updateCamera(dt: dt)
        } else {
            // idle menu camera orbit, scaled so the whole map stays in frame
            let t = time * 0.2
            let r = (max(level.arenaHW, level.arenaHD) * 1.1 + 25) / min(1, viewAspect)
            cameraNode.position = SCNVector3(sin(t) * r, r * 0.85, cos(t) * r)
            cameraNode.look(at: SCNVector3(0, 0, 0),
                            up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 0, -1))
        }

        pushHud()
    }

    /* chase camera — ports updateCamera() in main.js */
    private func updateCamera(dt: Double) {
        let behind = 21.0, up = 26.0
        let yaw = player.yaw
        let cx = player.x - sin(yaw) * behind
        let cz = player.z - cos(yaw) * behind
        let k = Float(1 - exp(-8 * dt))
        var pos = cameraNode.position
        pos.x += (Float(cx) - pos.x) * k
        pos.y += (Float(player.y + up) - pos.y) * k
        pos.z += (Float(cz) - pos.z) * k
        cameraNode.position = pos
        // aim well ahead of the mech: tilts the view up so more of the field shows.
        // Pass world-up explicitly — SceneKit's 1-arg look(at:) rolls the horizon as
        // the yaw swings; pinning up to (0,1,0) keeps it level like three.js lookAt.
        cameraNode.look(
            at: SCNVector3(player.x + sin(yaw) * 17, player.y + 2, player.z + cos(yaw) * 17),
            up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 0, -1))
    }

    private func pushHud() {
        // team-relative: "YOUR BASE" tracks whichever base is ours (guests play red)
        let myBase = myTeam == .red ? redBase! : blueBase!
        let foeBase = myTeam == .red ? blueBase! : redBase!
        var hud = HudSnapshot()
        hud.hpFrac = max(0, player.hp / player.maxHp)
        hud.salvage = Int(stats.salvage)
        hud.turrets = entities.filter { $0.alive && $0.team == myTeam && $0.kind == .turret }.count
        hud.myBaseFrac = max(0, myBase.hp / myBase.maxHp)
        hud.foeBaseFrac = max(0, foeBase.hp / foeBase.maxHp)
        hud.canRocket = stats.salvage >= Costs.rocket
        hud.canTurret = stats.salvage >= Costs.turret
        if hud != lastHud {
            lastHud = hud
            delegate?.engineHud(hud)
        }
    }
}
