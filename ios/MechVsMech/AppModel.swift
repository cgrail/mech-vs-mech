import Foundation
import SwiftUI

/* ============================================================
   AppModel — the screen state machine (flow.js's overlay logic)
   plus engine lifecycle. A level switch, redeploy, or match start
   replaces the whole engine, the web version's location.reload()
   analog.
============================================================ */

struct GameMessage: Equatable {
    let id: UUID
    let text: String
    let colorHex: Int
}

/* last-resort level so the app still runs if levels.txt is missing/broken */
private let FALLBACK_LEVEL = """
wwwwwwwwww
wggSggRggw
wggggggggw
wggggggggw
wggggggggw
wggggggggw
wggPggBggw
wwwwwwwwww
"""

final class AppModel: ObservableObject {

    enum Screen {
        case mode, menu, levelSelect, lobby, playing, over
    }

    let levels: [LevelInfo]
    @Published var screen: Screen = .mode {
        didSet {
            guard screen != oldValue else { return }
            // freeze the grip for the whole match, hold it through the end screen,
            // and open both landscapes back up on any menu/lobby screen
            switch screen {
            case .playing: OrientationLock.freezeToCurrent()
            case .over:    break
            default:       OrientationLock.unlock()
            }
        }
    }
    @Published var hud = HudSnapshot()
    @Published var message: GameMessage?
    @Published var buildHint: String?
    @Published var respawnVisible = false
    @Published var victory = false
    @Published var endReason: String?
    @Published private(set) var engine: GameEngine
    @Published var levelIndex: Int

    private(set) var isMPMatch = false

    @Published var difficultyKey: DifficultyKey {
        didSet { UserDefaults.standard.set(difficultyKey.rawValue, forKey: "mechDifficulty") }
    }
    @Published var scheme: ControlScheme {
        didSet { UserDefaults.standard.set(scheme.rawValue, forKey: "mechControls") }
    }

    var lobby: LobbyModel!

    private let gyro = GyroController()
    private var messageClearTask: DispatchWorkItem?
    private var hintClearTask: DispatchWorkItem?

    var levelInfo: LevelInfo { levels.indices.contains(levelIndex) ? levels[levelIndex] : Self.fallbackInfo }
    var hasNextLevel: Bool { levelIndex + 1 < levels.count }

    private static let fallbackInfo = LevelInfo(
        index: 0, name: "fallback", text: FALLBACK_LEVEL,
        title: "TRAINING YARD", desc: "levels.txt could not be loaded")

    init() {
        let loaded = loadLevelBundle()
        levels = loaded
        levelIndex = 0
        difficultyKey = DifficultyKey(rawValue: UserDefaults.standard.string(forKey: "mechDifficulty") ?? "") ?? .medium
        scheme = ControlScheme(rawValue: UserDefaults.standard.string(forKey: "mechControls") ?? "") ?? .joystick
        engine = Self.makeEngine(info: loaded.first ?? Self.fallbackInfo, difficultyKey: .medium)
        engine.delegate = self
        lobby = LobbyModel(app: self)
    }

    private static func makeEngine(info: LevelInfo, difficultyKey: DifficultyKey,
                                   mp: MPConfig? = nil, net: Net? = nil) -> GameEngine {
        if let e = try? GameEngine(levelInfo: info, difficultyKey: difficultyKey, mp: mp, net: net) { return e }
        // a broken level in the bundle: fall back to the built-in map
        return try! GameEngine(levelInfo: fallbackInfo, difficultyKey: difficultyKey, mp: mp, net: net)
    }

    private func rebuildEngine(mp: MPConfig? = nil, net: Net? = nil, info: LevelInfo? = nil) {
        engine = Self.makeEngine(info: info ?? levelInfo, difficultyKey: difficultyKey, mp: mp, net: net)
        engine.delegate = self
        hud = HudSnapshot()
        respawnVisible = false
        message = nil
        buildHint = nil
        endReason = nil
    }

    // MARK: - Screen flow (single player)

    func showModeScreen() { screen = .mode }
    func showMenu() { screen = .menu }
    func showLevelSelect() { screen = .levelSelect }

    func deploy() {
        engine.requestStart(difficultyKey: difficultyKey)
        if scheme == .gyro { gyro.start(engine: engine) } else { gyro.stop() }
        screen = .playing
    }

    func selectLevel(_ index: Int) {
        guard levels.indices.contains(index) else { return }
        if index != levelIndex {
            levelIndex = index
            rebuildEngine()   // the menu orbit camera now previews this map
        }
        screen = .levelSelect
    }

    /* end screen: NEXT LEVEL advances through the bundle, REDEPLOY replays */
    func continueFromEndScreen() {
        gyro.stop()
        if isMPMatch {
            isMPMatch = false
            rebuildEngine()          // drop the match engine back to a menu engine
            screen = .lobby
            lobby.backToLobby()
            return
        }
        if victory && hasNextLevel { levelIndex += 1 }
        rebuildEngine()
        screen = .menu
    }

    /* in-game menu QUIT: leave a match in progress with no win/lose result —
       back to the mission menu in single player, back to the lobby in MP.
       Mirrors continueFromEndScreen's bail-out path minus the level advance. */
    func quitToMenu() {
        gyro.stop()
        if isMPMatch {
            isMPMatch = false
            rebuildEngine()          // drop the match engine back to a menu engine
            screen = .lobby
            lobby.backToLobby()
            return
        }
        rebuildEngine()
        screen = .menu
    }

    // MARK: - Multiplayer

    func showLobby() {
        screen = .lobby
        lobby.open()
    }

    func leaveLobby() {
        lobby.close()
        screen = .mode
    }

    /* the levelParam this client advertises when joining the lobby */
    func currentLevelParam() -> String {
        levelParam(levelInfo.name)
    }

    private func levelParam(_ name: String) -> String {
        // numeric levels keep their short "N" form; named levels use the name
        if name.hasPrefix("level") {
            let rest = name.dropFirst(5)
            if !rest.isEmpty && rest.allSatisfy(\.isNumber) { return String(rest) }
        }
        return name
    }

    private func resolveLevel(_ param: String) -> LevelInfo {
        if param.allSatisfy(\.isNumber), let n = Int(param), levels.indices.contains(n - 1) {
            return levels[n - 1]
        }
        return levels.first { $0.name == param } ?? levelInfo
    }

    /* the ready-handshake "go" fired: build the match engine and drop into play */
    func startMatch(config: MPConfig, levelParam: String) {
        let info = resolveLevel(levelParam)
        rebuildEngine(mp: config, net: lobby.net, info: info)
        isMPMatch = true
        engine.requestMatchGo()
        if scheme == .gyro { gyro.start(engine: engine) } else { gyro.stop() }
        screen = .playing
    }
}

/* ============================================================
   EngineDelegate — called on the SceneKit render thread; every
   handler hops to the main thread before touching @Published
============================================================ */
extension AppModel: EngineDelegate {

    func engineHud(_ hud: HudSnapshot) {
        DispatchQueue.main.async { self.hud = hud }
    }

    func engineMessage(_ text: String, colorHex: Int) {
        DispatchQueue.main.async {
            let msg = GameMessage(id: UUID(), text: text, colorHex: colorHex)
            self.message = msg
            self.messageClearTask?.cancel()
            let task = DispatchWorkItem { if self.message == msg { self.message = nil } }
            self.messageClearTask = task
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: task)
        }
    }

    func engineBuildHint(_ text: String) {
        DispatchQueue.main.async {
            self.buildHint = text
            self.hintClearTask?.cancel()
            let task = DispatchWorkItem { self.buildHint = nil }
            self.hintClearTask = task
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4, execute: task)
        }
    }

    func engineRespawnVisible(_ visible: Bool) {
        DispatchQueue.main.async { self.respawnVisible = visible }
    }

    func engineGameOver(victory: Bool, reason: String?) {
        DispatchQueue.main.async {
            self.gyro.stop()
            // the web end screen appears 1.4s after the base explodes
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                self.victory = victory
                self.endReason = reason
                self.screen = .over
            }
        }
    }
}
