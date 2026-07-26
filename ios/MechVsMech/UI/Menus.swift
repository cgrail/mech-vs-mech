import SwiftUI

/* ============================================================
   Menu screens — ports the flow.js overlay: mode select →
   mission menu (map, mode, setup, briefing) → deploy; the end
   screen is the mission report and what to do next.

   Same chrome as the lobby (UI/LobbyStyles.swift): a column of
   titled cards over the orbiting map, the pick-with-a-checkmark
   card for the choices you want to see (district, mode) and the
   ◂ VALUE ▸ row for the settings you cycle (difficulty, controls,
   fog). One green action button per screen, pinned at the bottom.
============================================================ */

/* ---------- mode select (first screen) ---------- */
struct ModeScreen: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        // no nav bar: the game's own title is the header here, and there is
        // nothing behind this screen to go back to
        LobbyChrome(title: nil) {
            VStack(spacing: 14) {
                TitleBlock()
                modeButton(icon: "person.fill", tint: Color(hex: 0x5b9dff),
                           title: "SINGLE PLAYER",
                           desc: "HOLD THE DISTRICT AGAINST THE MACHINES") { model.showMenu() }
                modeButton(icon: "person.2.fill", tint: Color(hex: 0xffb648),
                           title: "MULTIPLAYER",
                           desc: "CHALLENGE OTHER PILOTS — UP TO \(LOBBY_TEAM_MAX) v \(LOBBY_TEAM_MAX)") { model.showLobby() }
            }
        } footer: {
            EmptyView()
        }
    }

    private func modeButton(icon: String, tint: Color, title: String, desc: String,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                IconTile(icon: icon, tint: tint, side: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .heavy)).kerning(3)
                        .foregroundColor(Color(hex: 0xdfe6ff))
                    Text(desc)
                        .font(.system(size: 10, weight: .semibold)).kerning(1)
                        .foregroundColor(Skin.dimText)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundColor(Skin.blueText)
            }
            .padding(10)
            .pickBox(selected: false)
        }
        .buttonStyle(CardButtonStyle())
    }
}

/* ---------- mission menu; `over` swaps it for the end screen ---------- */
struct MenuScreen: View {
    var over = false

    var body: some View {
        if over { EndScreen() } else { MissionMenu() }
    }
}

private struct MissionMenu: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        LobbyChrome(title: "SINGLE PLAYER", onBack: { model.showModeScreen() }) {
            VStack(spacing: 12) {
                mapCard
                modeCard
                setupCard
                briefingCard
            }
        } footer: {
            BigActionButton(title: "DEPLOY",
                            subtitle: "SALVAGE IS EARNED FROM KILLS · ENEMY TURRETS PAY EXTRA",
                            icon: "bolt.fill") { model.deploy() }
        }
    }

    /* the district, with the map itself on the card: ◂ ▸ step to the
       neighbouring one, the card opens the full list */
    private var mapCard: some View {
        SectionCard(icon: "map.fill", title: "MAP SELECTION") {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    StepArrow(icon: "chevron.left") { model.stepLevel(-1) }
                    Button { model.showLevelSelect() } label: {
                        MapHeroCard(text: model.levelInfo.text,
                                    title: model.levelInfo.title,
                                    desc: model.levelInfo.desc) {
                            HStack(spacing: 6) {
                                Image(systemName: model.mode.uiIcon).font(.system(size: 9, weight: .bold))
                                Text(model.mode.uiTitle)
                                Text("·")
                                Text(DIFFICULTIES[model.difficultyKey]!.label)
                            }
                        }
                    }
                    .buttonStyle(CardButtonStyle())
                    StepArrow(icon: "chevron.right") { model.stepLevel(1) }
                }
                Text("MAP \(model.levelIndex + 1) OF \(model.levels.count) · TAP THE CARD FOR THE FULL LIST")
                    .font(.system(size: 9, weight: .bold)).kerning(1)
                    .foregroundColor(Skin.dimText)
            }
        }
    }

    /* base assault or capture the flag (Engine/CTF.swift) */
    private var modeCard: some View {
        SectionCard(icon: "scope", title: "MODE SELECTION") {
            VStack(spacing: 8) {
                ForEach(GameMode.allCases, id: \.self) { m in
                    Button { model.mode = m } label: {
                        ModeCard(mode: m, selected: model.mode == m)
                    }
                    .buttonStyle(CardButtonStyle())
                }
            }
        }
    }

    private var setupCard: some View {
        SectionCard(icon: "slider.horizontal.3", title: "COMBAT SETUP") {
            VStack(spacing: 6) {
                CardOptionRow(label: "DIFFICULTY", value: DIFFICULTIES[model.difficultyKey]!.label) {
                    model.difficultyKey = cycled(DifficultyKey.allCases, model.difficultyKey, $0)
                }
                CardOptionRow(label: "CONTROLS", value: model.scheme.label) {
                    model.scheme = cycled(ControlScheme.allCases, model.scheme, $0)
                }
                // sensors only: enemies vanish out of sight (Engine/Vision.swift)
                CardOptionRow(label: "🌫️ FOG OF WAR", value: model.fogOfWar ? "ON" : "OFF") { _ in
                    model.fogOfWar.toggle()
                }
            }
        }
    }

    private var briefingCard: some View {
        SectionCard(icon: "doc.plaintext.fill", title: "BRIEFING") {
            Text(briefing)
                .font(.system(size: 11))
                .foregroundColor(Skin.lightText)
                .lineSpacing(4)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var briefing: String {
        let controls = model.scheme == .gyro
            ? "🧭 Turn phone to rotate mech · 📱 lean forward/back to move\n📱 tilt sideways to strafe · 👆 touch the screen to fire"
            : "👈 Left thumb — floating joystick, move & strafe\n👉 Right thumb — drag to turn · hold to fire machine guns"
        let mission = model.mode == .ctf
            ? "Take the red flag from the enemy courtyard and run it back to your own stand — \(CAPTURES_TO_WIN) captures win the district. The enemy is after yours: a dropped flag goes home by itself after 25s, or instantly if you touch it. Only captures win here — you can still level their base, and it stops their waves, but it won't take the district."
            : "Destroy the red enemy base at the far end of the district before enemy assault mechs destroy yours. Enemy waves march on your base — build turrets to hold them off."
        return "\(mission)\n\n\(controls)\n⬆️ jump jets — clear a ledge onto high ground\n🚀 rockets (🛢️ 20) · 🛰️ build turret in front of you (🛢️ 100)"
    }
}

/* ---------- end screen: what happened, and what next ---------- */
private struct EndScreen: View {
    @EnvironmentObject var model: AppModel

    private var won: Bool { model.victory }
    private var headline: String {
        if won { return "VICTORY" }
        return model.isMPMatch || model.engine.mode == .ctf ? "DEFEAT" : "BASE LOST"
    }

    var body: some View {
        LobbyChrome(title: model.isMPMatch ? "MULTIPLAYER MATCH" : "MISSION COMPLETE") {
            VStack(spacing: 12) {
                resultCard
                SectionCard(icon: "chart.bar.fill", title: "MISSION REPORT") {
                    Text(report)
                        .font(.system(size: 11))
                        .foregroundColor(Skin.lightText)
                        .lineSpacing(4)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            // a finished multiplayer match rolls the whole roster on to the next
            // map without a trip through the lobby — and does it by itself when
            // the countdown runs out
            if model.isMPMatch {
                if model.deadEnd {
                    // …but there is no next map to be had: NEXT MAP could only
                    // be refused again, so the way out is the only action left
                    BigActionButton(title: model.leaveIn.map { "BACK TO LOBBY IN \($0)s" } ?? "BACK TO LOBBY",
                                    subtitle: model.nextMapNote,
                                    icon: "chevron.left") { model.continueFromEndScreen() }
                } else {
                    BigActionButton(title: model.nextMapIn.map { "NEXT MAP IN \($0)s" } ?? "NEXT MAP",
                                    subtitle: model.nextMapNote,
                                    icon: "forward.fill") { model.requestNextMap() }
                    FlatActionButton(title: "BACK TO LOBBY", icon: "chevron.left") {
                        model.continueFromEndScreen()
                    }
                }
            } else {
                BigActionButton(title: won && model.hasNextLevel ? "NEXT LEVEL" : "REDEPLOY",
                                icon: "bolt.fill") { model.continueFromEndScreen() }
            }
        }
    }

    private var resultCard: some View {
        let tint = won ? Skin.green : Skin.danger
        return VStack(spacing: 6) {
            Text(headline)
                .font(.system(size: 34, weight: .heavy))
                .italic()
                .kerning(4)
                .foregroundColor(tint)
                .shadow(color: tint.opacity(0.55), radius: 14)
            Text(model.endReason ?? (won ? "ENEMY BASE DESTROYED — DISTRICT SECURED"
                                         : "YOUR BASE WAS DESTROYED"))
                .font(.system(size: 11, weight: .semibold)).kerning(1)
                .foregroundColor(Skin.blueText)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 14).padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(AngledRect().fill(LobbySkin.cardFill))
        .overlay(AngledRect().stroke(tint.opacity(0.7), lineWidth: 1))
        .shadow(color: tint.opacity(0.25), radius: 12)
    }

    private var report: String {
        let stats = model.engine.stats
        if model.isMPMatch, let mp = model.engine.mp {
            let mates = mp.roster.filter { $0.team == mp.myTeam && $0.id != mp.playerId }.map(\.name)
            let foes = mp.roster.filter { $0.team != mp.myTeam }.map(\.name)
            let flavor = won
                ? "District secured, officer. Head back to the lobby for the next battle."
                : "The district has fallen. Return to the lobby and take the rematch."
            let matesLine = mates.isEmpty ? "" : "Fought beside \(mates.joined(separator: " · "))\n"
            let caps = model.engine.mode == .ctf
                ? " · Captures: \(stats.captures[mp.myTeam] ?? 0) : \(stats.captures[mp.enemyTeam] ?? 0)" : ""
            return "MULTIPLAYER \(model.engine.mode.label) — \(mp.myTeam.wire.uppercased()) TEAM vs \(foes.joined(separator: " · "))\n\(matesLine)Kills: \(stats.kills) · Turrets built: \(stats.turretsBuilt)\(caps)\n\(flavor)"
        }
        let flavor = won
            ? (model.hasNextLevel ? "Outstanding work, officer. The next district needs you."
                                  : "Outstanding work, officer. All districts secured.")
            : "The district has fallen. Redeploy and try again."
        let caps = model.engine.mode == .ctf
            ? " · Captures: \(stats.captures[.blue] ?? 0) : \(stats.captures[.red] ?? 0)" : ""
        return "\(model.engine.mode.label) · \(DIFFICULTIES[model.difficultyKey]!.label)\nKills: \(stats.kills) · Waves survived: \(stats.wave) · Turrets built: \(stats.turretsBuilt)\(caps)\n\(flavor)"
    }
}

/* ---------- level select ---------- */
struct LevelScreen: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        LobbyChrome(title: "SELECT LEVEL", onBack: { model.showMenu() },
                    // open on the district that is already on screen
                    scrollTo: String(model.levelIndex)) {
            SectionCard(icon: "map.fill", title: "DISTRICTS", note: "\(model.levels.count) MAPS") {
                // lazy: sixty districts, each with a picture to draw — only the
                // handful on screen is built, so the list opens instantly
                LazyVStack(spacing: 6) {
                    ForEach(model.levels) { info in levelRow(info) }
                }
            }
        } footer: {
            FlatActionButton(title: "◂ BACK TO THE MISSION MENU") { model.showMenu() }
        }
    }

    private func levelRow(_ info: LevelInfo) -> some View {
        let selected = info.index == model.levelIndex
        return Button {
            model.selectLevel(info.index)     // flies the map in behind the list
        } label: {
            HStack(spacing: 10) {
                MapThumb(text: info.text)
                    .frame(width: 32, height: 40)
                    .overlay(Rectangle().stroke(Skin.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(info.index + 1) · \(info.title)")
                        .font(.system(size: 13, weight: .heavy)).kerning(2)
                        .foregroundColor(selected ? Skin.gold : Skin.lightText)
                        .lineLimit(1)
                    if !info.desc.isEmpty {
                        Text(info.desc)
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
        .id(String(info.index))
    }
}
