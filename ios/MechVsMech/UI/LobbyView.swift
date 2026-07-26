import SwiftUI

/* ============================================================
   Multiplayer lobby + match-boot UI — ports the lobby/match
   screens of index.html, driven by LobbyModel (ports lobby.js).
   Styling follows style.css (UI/Styles.swift); OverlayFrame
   scales the screen down rather than clipping it on small phones.
============================================================ */
struct LobbyView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var lobby: LobbyModel

    var body: some View {
        OverlayFrame {
            LobbyBody(lobby: lobby)
        }
    }
}

private struct LobbyBody: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var lobby: LobbyModel
    @Environment(\.overlaySize) private var size
    /* the room owner's map list, shown in place of the team columns */
    @State private var pickingMap = false

    /* the lobby's columns stay legible down to an SE: they shrink with the
       screen and OverlayFrame scales whatever is still too big */
    private var colWidth: CGFloat { min(560, max(320, size.width - 40)) }

    var body: some View {
        VStack(spacing: 14) {
            ScreenTitle(text: lobby.phase == .matchBoot || lobby.phase == .dead
                        ? "MULTIPLAYER MATCH" : "MULTIPLAYER LOBBY")

            if let banner = lobby.banner {
                Text(banner)
                    .font(.system(size: 13, weight: .semibold)).kerning(1)
                    .foregroundColor(Color(hex: 0xffe8a0))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0x282008).opacity(0.9)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Skin.gold, lineWidth: 1))
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
                GhostButton(label: "◂ BACK") { model.leaveLobby() }
            }
        }
        .padding(8)
        .frame(maxWidth: 620)
    }

    private var statusText: some View {
        Text(lobby.status)
            .font(.system(size: 12, weight: .semibold)).kerning(2)
            .foregroundColor(lobby.statusIsError ? Color(hex: 0xff8a7a) : Skin.dimText)
            .multilineTextAlignment(.center)
    }

    // MARK: - Callsign

    private var callsign: some View {
        VStack(spacing: 12) {
            statusText
            HStack(spacing: 10) {
                TextField("YOUR CALLSIGN", text: $lobby.name)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 14, weight: .bold))
                    .kerning(2)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Skin.panel))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Skin.border, lineWidth: 1))
                    .foregroundColor(Skin.lightText)
                    .frame(width: 200)
                    .onSubmit { lobby.join() }
                Button {
                    lobby.join()
                } label: {
                    Text("ENTER LOBBY").font(.system(size: 13, weight: .heavy)).kerning(2)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
            }
        }
    }

    // MARK: - Room browser

    private var roomBrowser: some View {
        VStack(spacing: 10) {
            Button {
                lobby.createRoom()
            } label: {
                Text("+ CREATE ROOM").font(.system(size: 13, weight: .heavy)).kerning(2)
            }
            .buttonStyle(MenuButtonStyle(prominent: true))

            ScrollView {
                VStack(spacing: 10) {
                    if lobby.rooms.isEmpty {
                        row(name: "NO ROOMS YET", detail: "CREATE THE FIRST ONE")
                    } else {
                        ForEach(lobby.rooms) { r in
                            HStack(spacing: 14) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.name)
                                        .font(.system(size: 14, weight: .bold)).kerning(2)
                                        .foregroundColor(Skin.lightText)
                                    Text(lobby.mapTitle(r.level)
                                        + (r.mode == .ctf ? " · 🚩 CTF" : ""))
                                        .font(.system(size: 11)).kerning(1)
                                        .foregroundColor(Skin.dimText)
                                }
                                Spacer(minLength: 4)
                                Text("\(r.count) PILOT\(r.count == 1 ? "" : "S")")
                                    .font(.system(size: 11)).kerning(1)
                                    .foregroundColor(Skin.dimText)
                                Button {
                                    lobby.joinRoom(r.id)
                                } label: {
                                    Text("JOIN").font(.system(size: 12, weight: .bold)).kerning(2)
                                }
                                .buttonStyle(MenuButtonStyle())
                            }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .listRowBox()
                        }
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(maxWidth: 440, maxHeight: max(120, size.height * 0.42))
        }
    }

    private func row(name: String, detail: String) -> some View {
        HStack {
            Text(name).font(.system(size: 14, weight: .bold)).kerning(2)
                .foregroundColor(Skin.lightText)
            Spacer()
            Text(detail).font(.system(size: 11)).kerning(1).foregroundColor(Skin.dimText)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .listRowBox()
    }

    // MARK: - Inside a room

    private var room: some View {
        let members = lobby.players.filter { $0.room == lobby.myRoom }
        return VStack(spacing: 12) {
            HStack {
                Text(lobby.myRoomInfo?.name ?? "ROOM")
                    .font(.system(size: 14, weight: .heavy)).kerning(2)
                    .foregroundColor(Skin.gold)
                Spacer()
                GhostButton(label: "◂ LEAVE ROOM") { lobby.leaveRoom() }
            }
            .frame(width: colWidth)

            mapRow
            modeRow

            if pickingMap {
                mapList
            } else {
                HStack(alignment: .top, spacing: 14) {
                    teamColumn(.blue, members: members)
                    teamColumn(.red, members: members)
                }
                .frame(width: colWidth)

                statusText

                Button {
                    lobby.startMatch()
                } label: {
                    Text("⚔ START MATCH").font(.system(size: 14, weight: .heavy)).kerning(3)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
                .disabled(!lobby.canStart)
                .opacity(lobby.canStart ? 1 : 0.5)
                .grayscale(lobby.canStart ? 0 : 1)
            }
        }
        // a room I don't own has no picker to leave open — and neither does one
        // on a server that never answered /levels
        .onChange(of: lobby.iOwnRoom) { if !$1 { pickingMap = false } }
        .onChange(of: lobby.myRoom) { pickingMap = false }
    }

    /* the map this room plays: its creator taps to change it, everyone else
       reads it. The list itself comes from the server (see LobbyModel.maps),
       so it can only ever offer maps the server can serve. */
    private var mapRow: some View {
        let canPick = lobby.iOwnRoom && !lobby.maps.isEmpty
        return HStack(spacing: 8) {
            Text("MAP")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(Skin.dimText)
            if canPick {
                // ◂ ▸ step to the neighbouring map without opening the list
                Button { lobby.stepMap(-1) } label: {
                    Text("◂").font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(MenuButtonStyle())
                Button { pickingMap.toggle() } label: {
                    HStack(spacing: 6) {
                        Text(lobby.roomMapTitle)
                            .font(.system(size: 12, weight: .bold)).kerning(1)
                            .lineLimit(1)
                        Text(pickingMap ? "▴" : "▾").font(.system(size: 11, weight: .black))
                    }
                }
                .buttonStyle(MenuButtonStyle())
                Button { lobby.stepMap(1) } label: {
                    Text("▸").font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(MenuButtonStyle())
            } else {
                Text(lobby.roomMapTitle)
                    .font(.system(size: 12, weight: .bold)).kerning(1)
                    .foregroundColor(Skin.lightText)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if !lobby.iOwnRoom {
                Text("PICKED BY THE ROOM'S CREATOR")
                    .font(.system(size: 10)).kerning(1)
                    .foregroundColor(Skin.dimText)
            }
        }
        .frame(width: colWidth)
    }

    /* the mode this room plays, on the same rule as the map: its creator
       taps to switch it, everyone else reads it */
    private var modeRow: some View {
        HStack(spacing: 8) {
            Text("MODE")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(Skin.dimText)
            if lobby.iOwnRoom {
                ForEach(GameMode.allCases, id: \.self) { m in
                    PillToggle(label: m.label, selected: lobby.roomMode == m) { lobby.setMode(m) }
                }
            } else {
                Text(lobby.roomMode.label)
                    .font(.system(size: 12, weight: .bold)).kerning(1)
                    .foregroundColor(Skin.lightText)
            }
            Spacer(minLength: 4)
        }
        .frame(width: colWidth)
    }

    private var mapList: some View {
        VStack(spacing: 10) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(Array(lobby.maps.enumerated()), id: \.element.id) { i, m in
                            mapRowButton(index: i, map: m)
                        }
                    }
                    .padding(.horizontal, 6)
                }
                .frame(maxWidth: 460, maxHeight: max(140, size.height * 0.5))
                .onAppear { proxy.scrollTo(lobby.roomMapParam, anchor: .center) }
            }
            GhostButton(label: "◂ DONE") { pickingMap = false }
        }
    }

    private func mapRowButton(index: Int, map: ServerLevel) -> some View {
        let selected = map.param == lobby.roomMapParam
        return Button {
            lobby.setLevel(map.param)     // the lobby broadcast confirms it
            pickingMap = false
        } label: {
            HStack(spacing: 14) {
                Text("\(index + 1)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(selected ? Skin.gold : Color(hex: 0x8a97b6))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 4)
                        .stroke(selected ? Skin.gold : Skin.borderLit, lineWidth: 1))
                VStack(alignment: .leading, spacing: 3) {
                    Text(map.title)
                        .font(.system(size: 14, weight: .bold)).kerning(2)
                        .foregroundColor(selected ? Skin.gold : Skin.lightText)
                    if !map.desc.isEmpty {
                        Text(map.desc)
                            .font(.system(size: 12))
                            .foregroundColor(Skin.dimText)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .listRowBox(selected: selected)
        }
        .id(map.param)
    }

    private func teamColumn(_ team: Team, members: [LobbyPlayer]) -> some View {
        let teamed = members.filter { $0.team == team }
        let head = team == .blue ? Color(hex: 0x8fb7ff) : Color(hex: 0xff9a8a)
        let slot = team == .blue ? Color(hex: 0x3d7bff).opacity(0.12) : Color(hex: 0xff4a3d).opacity(0.10)
        let edge = team == .blue ? Color(hex: 0x2f4a7a) : Color(hex: 0x7a3a2f)
        let full = lobby.myTeam != team && teamed.count >= LOBBY_TEAM_MAX
        return VStack(spacing: 6) {
            Text("\(team.wire.uppercased()) TEAM \(teamed.count)/\(LOBBY_TEAM_MAX)")
                .font(.system(size: 12, weight: .heavy)).kerning(2)
                .foregroundColor(head)
            VStack(spacing: 4) {
                ForEach(teamed) { p in
                    Text(p.id == lobby.myId ? "\(p.name) (YOU)" : p.name)
                        .font(.system(size: 12, weight: p.id == lobby.myId ? .bold : .regular)).kerning(1)
                        .foregroundColor(p.id == lobby.myId ? Skin.gold : Skin.lightText)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: 6).fill(slot))
                }
                ForEach(teamed.count..<LOBBY_TEAM_MAX, id: \.self) { _ in
                    Text("OPEN SLOT")
                        .font(.system(size: 12)).kerning(1)
                        .foregroundColor(Color(hex: 0x55617a))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .overlay(RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(Color(hex: 0x33405f), style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                }
            }
            Button {
                lobby.pickTeam(team)
            } label: {
                Text(lobby.myTeam == team ? "LEAVE TEAM" : "JOIN \(team.wire.uppercased())")
                    .font(.system(size: 12, weight: .heavy)).kerning(2)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(MenuButtonStyle(prominent: lobby.myTeam != team))
            .disabled(full)
            .opacity(full ? 0.5 : 1)
            .grayscale(full ? 1 : 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 10).fill(Skin.panelSoft))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(edge, lineWidth: 1))
    }

    // MARK: - Match boot (rejoin + ready handshake)

    private var matchBoot: some View {
        VStack(spacing: 12) {
            VStack(spacing: 8) {
                bootTeam(.blue)
                bootTeam(.red)
            }
            .frame(maxWidth: 520)
            .panelBox()

            Text(lobby.bootStatus)
                .font(.system(size: 12)).kerning(1)
                .foregroundColor(Skin.dimText)
                .multilineTextAlignment(.center)

            if lobby.phase == .dead {
                Button {
                    lobby.backToLobby()
                } label: {
                    Text("◂ BACK TO LOBBY").font(.system(size: 14, weight: .heavy)).kerning(2)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
            } else if lobby.readyShown {
                Button {
                    lobby.ready()
                } label: {
                    Text("⚔ DEPLOY").font(.system(size: 18, weight: .heavy)).kerning(3).frame(minWidth: 180)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
            }
        }
    }

    private func bootTeam(_ team: Team) -> some View {
        let head = team == .blue ? Color(hex: 0x8fb7ff) : Color(hex: 0xff9a8a)
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(team.wire.uppercased()) TEAM")
                .font(.system(size: 12, weight: .heavy)).kerning(2)
                .foregroundColor(head)
            ForEach(Array(lobby.rosterNames(team: team).enumerated()), id: \.offset) { _, p in
                Text(p.me ? "\(p.name) (YOU)" : p.name)
                    .font(.system(size: 13, weight: .bold)).kerning(1)
                    .foregroundColor(p.gone ? Color(hex: 0x55617a) : (p.me ? Skin.gold : Skin.lightText))
                    .strikethrough(p.gone)
            }
            Spacer(minLength: 0)
        }
    }
}
