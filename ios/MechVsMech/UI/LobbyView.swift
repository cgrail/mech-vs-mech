import SwiftUI

/* ============================================================
   Multiplayer lobby + match-boot UI — ports the lobby/match
   screens of index.html, driven by LobbyModel (ports lobby.js).

   Laid out as one column of titled cards over the orbiting map
   preview — map, mode, team, one decision per card — with the
   title bar and the one green action button pinned so they are
   never scrolled away. The pieces live in UI/LobbyStyles.swift,
   which also explains why this screen isn't the menus' option
   column. Palette and type still come from style.css by way of
   UI/Styles.swift, so it reads as the same game as the browser.
============================================================ */
struct LobbyView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var lobby: LobbyModel
    /* the room owner's full map list, opened from the map card */
    @State private var pickingMap = false

    private var inMatch: Bool { lobby.phase == .matchBoot || lobby.phase == .dead }
    /* a match boot has no way back but through — the lobby does */
    private var back: (() -> Void)? {
        if inMatch { return nil }
        return { model.leaveLobby() }
    }

    var body: some View {
        LobbyChrome(title: inMatch ? "MULTIPLAYER MATCH" : "MULTIPLAYER LOBBY", onBack: back,
                    scrollTo: pickingMap ? lobby.roomMapParam : nil) {
            VStack(spacing: 12) {
                if let banner = lobby.banner { bannerCard(banner) }
                switch lobby.phase {
                case .connecting: connectingCard
                case .callsign: nameCard
                case .rooms: roomsCard
                case .inRoom: roomCards
                case .matchBoot, .dead: bootCard
                }
            }
        } footer: {
            footerBar
        }
        // a room I don't own has no picker to leave open — and neither does one
        // on a server that never answered /levels
        .onChange(of: lobby.iOwnRoom) { if !$1 { pickingMap = false } }
        .onChange(of: lobby.myRoom) { pickingMap = false }
    }

    // MARK: - The pinned action bar

    @ViewBuilder private var footerBar: some View {
        switch lobby.phase {
        case .connecting:
            EmptyView()

        case .callsign:
            statusLine
            BigActionButton(title: "ENTER LOBBY",
                            enabled: !lobby.name.trimmingCharacters(in: .whitespaces).isEmpty,
                            icon: "arrow.right.to.line") { lobby.join() }

        case .rooms:
            statusLine
            BigActionButton(title: "CREATE ROOM", icon: "plus") { lobby.createRoom() }

        case .inRoom:
            if pickingMap {
                FlatActionButton(title: "DONE", icon: "checkmark") { pickingMap = false }
            } else {
                /* the status line doubles as the button's own caption: it is
                   always the reason the button is or isn't live */
                BigActionButton(title: "START MATCH", subtitle: lobby.status,
                                enabled: lobby.canStart, icon: "shield.lefthalf.filled") {
                    lobby.startMatch()
                }
            }

        case .matchBoot, .dead:
            Text(lobby.bootStatus)
                .font(.system(size: 10, weight: .bold)).kerning(1.5)
                .foregroundColor(lobby.phase == .dead ? Color(hex: 0xff8a7a) : Skin.dimText)
                .multilineTextAlignment(.center)
            // no DEPLOY button: the rejoin reports in by itself, so the only
            // action a boot screen can offer is the way out of a dead one
            if lobby.phase == .dead {
                BigActionButton(title: "BACK TO LOBBY", icon: "chevron.left") { lobby.backToLobby() }
            }
        }
    }

    private var statusLine: some View {
        Text(lobby.status)
            .font(.system(size: 10, weight: .bold)).kerning(1.5)
            .foregroundColor(lobby.statusIsError ? Color(hex: 0xff8a7a) : Skin.dimText)
            .multilineTextAlignment(.center)
            .lineLimit(3)
    }

    private func bannerCard(_ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .bold))
            Text(text)
                .font(.system(size: 11, weight: .heavy)).kerning(1)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .foregroundColor(Color(hex: 0xffe8a0))
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Rectangle().fill(Color(hex: 0x282008).opacity(0.92)))
        .overlay(Rectangle().stroke(Skin.gold, lineWidth: 1))
    }

    // MARK: - Connecting / pilot name

    private var connectingCard: some View {
        SectionCard(icon: "antenna.radiowaves.left.and.right", title: "SERVER") {
            HStack(spacing: 10) {
                ProgressView().tint(Skin.blueText)
                Text(lobby.status)
                    .font(.system(size: 11, weight: .bold)).kerning(1)
                    .foregroundColor(lobby.statusIsError ? Color(hex: 0xff8a7a) : Skin.lightText)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
        }
    }

    private var nameCard: some View {
        SectionCard(icon: "person.crop.square.fill", title: "NAME",
                    note: "OTHER PILOTS SEE THIS") {
            VStack(spacing: 8) {
                // field + dice: the dice deal a fresh name, so nobody has to
                // invent one (three controls is the row's maximum)
                HStack(spacing: 8) {
                    TextField("YOUR NAME", text: $lobby.name)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .font(.system(size: 16, weight: .heavy))
                        .kerning(2)
                        .foregroundColor(Skin.goldSoft)
                        .padding(.horizontal, 12).padding(.vertical, 12)
                        .frame(maxWidth: .infinity)
                        .background(Rectangle().fill(LobbySkin.inset))
                        .overlay(Rectangle().stroke(Skin.border, lineWidth: 1))
                        .onSubmit { lobby.join() }
                    Button {
                        // never deal the name already in the field — that
                        // reads as a dead button
                        var n = randomPilotName()
                        while n == lobby.name { n = randomPilotName() }
                        lobby.name = n
                    } label: {
                        Image(systemName: "dice.fill")
                            .font(.system(size: 16, weight: .heavy))
                            .foregroundColor(Skin.blueText)
                            .frame(width: 46)
                            .frame(maxHeight: .infinity)
                            .background(Rectangle().fill(LobbySkin.inset))
                            .overlay(Rectangle().stroke(Skin.border, lineWidth: 1))
                    }
                    .buttonStyle(CardButtonStyle())
                    .accessibilityLabel("Random name")
                }
                .fixedSize(horizontal: false, vertical: true)
                // the go button sits with the field as well as in the footer:
                // the on-screen keyboard covers the pinned one (join() ignores
                // an empty name, so it needs no state of its own)
                FlatActionButton(title: "ENTER LOBBY", icon: "arrow.right.to.line") { lobby.join() }
                Text("UP TO \(LOBBY_TEAM_MAX) PILOTS PER SIDE · ROOMS STAGE THEIR OWN MATCH")
                    .font(.system(size: 9, weight: .bold)).kerning(1)
                    .foregroundColor(Skin.dimText)
            }
        }
    }

    // MARK: - Room browser

    private var roomsCard: some View {
        SectionCard(icon: "rectangle.stack.fill", title: "ROOMS",
                    note: lobby.rooms.isEmpty ? nil : "\(lobby.rooms.count) OPEN") {
            VStack(spacing: 8) {
                if lobby.rooms.isEmpty {
                    VStack(spacing: 4) {
                        Text("NO ROOMS YET")
                            .font(.system(size: 13, weight: .heavy)).kerning(2)
                            .foregroundColor(Skin.lightText)
                        Text("CREATE THE FIRST ONE AND PICK THE MAP")
                            .font(.system(size: 9, weight: .bold)).kerning(1)
                            .foregroundColor(Skin.dimText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                    .pickBox(selected: false)
                } else {
                    ForEach(lobby.rooms) { r in roomRow(r) }
                }
            }
        }
    }

    private func roomRow(_ r: RoomInfo) -> some View {
        Button {
            lobby.joinRoom(r.id)
        } label: {
            HStack(spacing: 10) {
                MapThumb(text: lobby.levelText(param: r.level))
                    .frame(width: 36, height: 44)
                    .overlay(Rectangle().stroke(Skin.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 4) {
                    Text(r.name)
                        .font(.system(size: 13, weight: .heavy)).kerning(2)
                        .foregroundColor(Skin.lightText)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Image(systemName: r.mode.uiIcon)
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(r.mode.uiTint)
                        Text(lobby.mapTitle(r.level))
                            .font(.system(size: 9, weight: .bold)).kerning(1)
                            .foregroundColor(Skin.dimText)
                            .lineLimit(1)
                        if r.fog {   // this room fights it at night
                            Image(systemName: "moon.fill")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(Skin.blueText)
                        }
                    }
                }
                Spacer(minLength: 4)
                Text("\(r.count)/\(LOBBY_ROOM_MAX)")
                    .font(.system(size: 11, weight: .heavy)).kerning(1)
                    .foregroundColor(r.count >= LOBBY_ROOM_MAX ? LobbySkin.slotText : Skin.goldSoft)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(Skin.blueText)
            }
            .padding(8)
            .pickBox(selected: false)
        }
        .buttonStyle(CardButtonStyle())
    }

    // MARK: - Inside a room

    private var memberCount: Int {
        lobby.players.filter { $0.room == lobby.myRoom }.count
    }

    private var roomCards: some View {
        let members = lobby.players.filter { $0.room == lobby.myRoom }
        return VStack(spacing: 12) {
            roomHeader
            if pickingMap {
                mapListCard
            } else {
                // team first: it is the one decision every pilot in the room
                // makes, while mode and map are the creator's to set
                teamsCard(members)
                modeCard
                mapCard
                viewCard
            }
        }
    }

    /* the weather this room fights in — day or night — on the same rule as the
       map and the mode: its creator switches it, everyone else reads it. Night
       mode (the code's fog of war) only ever hides things from the pilot who
       has it on (Engine/Vision.swift), so it is safe in PvP — but a match where
       one side is at night and the other in daylight is one district in two
       kinds of weather, so it is not the pilot's own call here the way it is in
       the single-player menu. */
    private var viewCard: some View {
        SectionCard(icon: "moon.fill", title: "CONDITIONS",
                    note: lobby.iOwnRoom ? nil : "PICKED BY THE CREATOR") {
            CardOptionRow(label: "🌙 LIGHTING",
                          value: lobby.roomFog ? "NIGHT MODE" : "DAY MODE",
                          enabled: lobby.iOwnRoom) { _ in
                lobby.setFog(!lobby.roomFog)
            }
        }
    }

    private var roomHeader: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(lobby.myRoomInfo?.name ?? "ROOM")
                    .font(.system(size: 15, weight: .heavy)).kerning(2)
                    .foregroundColor(Skin.gold)
                    .lineLimit(1)
                Text("\(memberCount) IN THE ROOM · \(lobby.iOwnRoom ? "YOURS TO SET UP" : "THE CREATOR SETS IT UP")")
                    .font(.system(size: 9, weight: .bold)).kerning(1)
                    .foregroundColor(Skin.dimText)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            FlatActionButton(title: "LEAVE", icon: "chevron.left") { lobby.leaveRoom() }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(AngledRect().fill(LobbySkin.cardFill))
        .overlay(AngledRect().stroke(LobbySkin.cardEdge, lineWidth: 1))
    }

    /* the map this room plays: its creator steps or browses to another, the
       rest of the room reads it. The list comes from the server (see
       LobbyModel.maps), so it only ever offers maps the server can serve. */
    private var mapCard: some View {
        let canPick = lobby.iOwnRoom && !lobby.maps.isEmpty
        let at = lobby.maps.firstIndex { $0.param == lobby.roomMapParam }
        return SectionCard(icon: "map.fill", title: "MAP SELECTION",
                           note: lobby.iOwnRoom ? nil : "PICKED BY THE CREATOR") {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    if canPick { StepArrow(icon: "chevron.left") { lobby.stepMap(-1) } }
                    mapHero(canPick: canPick)
                    if canPick { StepArrow(icon: "chevron.right") { lobby.stepMap(1) } }
                }
                if canPick, let at {
                    Text("MAP \(at + 1) OF \(lobby.maps.count) · TAP THE CARD FOR THE FULL LIST")
                        .font(.system(size: 9, weight: .bold)).kerning(1)
                        .foregroundColor(Skin.dimText)
                }
            }
        }
    }

    /* the room's map, big: only the creator's card is a button (a disabled one
       would read as "broken" rather than "not yours to change") */
    @ViewBuilder private func mapHero(canPick: Bool) -> some View {
        if canPick {
            Button { pickingMap = true } label: { mapHeroFace }
                .buttonStyle(CardButtonStyle())
        } else {
            mapHeroFace
        }
    }

    private var mapHeroFace: some View {
        MapHeroCard(text: lobby.levelText(param: lobby.roomMapParam),
                    title: lobby.roomMapTitle,
                    desc: lobby.maps.first { $0.param == lobby.roomMapParam }?.desc ?? "") {
            HStack(spacing: 6) {
                Image(systemName: "person.2.fill").font(.system(size: 9, weight: .bold))
                Text("\(LOBBY_TEAM_MAX) VS \(LOBBY_TEAM_MAX)")
                Text("·")
                Image(systemName: lobby.roomMode.uiIcon).font(.system(size: 9, weight: .bold))
                Text(lobby.roomMode.uiTitle)
            }
        }
    }

    private var mapListCard: some View {
        SectionCard(icon: "map.fill", title: "PICK A MAP", note: "\(lobby.maps.count) MAPS") {
            // lazy for the same reason as the level select: a picture per map
            LazyVStack(spacing: 6) {
                ForEach(Array(lobby.maps.enumerated()), id: \.element.id) { i, m in
                    mapListRow(index: i, map: m)
                }
            }
        }
    }

    private func mapListRow(index: Int, map: ServerLevel) -> some View {
        let selected = map.param == lobby.roomMapParam
        return Button {
            lobby.setLevel(map.param)     // the lobby broadcast confirms it
            pickingMap = false
        } label: {
            HStack(spacing: 10) {
                MapThumb(text: lobby.levelText(param: map.param))
                    .frame(width: 32, height: 40)
                    .overlay(Rectangle().stroke(Skin.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(index + 1) · \(map.title)")
                        .font(.system(size: 13, weight: .heavy)).kerning(2)
                        .foregroundColor(selected ? Skin.gold : Skin.lightText)
                        .lineLimit(1)
                    if !map.desc.isEmpty {
                        Text(map.desc)
                            .font(.system(size: 10))
                            .foregroundColor(Skin.dimText)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 4)
                CheckBadge(on: selected, tint: Skin.gold)
            }
            .padding(8)
            .pickBox(selected: selected, fill: LobbySkin.inset,
                     edge: Skin.border, glow: Skin.gold)
        }
        .buttonStyle(CardButtonStyle())
        .id(map.param)      // what LobbyChrome's scrollTo brings into view
    }

    /* the mode this room plays, on the same rule as the map: its creator
       switches it, everyone else reads it */
    private var modeCard: some View {
        SectionCard(icon: "scope", title: "MODE SELECTION",
                    note: lobby.iOwnRoom ? nil : "PICKED BY THE CREATOR") {
            VStack(spacing: 8) {
                ForEach(GameMode.allCases, id: \.self) { m in modeRow(m) }
            }
        }
    }

    @ViewBuilder private func modeRow(_ m: GameMode) -> some View {
        if lobby.iOwnRoom {
            Button { lobby.setMode(m) } label: { modeFace(m) }
                .buttonStyle(CardButtonStyle())
        } else {
            modeFace(m)
        }
    }

    private func modeFace(_ m: GameMode) -> some View {
        // the mode a joiner can't change still shows which one the room plays
        ModeCard(mode: m, selected: lobby.roomMode == m,
                 dimmed: !lobby.iOwnRoom && lobby.roomMode != m)
    }

    private func teamsCard(_ members: [LobbyPlayer]) -> some View {
        SectionCard(icon: "person.3.fill", title: "TEAM SELECTION",
                    note: lobby.myTeam == nil ? "PICK A SIDE" : nil) {
            HStack(alignment: .top, spacing: 10) {
                teamCard(.blue, members: members)
                teamCard(.red, members: members)
            }
        }
    }

    private func teamCard(_ team: Team, members: [LobbyPlayer]) -> some View {
        let teamed = members.filter { $0.team == team }
        let mine = lobby.myTeam == team
        let full = !mine && teamed.count >= LOBBY_TEAM_MAX
        let head = team == .blue ? LobbySkin.blueHead : LobbySkin.redHead
        let fill = team == .blue ? LobbySkin.blueFill : LobbySkin.redFill
        let edge = team == .blue ? LobbySkin.blueEdge : LobbySkin.redEdge
        let open = max(0, LOBBY_TEAM_MAX - teamed.count)
        return Button {
            lobby.pickTeam(team)
        } label: {
            VStack(spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: "shield.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(head)
                    Text("\(team.wire.uppercased()) TEAM")
                        .font(.system(size: 11, weight: .heavy)).kerning(1.5)
                        .foregroundColor(head)
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    CheckBadge(on: mine, tint: head)
                }
                Text("\(teamed.count) / \(LOBBY_TEAM_MAX) PILOTS")
                    .font(.system(size: 9, weight: .heavy)).kerning(1)
                    .foregroundColor(Skin.dimText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 3) {
                    ForEach(teamed) { p in
                        Text(p.id == lobby.myId ? "\(p.name) ◂ YOU" : p.name)
                            .font(.system(size: 11, weight: p.id == lobby.myId ? .heavy : .semibold))
                            .kerning(1)
                            .foregroundColor(p.id == lobby.myId ? Skin.gold : Skin.lightText)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 6).padding(.vertical, 4)
                            .background(Rectangle().fill(fill.opacity(0.9)))
                            .overlay(Rectangle().stroke(edge.opacity(0.8), lineWidth: 1))
                    }
                    ForEach(0..<open, id: \.self) { _ in
                        Text("OPEN")
                            .font(.system(size: 10, weight: .semibold)).kerning(1)
                            .foregroundColor(LobbySkin.slotText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 6).padding(.vertical, 4)
                            .overlay(Rectangle().strokeBorder(Color(hex: 0x33405f),
                                                              style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                    }
                }
                Text(mine ? "LEAVE TEAM" : (full ? "TEAM FULL" : "JOIN \(team.wire.uppercased())"))
                    .font(.system(size: 11, weight: .heavy)).kerning(1.5)
                    .foregroundColor(mine ? Skin.deepInk : head)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Rectangle().fill(mine ? head.opacity(0.92) : fill.opacity(0.9)))
                    .overlay(Rectangle().stroke(mine ? head : edge, lineWidth: 1))
            }
            .padding(8)
            .pickBox(selected: mine, fill: fill.opacity(0.5), edge: edge, glow: head)
            .opacity(full ? 0.55 : 1)
        }
        .buttonStyle(CardButtonStyle())
        .disabled(full)
    }

    // MARK: - Match boot (rejoin + ready handshake)

    private var bootCard: some View {
        SectionCard(icon: "shield.lefthalf.filled", title: "DEPLOYMENT",
                    note: lobby.bootMyTeam.map { "YOU FLY \($0.wire.uppercased())" }) {
            HStack(alignment: .top, spacing: 10) {
                bootTeamColumn(.blue)
                bootTeamColumn(.red)
            }
        }
    }

    private func bootTeamColumn(_ team: Team) -> some View {
        let head = team == .blue ? LobbySkin.blueHead : LobbySkin.redHead
        let fill = team == .blue ? LobbySkin.blueFill : LobbySkin.redFill
        let edge = team == .blue ? LobbySkin.blueEdge : LobbySkin.redEdge
        let mine = lobby.bootMyTeam == team
        return VStack(spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "shield.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(head)
                Text("\(team.wire.uppercased()) TEAM")
                    .font(.system(size: 11, weight: .heavy)).kerning(1.5)
                    .foregroundColor(head)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            VStack(spacing: 3) {
                ForEach(Array(lobby.rosterNames(team: team).enumerated()), id: \.offset) { _, p in
                    Text(p.me ? "\(p.name) ◂ YOU" : p.name)
                        .font(.system(size: 11, weight: .heavy)).kerning(1)
                        .foregroundColor(p.gone ? LobbySkin.slotText : (p.me ? Skin.gold : Skin.lightText))
                        .strikethrough(p.gone)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6).padding(.vertical, 4)
                        .background(Rectangle().fill(fill.opacity(0.9)))
                        .overlay(Rectangle().stroke(edge.opacity(0.8), lineWidth: 1))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .pickBox(selected: mine, fill: fill.opacity(0.5), edge: edge, glow: head)
    }
}
