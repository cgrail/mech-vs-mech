import Foundation
import Combine

/* ============================================================
   Multiplayer lobby + match-boot — ports ui/lobby.js.

   Lobby: pick a callsign → join → create/join a room → pick a
   team (max 5/side) → START MATCH once both sides have a pilot.
   The server mints a match and everyone gets `matchStart`.

   Match boot: unlike the web (which reloads the page), iOS keeps
   the same socket — the server already released our lobby-client
   record when the match was minted, so we just `rejoin` by token,
   run the READY handshake, and start on `go`.
============================================================ */

let LOBBY_TEAM_MAX = 5

struct RoomInfo: Identifiable {
    let id: Int
    let name: String
    let count: Int
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

    // match boot
    @Published var bootRoster: [MPPlayer] = []
    @Published var bootStatus = ""
    @Published var readyShown = false

    private var myName = ""
    private var pending: (config: MPConfig, levelParam: String)?
    private var goneIds = Set<Int>()
    private var autoJoin = false
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
        phase = .connecting
        setStatus("CONNECTING TO SERVER…")
        if net.isConnected { handleOpen() } else { net.connect() }
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
            phase = .connecting
            myId = nil; myRoom = nil; myTeam = nil
            setStatus("CANNOT REACH THE SERVER — CHECK YOUR CONNECTION AND TRY AGAIN", error: true)
        }
    }

    // MARK: - Lobby actions

    func join() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        net.send(["type": "join", "name": n, "level": app?.currentLevelParam() ?? "1"])
    }
    func createRoom() { net.send(["type": "createRoom"]) }
    func joinRoom(_ id: Int) { net.send(["type": "joinRoom", "roomId": id]) }
    func leaveRoom() { net.send(["type": "leaveRoom"]) }
    func startMatch() { net.send(["type": "startMatch"]) }

    func pickTeam(_ team: Team) {
        // tapping my own team steps back off the roster
        let value: Any = (team == myTeam) ? NSNull() : team.wire
        net.send(["type": "team", "team": value])
    }

    // MARK: - Event routing

    private func handleEvent(_ type: String, _ obj: [String: Any]) {
        // during a live match, forward peer churn to the engine
        if app?.screen == .playing {
            switch type {
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

        case "lobby":
            parseLobby(obj)

        case "matchStart":
            startBoot(obj)

        case "error":
            let msg = jStr(obj, "message") ?? "ERROR"
            if phase == .matchBoot { failMatch(msg) }
            else if myId != nil { showBanner(msg) }
            else { setStatus(msg, error: true) }

        case "rejoined":
            guard phase == .matchBoot, !isDead else { return }
            renderBoot(sub: "")
            readyShown = true

        case "ready":
            guard phase == .matchBoot, !isDead else { return }
            let c = jInt(obj, "count") ?? 0, t = jInt(obj, "total") ?? 0
            bootStatus = "\(c)/\(t) PILOTS READY…"

        case "go":
            guard phase == .matchBoot, !isDead, app?.screen != .playing else { return }
            if let pending { app?.startMatch(config: pending.config, levelParam: pending.levelParam) }

        case "peerLeft":
            guard phase == .matchBoot, !isDead, let id = jInt(obj, "id") else { return }
            goneIds.insert(id)
            let enemies = bootRoster.filter { $0.team != pending?.config.myTeam }
            if !enemies.isEmpty && enemies.allSatisfy({ goneIds.contains($0.id) }) {
                failMatch("THE OTHER TEAM LEFT THE MATCH")
            } else {
                renderBoot(sub: nil)
            }

        case "peerJoined":
            guard phase == .matchBoot, !isDead, let id = jInt(obj, "id") else { return }
            goneIds.remove(id)
            renderBoot(sub: nil)

        default:
            break
        }
    }

    private func parseLobby(_ obj: [String: Any]) {
        var rs: [RoomInfo] = []
        for r in (obj["rooms"] as? [[String: Any]]) ?? [] {
            guard let id = jInt(r, "id") else { continue }
            rs.append(RoomInfo(id: id, name: jStr(r, "name") ?? "ROOM", count: jInt(r, "count") ?? 0))
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
        phase = (myRoom == nil) ? .rooms : .inRoom

        if myRoom == nil {
            setStatus("CREATE A ROOM OR JOIN ONE — EACH ROOM STAGES ITS OWN MATCH")
        } else {
            let members = ps.filter { $0.room == myRoom }
            let blue = members.filter { $0.team == .blue }.count
            let red = members.filter { $0.team == .red }.count
            if myTeam == nil { setStatus("PICK A TEAM — BLUE OR RED") }
            else if blue == 0 || red == 0 { setStatus("WAITING FOR PILOTS ON THE OTHER TEAM…") }
            else { setStatus("READY — STARTING PLAYS YOUR LEVEL FOR EVERYONE IN THE ROOM") }
        }
    }

    var canStart: Bool {
        guard let myRoom, myTeam != nil else { return false }
        let members = players.filter { $0.room == myRoom }
        return members.contains { $0.team == .blue } && members.contains { $0.team == .red }
    }

    // MARK: - Match boot

    private var isDead: Bool { phase == .dead }

    private func startBoot(_ obj: [String: Any]) {
        guard let matchId = jStr(obj, "matchId"), let token = jStr(obj, "token"),
              let pid = jInt(obj, "playerId"), let team = Team(wire: jStr(obj, "team")) else { return }
        var roster: [MPPlayer] = []
        for p in (obj["roster"] as? [[String: Any]]) ?? [] {
            if let id = jInt(p, "id"), let t = Team(wire: jStr(p, "team")) {
                roster.append(MPPlayer(id: id, name: jStr(p, "name") ?? "?", team: t))
            }
        }
        let config = MPConfig(playerId: pid, myTeam: team, name: myName,
                              roster: roster, matchId: matchId, token: token)
        pending = (config, jStr(obj, "level") ?? "1")
        bootRoster = roster
        goneIds.removeAll()
        readyShown = false
        phase = .matchBoot
        bootStatus = "CONNECTING TO THE MATCH…"
        // the server already dropped our lobby-client record when it minted the
        // match, so we can rejoin on this same socket
        net.send(["type": "rejoin", "matchId": matchId, "token": token])
    }

    /* the DEPLOY button in the match-boot screen */
    func ready() {
        guard phase == .matchBoot, !isDead else { return }
        app?.engine.audio.startMusic()   // unlock audio on the user gesture
        net.send(["type": "ready"])
        readyShown = false
        bootStatus = "WAITING FOR THE OTHER PILOTS TO DEPLOY…"
    }

    private func renderBoot(sub: String?) {
        if let sub { bootStatus = sub.isEmpty
            ? "YOU FIGHT FOR THE \(pending?.config.myTeam.wire.uppercased() ?? "") TEAM — DESTROY THEIR BASE"
            : sub }
    }

    private func failMatch(_ text: String) {
        phase = .dead
        readyShown = false
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
