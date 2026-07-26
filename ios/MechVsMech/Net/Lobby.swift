import Foundation
import Combine

/* ============================================================
   Multiplayer lobby + match-boot — ports ui/lobby.js.

   Lobby: pick a callsign → join → create/join a room → pick a
   team (max 5/side) → START MATCH once both sides have a pilot.
   The room's creator also picks its map (`setLevel`, offered from
   the server's own list — see LobbyModel.maps); everyone in the
   room fights on that one. The server mints a match and everyone
   gets `matchStart`.

   Match boot: unlike the web (which reloads the page), iOS keeps
   the same socket — the server already released our lobby-client
   record when the match was minted, so we just `rejoin` by token,
   run the READY handshake, and start on `go`.
============================================================ */

let LOBBY_TEAM_MAX = 5
let LOBBY_ROOM_MAX = 12   // members per room: a full 5v5 plus a few undecided

struct RoomInfo: Identifiable {
    let id: Int
    let name: String
    let count: Int
    let owner: Int       // the pilot who created it — only they pick the map
    let level: String    // the map everyone in this room will play
    let mode: GameMode   // …and the mode they will play it in
}

struct LobbyPlayer: Identifiable {
    let id: Int
    let name: String
    let room: Int?
    let team: Team?
}

final class LobbyModel: ObservableObject {

    enum Phase {
        case connecting, callsign, rooms, inRoom, matchBoot, dead
    }

    weak var app: AppModel?
    let net = Net()

    @Published var phase: Phase = .connecting
    @Published var status = "CONNECTING TO SERVER…"
    @Published var statusIsError = false
    @Published var banner: String?

    @Published var name = UserDefaults.standard.string(forKey: "mechMpName") ?? ""
    @Published var rooms: [RoomInfo] = []
    @Published var players: [LobbyPlayer] = []
    @Published var myId: Int?
    @Published var myRoom: Int?
    @Published var myTeam: Team?
    /* the maps this server offers — fetched from it, not read out of our
       bundle, so the picker can't offer a map the server doesn't have */
    @Published var maps: [ServerLevel] = []

    // match boot
    @Published var bootRoster: [MPPlayer] = []
    @Published var bootStatus = ""

    private var myName = ""
    private var pending: (config: MPConfig, levelParam: String)?
    /* the match's map as the server has it — fetched during the boot
       handshake, because our bundled levels.txt may be a stale copy */
    private var matchLevel: LevelInfo?
    private var levelPending = false     // fetch still in flight
    private var goPending = false        // "go" landed before the map did
    /* the map the lobby is previewing, and the terrain fetched for it —
       cached so flipping through the picker doesn't refetch every map */
    private var previewParam: String?
    private var levelCache: [String: LevelInfo] = [:]
    private var goneIds = Set<Int>()
    private var autoJoin = false
    private var autoRoom = false   // just entered the lobby: walk into the only room going
    private var bannerTask: DispatchWorkItem?

    init(app: AppModel) {
        self.app = app
        net.onOpen = { [weak self] in self?.handleOpen() }
        net.onClose = { [weak self] in self?.handleClose() }
        net.onEvent = { [weak self] type, obj in self?.handleEvent(type, obj) }
        net.onGame = { [weak self] data, from in
            // in-match relay — hand to the running engine
            self?.app?.engine.onGameMsg(data, from: from)
        }
    }

    // MARK: - Lifecycle

    func open(autoJoin: Bool = false) {
        self.autoJoin = autoJoin
        goneIds.removeAll()
        pending = nil
        matchLevel = nil
        levelPending = false
        goPending = false
        previewParam = nil
        phase = .connecting
        setStatus("CONNECTING TO SERVER…")
        if net.isConnected { handleOpen() } else { net.connect() }
        fetchMaps()
    }

    /* the server's map list, refreshed each time the lobby opens — a deploy
       can add or retitle maps while the app stays installed */
    private func fetchMaps() {
        guard let url = net.levelsURL() else { return }
        fetchServerLevelList(url: url) { [weak self] list in
            guard let self, !list.isEmpty else { return }   // keep the last good list
            self.maps = list
        }
    }

    func close() {
        net.disconnect()
    }

    private func handleOpen() {
        if phase == .matchBoot { return }
        setStatus("CONNECTED — ENTER A CALLSIGN TO JOIN THE LOBBY")
        phase = .callsign
        if autoJoin, !name.trimmingCharacters(in: .whitespaces).isEmpty {
            autoJoin = false
            join()
        }
    }

    private func handleClose() {
        if phase == .matchBoot {
            failMatch("CONNECTION LOST — IS THE SERVER RUNNING?")
        } else if app?.screen == .playing {
            app?.engine.enqueue { [weak self] in self?.app?.engine.handleConnectionLost() }
        } else {
            // no server to roll the match on. On the end screen that is the
            // same dead end, but the lobby is unreachable too, so that one
            // stays a tap away rather than pressing itself
            if app?.screen == .over {
                app?.noNextMap("CONNECTION LOST — IS THE SERVER RUNNING?", auto: false)
            }
            phase = .connecting
            myId = nil; myRoom = nil; myTeam = nil
            setStatus("CANNOT REACH THE SERVER — CHECK YOUR CONNECTION AND TRY AGAIN", error: true)
        }
    }

    // MARK: - Lobby actions

    func join() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        net.send(["type": "join", "name": n, "level": app?.currentLevelParam() ?? "1",
                  "mode": (app?.mode ?? .assault).rawValue])
    }
    func createRoom() { net.send(["type": "createRoom"]) }
    func joinRoom(_ id: Int) { net.send(["type": "joinRoom", "roomId": id]) }
    func leaveRoom() { net.send(["type": "leaveRoom"]) }
    func startMatch() { net.send(["type": "startMatch"]) }
    /* the end screen's NEXT MAP: the server mints a follow-up match for
       everyone still connected, on the next map in its bundle */
    func nextMatch() { net.send(["type": "nextMatch"]) }
    var isConnected: Bool { net.isConnected }
    /* everyone we were fighting has dropped out — what the server checks before
       it mints a follow-up match, and what the boot handshake gives up on */
    var enemiesAllGone: Bool {
        guard let mine = pending?.config.myTeam else { return false }
        let enemies = bootRoster.filter { $0.team != mine }
        return !enemies.isEmpty && enemies.allSatisfy { goneIds.contains($0.id) }
    }
    /* pick the room's map — the server rejects this from anyone but its owner */
    func setLevel(_ param: String) { net.send(["type": "setLevel", "level": param]) }
    /* …and its mode, same rule */
    func setMode(_ mode: GameMode) { net.send(["type": "setMode", "mode": mode.rawValue]) }

    func pickTeam(_ team: Team) {
        // tapping my own team steps back off the roster
        let value: Any = (team == myTeam) ? NSNull() : team.wire
        net.send(["type": "team", "team": value])
    }

    // MARK: - Event routing

    private func handleEvent(_ type: String, _ obj: [String: Any]) {
        /* who is still in the match, tracked for its whole life — the boot
           handshake, the fight and the end screen, which needs it to know
           whether a next map is possible at all. peerLeft/peerJoined are
           match-only messages; lobby churn arrives as a `lobby` broadcast. */
        if let id = jInt(obj, "id") {
            if type == "peerLeft" { goneIds.insert(id) }
            else if type == "peerJoined" { goneIds.remove(id) }
        }

        // during a live match, forward peer churn to the engine
        if app?.screen == .playing {
            switch type {
            case "matchStart":
                // another pilot's end screen already rolled the match on to
                // the next map (ours is a beat behind) — go with them
                startBoot(obj)
            case "peerLeft":
                if let id = jInt(obj, "id") {
                    let nm = jStr(obj, "name") ?? ""
                    app?.engine.enqueue { [weak self] in self?.app?.engine.handlePeerLeft(id: id, name: nm) }
                }
            case "peerJoined":
                if let id = jInt(obj, "id") {
                    let nm = jStr(obj, "name") ?? ""
                    app?.engine.enqueue { [weak self] in self?.app?.engine.handlePeerJoined(id: id, name: nm) }
                }
            default: break
            }
            return
        }

        switch type {
        case "joined":
            myId = jInt(obj, "id")
            myName = jStr(obj, "name") ?? name
            name = myName
            UserDefaults.standard.set(myName, forKey: "mechMpName")
            phase = .rooms
            // the server suffixes a callsign somebody else is already on rather
            // than turning the join down — say so, it is the name everyone sees
            if jBool(obj, "renamed") { showBanner("CALLSIGN TAKEN — YOU ARE \(myName)") }
            // the room list that follows `joined` decides whether to walk in
            autoRoom = true

        case "lobby":
            parseLobby(obj)

        case "matchStart":
            startBoot(obj)

        case "error":
            let msg = jStr(obj, "message") ?? "ERROR"
            if app?.screen == .over { app?.noNextMap(msg) }   // NEXT MAP turned down
            else if phase == .matchBoot { failMatch(msg) }
            else if myId != nil { showBanner(msg) }
            else { setStatus(msg, error: true) }

        case "rejoined":
            guard phase == .matchBoot, !isDead else { return }
            renderBoot(sub: "")
            ready()   // START MATCH was the decision; nobody presses DEPLOY twice

        case "ready":
            guard phase == .matchBoot, !isDead else { return }
            let c = jInt(obj, "count") ?? 0, t = jInt(obj, "total") ?? 0
            bootStatus = "\(c)/\(t) PILOTS READY…"

        case "go":
            guard phase == .matchBoot, !isDead, app?.screen != .playing else { return }
            // normally the map is long since here — it downloads while the
            // pilots are still hitting DEPLOY
            if levelPending {
                goPending = true
                bootStatus = "LOADING THE MAP…"
            } else {
                beginMatch()
            }

        case "peerLeft":
            // left while the end screen was up: the roster a next map would be
            // built from just emptied out
            if app?.screen == .over {
                if enemiesAllGone { app?.noNextMap(AppModel.NO_NEXT_MATCH) }
                return
            }
            guard phase == .matchBoot, !isDead else { return }
            if enemiesAllGone { failMatch("THE OTHER TEAM LEFT THE MATCH") }
            else { renderBoot(sub: nil) }

        case "peerJoined":
            guard phase == .matchBoot, !isDead else { return }
            renderBoot(sub: nil)

        default:
            break
        }
    }

    private func parseLobby(_ obj: [String: Any]) {
        var rs: [RoomInfo] = []
        for r in (obj["rooms"] as? [[String: Any]]) ?? [] {
            guard let id = jInt(r, "id") else { continue }
            rs.append(RoomInfo(id: id, name: jStr(r, "name") ?? "ROOM", count: jInt(r, "count") ?? 0,
                               owner: jInt(r, "owner") ?? 0, level: jStr(r, "level") ?? "1",
                               mode: GameMode(rawValue: jStr(r, "mode") ?? "") ?? .assault))
        }
        var ps: [LobbyPlayer] = []
        for p in (obj["players"] as? [[String: Any]]) ?? [] {
            guard let id = jInt(p, "id") else { continue }
            ps.append(LobbyPlayer(id: id, name: jStr(p, "name") ?? "?",
                                  room: jInt(p, "room"), team: Team(wire: jStr(p, "team"))))
        }
        rooms = rs
        players = ps
        let me = ps.first { $0.id == myId }
        myRoom = me?.room
        myTeam = me?.team

        /* One room with space in it is not a choice, so don't make it one:
           walk straight in. Only on the way into the lobby, never again —
           leaving a room and being pulled back into the one just left would
           be the opposite of smooth. (game/ui/lobby.js does the same.) */
        if autoRoom {
            autoRoom = false
            if myRoom == nil, rs.count == 1, rs[0].count < LOBBY_ROOM_MAX {
                setStatus("JOINING \(rs[0].name)…")
                joinRoom(rs[0].id)
                return   // the roster broadcast that follows renders the room
            }
        }
        phase = (myRoom == nil) ? .rooms : .inRoom
        updatePreview()

        if myRoom == nil {
            setStatus("CREATE A ROOM OR JOIN ONE — EACH ROOM STAGES ITS OWN MATCH")
        } else {
            let members = ps.filter { $0.room == myRoom }
            let blue = members.filter { $0.team == .blue }.count
            let red = members.filter { $0.team == .red }.count
            if myTeam == nil { setStatus("PICK A TEAM — BLUE OR RED") }
            else if blue == 0 || red == 0 { setStatus("WAITING FOR PILOTS ON THE OTHER TEAM…") }
            else if iOwnRoom { setStatus("READY — YOUR ROOM, YOUR CALL: \(roomMode.label) ON \(roomMapTitle)") }
            else { setStatus("READY — THE ROOM PLAYS \(roomMode.label) ON \(roomMapTitle), PICKED BY ITS CREATOR") }
        }
    }

    var canStart: Bool {
        guard let myRoom, myTeam != nil else { return false }
        let members = players.filter { $0.room == myRoom }
        return members.contains { $0.team == .blue } && members.contains { $0.team == .red }
    }

    // MARK: - The room's map

    /* show the room's map behind the lobby: fetch its terrain from the server
       and let AppModel rebuild the menu scene on it. Outside a room the
       preview goes back to the single-player choice. */
    private func updatePreview() {
        guard app?.screen == .lobby else { return }   // never swap a match's engine
        guard let param = myRoom == nil ? nil : myRoomInfo?.level else {
            previewParam = nil
            app?.clearPreview()
            return
        }
        guard param != previewParam else { return }
        previewParam = param
        if let cached = levelCache[param] { app?.previewLevel(cached); return }
        guard let url = net.levelURL(param: param) else { return }
        fetchServerLevel(param: param, url: url) { [weak self] info in
            guard let self, let info, self.previewParam == param,   // moved on
                  self.app?.screen == .lobby else { return }
            self.levelCache[param] = info
            self.app?.previewLevel(info)
        }
    }

    var myRoomInfo: RoomInfo? { rooms.first { $0.id == myRoom } }
    /* the map is the creator's call; everyone else just reads it */
    var iOwnRoom: Bool { myId != nil && myRoomInfo?.owner == myId }
    var roomMapParam: String { myRoomInfo?.level ?? "1" }
    var roomMode: GameMode { myRoomInfo?.mode ?? .assault }
    var roomMapTitle: String { mapTitle(roomMapParam) }

    /* ◂ / ▸ in the room: the neighbouring map in the server's list, wrapping
       at both ends. The room broadcast is what confirms it (and corrects it
       if the server refuses), exactly like picking from the list. */
    func stepMap(_ dir: Int) {
        guard maps.count > 1, let i = maps.firstIndex(where: { $0.param == roomMapParam }) else { return }
        let n = maps.count
        setLevel(maps[((i + dir) % n + n) % n].param)
    }
    /* a map the server listed, or the bare param if this server never
       answered /levels (then the picker is hidden anyway) */
    func mapTitle(_ param: String) -> String {
        maps.first { $0.param == param }?.title ?? param.uppercased()
    }

    /* the terrain a map thumbnail is drawn from (UI/LobbyStyles.swift): the
       server's own copy if the preview already fetched it, otherwise our
       bundled snapshot. Cosmetic either way — a stale bundle draws a slightly
       wrong picture, never a wrong match, since the match itself always
       fetches its map from the server. */
    func levelText(param: String) -> String? {
        levelCache[param]?.text ?? app?.bundledLevelText(param: param)
    }

    // MARK: - Match boot

    private var isDead: Bool { phase == .dead }

    private func startBoot(_ obj: [String: Any]) {
        guard let matchId = jStr(obj, "matchId"), let token = jStr(obj, "token"),
              let pid = jInt(obj, "playerId"), let team = Team(wire: jStr(obj, "team")) else { return }
        // a follow-up match (NEXT MAP) arrives while the finished one is still
        // on screen: throw it away and show the boot handshake instead
        if app?.screen != .lobby { app?.enterMatchBoot() }
        var roster: [MPPlayer] = []
        for p in (obj["roster"] as? [[String: Any]]) ?? [] {
            if let id = jInt(p, "id"), let t = Team(wire: jStr(p, "team")) {
                roster.append(MPPlayer(id: id, name: jStr(p, "name") ?? "?", team: t))
            }
        }
        let config = MPConfig(playerId: pid, myTeam: team, name: myName,
                              roster: roster, matchId: matchId, token: token,
                              mode: GameMode(rawValue: jStr(obj, "mode") ?? "") ?? .assault)
        let levelParam = jStr(obj, "level") ?? "1"
        pending = (config, levelParam)
        bootRoster = roster
        goneIds.removeAll()
        phase = .matchBoot
        bootStatus = "CONNECTING TO THE MATCH…"
        // the server already dropped our lobby-client record when it minted the
        // match, so we can rejoin on this same socket
        net.send(["type": "rejoin", "matchId": matchId, "token": token])
        fetchMatchLevel(param: levelParam, matchId: matchId)
    }

    /* pull the match's map off the server while the ready handshake runs —
       the room's level param is resolved against the *deployed* bundle,
       not our bundled copy of it, so every client fights on one map */
    private func fetchMatchLevel(param: String, matchId: String) {
        matchLevel = nil
        goPending = false
        guard let url = net.levelURL(param: param) else { levelPending = false; return }
        levelPending = true
        fetchServerLevel(param: param, url: url) { [weak self] info in
            guard let self, self.pending?.config.matchId == matchId else { return }  // stale boot
            self.levelPending = false
            self.matchLevel = info      // nil → AppModel falls back to the bundle
            if self.goPending { self.beginMatch() }
        }
    }

    private func beginMatch() {
        goPending = false
        guard phase == .matchBoot, !isDead, app?.screen != .playing, let pending else { return }
        app?.startMatch(config: pending.config, levelParam: pending.levelParam, level: matchLevel)
    }

    /* Reporting in for the match. Sent the moment the rejoin lands rather than
       off a button: the pilot already committed in the lobby, and a second
       DEPLOY press per client only held everyone else up. */
    func ready() {
        guard phase == .matchBoot, !isDead else { return }
        app?.engine.audio.startMusic()
        net.send(["type": "ready"])
        bootStatus = "WAITING FOR THE OTHER PILOTS…"
    }

    private func renderBoot(sub: String?) {
        if let sub { bootStatus = sub.isEmpty
            ? "YOU FIGHT FOR THE \(pending?.config.myTeam.wire.uppercased() ?? "") TEAM — DESTROY THEIR BASE"
            : sub }
    }

    private func failMatch(_ text: String) {
        phase = .dead
        bootStatus = text
    }

    /* leave a dead/finished match and reopen the lobby with the same name */
    func backToLobby() {
        pending = nil
        net.disconnect()
        DispatchQueue.main.async { [weak self] in self?.open(autoJoin: true) }
    }

    // MARK: - Helpers

    var bootMyTeam: Team? { pending?.config.myTeam }

    func rosterNames(team: Team) -> [(name: String, gone: Bool, me: Bool)] {
        bootRoster.filter { $0.team == team }.map {
            ($0.name, goneIds.contains($0.id), $0.id == pending?.config.playerId)
        }
    }

    private func setStatus(_ text: String, error: Bool = false) {
        status = text
        statusIsError = error
    }

    private func showBanner(_ text: String) {
        banner = text
        bannerTask?.cancel()
        let task = DispatchWorkItem { [weak self] in self?.banner = nil }
        bannerTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: task)
    }
}
