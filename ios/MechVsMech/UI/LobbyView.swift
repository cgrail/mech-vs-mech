import SwiftUI

/* ============================================================
   Multiplayer lobby + match-boot UI — ports the lobby/match
   screens of index.html, driven by LobbyModel (ports lobby.js).
============================================================ */
struct LobbyView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var lobby: LobbyModel

    var body: some View {
        OverlayFrame {
            VStack(spacing: 14) {
                Text(lobby.phase == .matchBoot || lobby.phase == .dead ? "MULTIPLAYER MATCH" : "MULTIPLAYER LOBBY")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .kerning(3)

                if let banner = lobby.banner {
                    Text(banner)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(Color(hex: 0xffd23c))
                }

                switch lobby.phase {
                case .connecting:
                    statusText
                case .callsign:
                    callsign
                case .rooms:
                    statusText
                    roomBrowser
                case .inRoom:
                    room
                case .matchBoot, .dead:
                    matchBoot
                }

                if lobby.phase != .matchBoot && lobby.phase != .dead {
                    Button("◂ BACK") { model.leaveLobby() }
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            .padding()
            .frame(maxWidth: 520)
        }
    }

    private var statusText: some View {
        Text(lobby.status)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundColor(lobby.statusIsError ? Color(hex: 0xff8a7a) : .white.opacity(0.75))
            .multilineTextAlignment(.center)
    }

    // MARK: - Callsign

    private var callsign: some View {
        VStack(spacing: 12) {
            statusText
            HStack(spacing: 8) {
                TextField("YOUR CALLSIGN", text: $lobby.name)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.1)))
                    .foregroundColor(.white)
                    .frame(width: 220)
                    .onSubmit { lobby.join() }
                Button("ENTER") { lobby.join() }
                    .buttonStyle(MenuButtonStyle(prominent: true))
            }
        }
    }

    // MARK: - Room browser

    private var roomBrowser: some View {
        VStack(spacing: 8) {
            Button { lobby.createRoom() } label: {
                Text("+ CREATE ROOM").font(.system(size: 14, weight: .heavy, design: .rounded)).frame(width: 300)
            }
            .buttonStyle(MenuButtonStyle(prominent: true))

            ScrollView {
                VStack(spacing: 6) {
                    if lobby.rooms.isEmpty {
                        row(name: "NO ROOMS YET", detail: "CREATE THE FIRST ONE")
                    } else {
                        ForEach(lobby.rooms) { r in
                            HStack {
                                Text(r.name).font(.system(size: 13, weight: .heavy, design: .rounded))
                                Spacer()
                                Text("\(r.count) PILOT\(r.count == 1 ? "" : "S")")
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .foregroundColor(.white.opacity(0.6))
                                Button("JOIN") { lobby.joinRoom(r.id) }
                                    .buttonStyle(MenuButtonStyle())
                            }
                            .padding(8)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)))
                            .foregroundColor(.white)
                        }
                    }
                }
            }
            .frame(maxWidth: 360, maxHeight: 220)
        }
    }

    private func row(name: String, detail: String) -> some View {
        HStack {
            Text(name).font(.system(size: 13, weight: .heavy, design: .rounded))
            Spacer()
            Text(detail).font(.system(size: 11, weight: .medium, design: .rounded)).foregroundColor(.white.opacity(0.5))
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)))
        .foregroundColor(.white)
    }

    // MARK: - Inside a room

    private var room: some View {
        let members = lobby.players.filter { $0.room == lobby.myRoom }
        return VStack(spacing: 10) {
            HStack {
                Text(lobby.rooms.first { $0.id == lobby.myRoom }?.name ?? "ROOM")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                Spacer()
                Button("◂ LEAVE ROOM") { lobby.leaveRoom() }
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundColor(.white.opacity(0.7))
            }
            .frame(width: 420)

            HStack(alignment: .top, spacing: 14) {
                teamColumn(.blue, members: members)
                teamColumn(.red, members: members)
            }

            statusText

            Button { lobby.startMatch() } label: {
                Text("⚔ START MATCH").font(.system(size: 18, weight: .black, design: .rounded)).frame(width: 260)
            }
            .buttonStyle(MenuButtonStyle(prominent: true))
            .disabled(!lobby.canStart)
            .opacity(lobby.canStart ? 1 : 0.5)
        }
    }

    private func teamColumn(_ team: Team, members: [LobbyPlayer]) -> some View {
        let teamed = members.filter { $0.team == team }
        let color = team == .blue ? Color(hex: 0x2b4fd8) : Color(hex: 0xa42a20)
        return VStack(spacing: 5) {
            Text("\(team.wire.uppercased()) TEAM \(teamed.count)/\(LOBBY_TEAM_MAX)")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundColor(color.opacity(0.95))
            VStack(spacing: 3) {
                ForEach(teamed) { p in
                    Text(p.id == lobby.myId ? "\(p.name) (YOU)" : p.name)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .frame(width: 150, height: 22)
                        .background(RoundedRectangle(cornerRadius: 5).fill(color.opacity(0.35)))
                }
                ForEach(teamed.count..<LOBBY_TEAM_MAX, id: \.self) { _ in
                    Text("OPEN SLOT")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.35))
                        .frame(width: 150, height: 22)
                        .background(RoundedRectangle(cornerRadius: 5).fill(Color.white.opacity(0.05)))
                }
            }
            Button {
                lobby.pickTeam(team)
            } label: {
                Text(lobby.myTeam == team ? "LEAVE TEAM" : "JOIN \(team.wire.uppercased())")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .frame(width: 150)
            }
            .buttonStyle(MenuButtonStyle(prominent: lobby.myTeam != team))
            .disabled(lobby.myTeam != team && teamed.count >= LOBBY_TEAM_MAX)
            .opacity(lobby.myTeam != team && teamed.count >= LOBBY_TEAM_MAX ? 0.5 : 1)
        }
    }

    // MARK: - Match boot (rejoin + ready handshake)

    private var matchBoot: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top, spacing: 20) {
                bootTeam(.blue)
                bootTeam(.red)
            }
            Text(lobby.bootStatus)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)

            if lobby.phase == .dead {
                Button("◂ BACK TO LOBBY") { lobby.backToLobby() }
                    .buttonStyle(MenuButtonStyle(prominent: true))
            } else if lobby.readyShown {
                Button { lobby.ready() } label: {
                    Text("⚔ DEPLOY").font(.system(size: 20, weight: .black, design: .rounded)).frame(width: 240)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
            }
        }
    }

    private func bootTeam(_ team: Team) -> some View {
        let color = team == .blue ? Color(hex: 0x2b4fd8) : Color(hex: 0xa42a20)
        return VStack(spacing: 4) {
            Text("\(team.wire.uppercased()) TEAM")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundColor(color.opacity(0.95))
            ForEach(Array(lobby.rosterNames(team: team).enumerated()), id: \.offset) { _, p in
                Text(p.me ? "\(p.name) (YOU)" : p.name)
                    .font(.system(size: 12, weight: p.me ? .heavy : .medium, design: .rounded))
                    .foregroundColor(p.gone ? .white.opacity(0.3) : .white)
                    .strikethrough(p.gone)
            }
        }
    }
}
