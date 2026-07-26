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
            // freeze the orientation for the whole match, hold it through the
            // end screen, and let any menu/lobby screen rotate freely again
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
    /* the end screen's NEXT MAP status line ("waiting…", or why not) */
    @Published var nextMapNote: String?
    /* seconds left before the next map starts by itself (nil: not counting) */
    @Published var nextMapIn: Int?
    @Published private(set) var engine: GameEngine
    @Published var levelIndex: Int

    private(set) var isMPMatch = false

    @Published var difficultyKey: DifficultyKey {
        didSet { UserDefaults.standard.set(difficultyKey.rawValue, forKey: "mechDifficulty") }
    }
    @Published var scheme: ControlScheme {
        didSet { UserDefaults.standard.set(scheme.rawValue, forKey: "mechControls") }
    }
    /* base assault or capture the flag — a single-player choice, remembered
       like the difficulty. A multiplayer match plays its room's mode instead
       (MPConfig.mode), so this is not offered in the lobby.
       Switching it rebuilds the menu engine: the flags are built with the
       world, so the map behind the menu shows the stands right away. */
    @Published var mode: GameMode {
        didSet {
            guard mode != oldValue else { return }
            UserDefaults.standard.set(mode.rawValue, forKey: "mechMode")
            if !isMPMatch && screen != .playing { rebuildEngine() }
        }
    }
    /* fog of war (Engine/Vision.swift): remembered like the difficulty, and
       applied to a running match right away */
    @Published var fogOfWar: Bool {
        didSet {
            UserDefaults.standard.set(fogOfWar, forKey: "mechFog")
            engine.setFogOfWar(fogOfWar)
        }
    }

    var lobby: LobbyModel!

    private let gyro = GyroController()
    private var nextMapTimer: Timer?   // end screen → next multiplayer match
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
        fogOfWar = UserDefaults.standard.bool(forKey: "mechFog")
        let savedMode = GameMode(rawValue: UserDefaults.standard.string(forKey: "mechMode") ?? "") ?? .assault
        mode = savedMode
        engine = Self.makeEngine(info: loaded.first ?? Self.fallbackInfo,
                                 difficultyKey: .medium, mode: savedMode)
        engine.delegate = self
        lobby = LobbyModel(app: self)
    }

    private static func makeEngine(info: LevelInfo, difficultyKey: DifficultyKey,
                                   mode: GameMode = .assault,
                                   mp: MPConfig? = nil, net: Net? = nil) -> GameEngine {
        if let e = try? GameEngine(levelInfo: info, difficultyKey: difficultyKey,
                                   mode: mode, mp: mp, net: net) { return e }
        // a broken level in the bundle: fall back to the built-in map
        return try! GameEngine(levelInfo: fallbackInfo, difficultyKey: difficultyKey,
                               mode: mode, mp: mp, net: net)
    }

    private func rebuildEngine(mp: MPConfig? = nil, net: Net? = nil, info: LevelInfo? = nil) {
        previewName = nil   // any rebuild drops the lobby's map preview
        engine = Self.makeEngine(info: info ?? levelInfo, difficultyKey: difficultyKey,
                                 mode: mode, mp: mp, net: net)
        engine.delegate = self
        hud = HudSnapshot()
        respawnVisible = false
        message = nil
        buildHint = nil
        endReason = nil
        nextMapNote = nil
        stopNextMapCountdown()
    }

    // MARK: - Screen flow (single player)

    func showModeScreen() { screen = .mode }
    func showMenu() { screen = .menu }
    func showLevelSelect() { screen = .levelSelect }

    func deploy() {
        engine.requestStart(difficultyKey: difficultyKey, fogOfWar: fogOfWar)
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

    /* ◂ / ▸ on the mission menu: straight to the neighbouring map, wrapping
       at both ends, without a trip through the level list */
    func stepLevel(_ dir: Int) {
        guard levels.count > 1 else { return }
        levelIndex = ((levelIndex + dir) % levels.count + levels.count) % levels.count
        rebuildEngine()
    }

    /* end screen: NEXT LEVEL advances through the bundle, REDEPLOY replays */
    func continueFromEndScreen() {
        gyro.stop()
        stopNextMapCountdown()
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

    /* end screen: ▸ NEXT MAP asks the server to mint a follow-up match for
       everyone still connected, on the next map in its bundle. The answer is
       a matchStart, which drops us into the boot handshake (enterMatchBoot);
       an error comes back as a note under the button. */
    func requestNextMap() {
        stopNextMapCountdown()
        nextMapNote = "WAITING FOR THE NEXT MAP…"
        lobby.nextMatch()
    }

    /* ---------- the countdown to it ----------
       A finished match rolls on by itself after AUTO_NEXT seconds, so a
       session keeps its momentum without anyone having to press anything.
       Every client's timer runs out at roughly the same moment, which is
       harmless: the first request the server sees mints the match and the
       rest only re-send the same matchStart to the same roster. Ports the
       same countdown in game/ui/lobby.js. */
    static let AUTO_NEXT = 10

    private func startNextMapCountdown() {
        stopNextMapCountdown()
        guard isMPMatch, lobby.isConnected else { return }
        nextMapIn = Self.AUTO_NEXT
        nextMapTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            let left = (self.nextMapIn ?? 0) - 1
            if left <= 0 { self.requestNextMap() } else { self.nextMapIn = left }
        }
    }

    func stopNextMapCountdown() {
        nextMapTimer?.invalidate()
        nextMapTimer = nil
        nextMapIn = nil
    }

    /* a matchStart landing while a finished (or still-running) match is on
       screen: throw that engine away and show the boot handshake */
    func enterMatchBoot() {
        gyro.stop()
        stopNextMapCountdown()
        isMPMatch = false
        nextMapNote = nil
        rebuildEngine()
        screen = .lobby
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
        clearPreview()
        screen = .mode
    }

    /* The map orbiting behind the lobby is the room's, not the one picked in
       single player: LobbyModel fetches the room's level from the server and
       hands it here, and the engine is rebuilt on it — the same throw-away-
       and-rebuild the level select does. `levelIndex` is untouched, so
       leaving the lobby drops straight back to the single-player choice. */
    private var previewName: String?

    func previewLevel(_ info: LevelInfo) {
        guard previewName != info.name else { return }
        rebuildEngine(info: info)   // clears previewName, so set it after
        previewName = info.name
    }

    func clearPreview() {
        if previewName != nil { rebuildEngine() }
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

    /* last resort only: the same param resolved against our bundled copy of
       levels.txt, which may not be the map the rest of the match is on */
    private func resolveLevel(_ param: String) -> LevelInfo {
        if param.allSatisfy(\.isNumber), let n = Int(param), levels.indices.contains(n - 1) {
            return levels[n - 1]
        }
        return levels.first { $0.name == param } ?? levelInfo
    }

    /* the ready-handshake "go" fired: build the match engine and drop into play.
       `level` is the server's own copy of the map (see fetchServerLevel) — it is
       what everyone else in the match is loading, so it wins over anything in
       this app's bundle; nil only if the server couldn't be reached. */
    func startMatch(config: MPConfig, levelParam: String, level: LevelInfo?) {
        let info = level ?? resolveLevel(levelParam)
        rebuildEngine(mp: config, net: lobby.net, info: info)
        isMPMatch = true
        engine.requestMatchGo(fogOfWar: fogOfWar)
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
                guard self.screen == .playing else { return }  // already moved on
                self.victory = victory
                self.endReason = reason
                self.nextMapNote = nil
                self.screen = .over
                self.startNextMapCountdown()   // multiplayer rolls on by itself
            }
        }
    }
}
