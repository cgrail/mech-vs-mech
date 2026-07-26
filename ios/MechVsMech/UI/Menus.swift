import SwiftUI

/* ============================================================
   Menu screens — ports the flow.js overlay: mode select →
   mission menu (briefing, level select, difficulty, controls)
   → deploy; the end screen reuses the mission menu with a
   mission report, like the web version. Styling follows
   style.css (see UI/Styles.swift), and OverlayFrame scales the
   whole screen down on small phones instead of clipping it.
============================================================ */

/* ---------- mode select (first screen) ---------- */
struct ModeScreen: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        OverlayFrame {
            VStack(spacing: 18) {
                TitleBlock()
                modeButton(title: "SINGLE PLAYER",
                           desc: "HOLD THE DISTRICT AGAINST THE MACHINES") { model.showMenu() }
                modeButton(title: "MULTIPLAYER",
                           desc: "CHALLENGE OTHER PILOTS — UP TO 5 v 5") { model.showLobby() }
            }
        }
    }

    private func modeButton(title: String, desc: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 17, weight: .heavy))
                    .kerning(3)
                    .foregroundColor(Color(hex: 0xdfe6ff))
                Text(desc)
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(1)
                    .foregroundColor(Skin.dimText)
            }
            .frame(width: 340)
            .padding(.vertical, 16)
            .padding(.horizontal, 20)
            .background(RoundedRectangle(cornerRadius: 8).fill(Skin.panel))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Skin.border, lineWidth: 1))
        }
    }
}

/* ---------- mission menu; doubles as the end screen ---------- */
struct MenuScreen: View {
    @EnvironmentObject var model: AppModel
    var over = false

    var body: some View {
        OverlayFrame {
            VStack(spacing: 14) {
                if over {
                    TitleBlock(
                        eyebrow: nil,
                        h1: model.victory ? "VICTORY"
                            : (model.isMPMatch || model.engine.mode == .ctf ? "DEFEAT" : "BASE LOST"),
                        h1Color: model.victory ? Skin.green : Skin.danger,
                        h2: model.endReason ?? (model.victory ? "ENEMY BASE DESTROYED — DISTRICT SECURED" : "YOUR BASE WAS DESTROYED")
                    )
                } else {
                    TitleBlock()
                }

                Group {
                    if over { reportPanel } else { briefingPanel }
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Skin.lightText)
                .lineSpacing(4)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .panelBox()

                if !over {
                    // ◂ ▸ step straight to the neighbouring map; the middle
                    // button opens the full list
                    HStack(spacing: 8) {
                        stepButton("◂") { model.stepLevel(-1) }
                        Button {
                            model.showLevelSelect()
                        } label: {
                            HStack(spacing: 12) {
                                Text("SELECT LEVEL")
                                    .font(.system(size: 11, weight: .bold)).kerning(2)
                                    .foregroundColor(Skin.dimText)
                                Text("\(model.levelIndex + 1) · \(model.levelInfo.title)")
                                    .font(.system(size: 13, weight: .bold)).kerning(1)
                                    .foregroundColor(Skin.gold)
                                    .lineLimit(1)
                                Text("▾").foregroundColor(Skin.dimText)
                            }
                            .frame(maxWidth: 300)
                        }
                        .buttonStyle(MenuButtonStyle())
                        stepButton("▸") { model.stepLevel(1) }
                    }

                    HStack(spacing: 10) {
                        PillToggle(label: "🕹️ JOYSTICK", selected: model.scheme == .joystick) { model.scheme = .joystick }
                        PillToggle(label: "📱 GYRO", selected: model.scheme == .gyro) { model.scheme = .gyro }
                    }
                    // base assault or capture the flag (Engine/CTF.swift)
                    HStack(spacing: 10) {
                        ForEach(GameMode.allCases, id: \.self) { m in
                            PillToggle(label: m.label, selected: model.mode == m) { model.mode = m }
                        }
                    }
                    HStack(spacing: 10) {
                        ForEach(DifficultyKey.allCases, id: \.self) { key in
                            PillToggle(label: DIFFICULTIES[key]!.label, selected: model.difficultyKey == key) {
                                model.difficultyKey = key
                            }
                        }
                        // sensors only: enemies vanish out of sight
                        PillToggle(label: "🌫️ FOG OF WAR", selected: model.fogOfWar) {
                            model.fogOfWar.toggle()
                        }
                    }
                }

                // a finished multiplayer match rolls the whole roster on to the
                // next map without a trip through the lobby
                if over && model.isMPMatch {
                    Button {
                        model.requestNextMap()
                    } label: {
                        Text("▸ NEXT MAP")
                            .font(.system(size: 18, weight: .heavy))
                            .kerning(3)
                            .frame(minWidth: 200)
                    }
                    .buttonStyle(MenuButtonStyle(prominent: true))
                    if let note = model.nextMapNote {
                        Text(note)
                            .font(.system(size: 11)).kerning(1)
                            .foregroundColor(Skin.dimText)
                            .multilineTextAlignment(.center)
                    }
                }

                Button {
                    if over { model.continueFromEndScreen() } else { model.deploy() }
                } label: {
                    Text(endButtonLabel)
                        .font(.system(size: 18, weight: .heavy))
                        .kerning(3)
                        .frame(minWidth: 200)
                }
                .buttonStyle(MenuButtonStyle(prominent: !(over && model.isMPMatch)))

                if !over {
                    Text("Salvage is earned from kills · destroyed enemy turrets pay extra")
                        .font(.system(size: 11))
                        .foregroundColor(Skin.dimText)
                    GhostButton(label: "◂ BACK") { model.showModeScreen() }
                }
            }
            .padding(8)
        }
    }

    private func stepButton(_ glyph: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: 15, weight: .bold))
        }
        .buttonStyle(MenuButtonStyle())
    }

    private var endButtonLabel: String {
        if !over { return "DEPLOY" }
        if model.isMPMatch { return "BACK TO LOBBY" }
        return model.victory && model.hasNextLevel ? "NEXT LEVEL" : "REDEPLOY"
    }

    private var briefingPanel: some View {
        let controls = model.scheme == .gyro
            ? "🧭 Turn phone to rotate mech · 📱 lean forward/back to move\n📱 tilt sideways to strafe · 👆 touch the screen to fire"
            : "👈 Left thumb — floating joystick, move & strafe\n👉 Right thumb — drag to turn · hold to fire machine guns"
        let mission = model.mode == .ctf
            ? "MISSION: Take the red flag from the enemy courtyard and run it back to your own stand — \(CAPTURES_TO_WIN) captures win the district. The enemy is after yours: a dropped flag goes home by itself after 25s, or instantly if you touch it. Destroying the enemy base still wins outright."
            : "MISSION: Destroy the red enemy base at the far end of the district before enemy assault mechs destroy yours. Enemy waves march on your base — build turrets to hold them off."
        return Text("\(mission)\n\n\(controls)\n⬆️ jump jets — clear a ledge onto high ground\n🚀 rockets (🛢️ 20) · 🛰️ build turret in front of you (🛢️ 100)")
    }

    private var reportPanel: some View {
        let stats = model.engine.stats
        if model.isMPMatch, let mp = model.engine.mp {
            let mates = mp.roster.filter { $0.team == mp.myTeam && $0.id != mp.playerId }.map(\.name)
            let foes = mp.roster.filter { $0.team != mp.myTeam }.map(\.name)
            let flavor = model.victory
                ? "District secured, officer. Head back to the lobby for the next battle."
                : "The district has fallen. Return to the lobby and take the rematch."
            let matesLine = mates.isEmpty ? "" : "Fought beside \(mates.joined(separator: " · "))\n"
            let caps = model.engine.mode == .ctf
                ? " · Captures: \(stats.captures[mp.myTeam] ?? 0) : \(stats.captures[mp.enemyTeam] ?? 0)" : ""
            return Text("MULTIPLAYER \(model.engine.mode.label) — \(mp.myTeam.wire.uppercased()) TEAM vs \(foes.joined(separator: " · "))\n\(matesLine)Kills: \(stats.kills) · Turrets built: \(stats.turretsBuilt)\(caps)\n\(flavor)")
        }
        let flavor = model.victory
            ? (model.hasNextLevel ? "Outstanding work, officer. The next district needs you."
                                  : "Outstanding work, officer. All districts secured.")
            : "The district has fallen. Redeploy and try again."
        let caps = model.engine.mode == .ctf
            ? " · Captures: \(stats.captures[.blue] ?? 0) : \(stats.captures[.red] ?? 0)" : ""
        return Text("MISSION REPORT — \(model.engine.mode.label) · \(DIFFICULTIES[model.difficultyKey]!.label)\nKills: \(stats.kills) · Waves survived: \(stats.wave) · Turrets built: \(stats.turretsBuilt)\(caps)\n\(flavor)")
    }
}

/* ---------- level select ---------- */
struct LevelScreen: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        // lighter dimming than the other screens: the map orbits behind it
        OverlayFrame(dim: 0.1) {
            LevelScreenBody()
        }
    }
}

/* split out so it can read the overlaySize OverlayFrame publishes */
private struct LevelScreenBody: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.overlaySize) private var size

    var body: some View {
        VStack(spacing: 12) {
            ScreenTitle(text: "SELECT LEVEL")
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(model.levels) { info in
                            levelRow(info)
                        }
                    }
                    .padding(.horizontal, 6)
                }
                .frame(maxWidth: 460, maxHeight: max(140, size.height * 0.58))
                .onAppear { proxy.scrollTo(model.levelIndex, anchor: .center) }
            }
            GhostButton(label: "◂ BACK") { model.showMenu() }
        }
        .padding(8)
    }

    private func levelRow(_ info: LevelInfo) -> some View {
        let selected = info.index == model.levelIndex
        return Button {
            model.selectLevel(info.index)
        } label: {
            HStack(spacing: 14) {
                Text("\(info.index + 1)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(selected ? Skin.gold : Color(hex: 0x8a97b6))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 4)
                        .stroke(selected ? Skin.gold : Skin.borderLit, lineWidth: 1))
                VStack(alignment: .leading, spacing: 3) {
                    Text(info.title)
                        .font(.system(size: 14, weight: .bold)).kerning(2)
                        .foregroundColor(selected ? Skin.gold : Skin.lightText)
                    if !info.desc.isEmpty {
                        Text(info.desc)
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
        .id(info.index)
    }
}
