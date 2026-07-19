import SwiftUI

/* ============================================================
   Menu screens — ports the flow.js overlay: mode select →
   mission menu (briefing, level select, difficulty, controls)
   → deploy; the end screen reuses the mission menu with a
   mission report, like the web version.
============================================================ */

/* ---------- mode select (first screen) ---------- */
struct ModeScreen: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        OverlayFrame {
            VStack(spacing: 22) {
                TitleBlock()
                Button {
                    model.showMenu()
                } label: {
                    VStack(spacing: 2) {
                        Text("SINGLE PLAYER").font(.system(size: 18, weight: .black, design: .rounded))
                        Text("HOLD THE DISTRICT AGAINST THE MACHINES")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .frame(width: 300)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
                Button {
                    model.showLobby()
                } label: {
                    VStack(spacing: 2) {
                        Text("MULTIPLAYER").font(.system(size: 18, weight: .black, design: .rounded))
                        Text("CHALLENGE OTHER PILOTS — UP TO 5 v 5")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .frame(width: 300)
                }
                .buttonStyle(MenuButtonStyle())
            }
        }
    }
}

/* ---------- mission menu; doubles as the end screen ---------- */
struct MenuScreen: View {
    @EnvironmentObject var model: AppModel
    var over = false

    var body: some View {
        OverlayFrame {
            VStack(spacing: 12) {
                if over {
                    TitleBlock(
                        h1: model.victory ? "VICTORY" : (model.isMPMatch ? "DEFEAT" : "BASE LOST"),
                        h1Color: model.victory ? Color(hex: 0x7CFF6B) : Color(hex: 0xff5040),
                        h2: model.endReason ?? (model.victory ? "ENEMY BASE DESTROYED — DISTRICT SECURED" : "YOUR BASE WAS DESTROYED")
                    )
                } else {
                    TitleBlock()
                }

                Group {
                    if over { reportPanel } else { briefingPanel }
                }
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundColor(.white.opacity(0.85))
                .multilineTextAlignment(.center)
                .padding(12)
                .frame(maxWidth: 460)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.45)))

                if !over {
                    Button {
                        model.showLevelSelect()
                    } label: {
                        HStack {
                            Text("SELECT LEVEL").font(.system(size: 13, weight: .heavy, design: .rounded))
                            Spacer()
                            Text("\(model.levelIndex + 1) · \(model.levelInfo.title)")
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundColor(Color(hex: 0xffd23c))
                            Text("▸")
                        }
                        .frame(width: 320)
                    }
                    .buttonStyle(MenuButtonStyle())

                    HStack(spacing: 8) {
                        PillToggle(label: "🕹️ JOYSTICK", selected: model.scheme == .joystick) { model.scheme = .joystick }
                        PillToggle(label: "📱 GYRO", selected: model.scheme == .gyro) { model.scheme = .gyro }
                    }
                    HStack(spacing: 8) {
                        ForEach(DifficultyKey.allCases, id: \.self) { key in
                            PillToggle(label: DIFFICULTIES[key]!.label, selected: model.difficultyKey == key) {
                                model.difficultyKey = key
                            }
                        }
                    }
                }

                Button {
                    if over { model.continueFromEndScreen() } else { model.deploy() }
                } label: {
                    Text(endButtonLabel)
                        .font(.system(size: 20, weight: .black, design: .rounded))
                        .kerning(2)
                        .frame(width: 240)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))

                if !over {
                    Text("Salvage is earned from kills · destroyed enemy turrets pay extra")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.5))
                    Button("◂ BACK") { model.showModeScreen() }
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .padding()
        }
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
        return Text("MISSION: Destroy the red enemy base at the far end of the district before enemy assault mechs destroy yours. Enemy waves march on your base — build turrets to hold them off.\n\n\(controls)\n🚀 rockets (🛢️ 20) · 🛰️ build turret in front of you (🛢️ 100)")
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
            return Text("MULTIPLAYER — \(mp.myTeam.wire.uppercased()) TEAM vs \(foes.joined(separator: " · "))\n\(matesLine)Kills: \(stats.kills) · Turrets built: \(stats.turretsBuilt)\n\(flavor)")
        }
        let flavor = model.victory
            ? (model.hasNextLevel ? "Outstanding work, officer. The next district needs you."
                                  : "Outstanding work, officer. All districts secured.")
            : "The district has fallen. Redeploy and try again."
        return Text("MISSION REPORT — \(DIFFICULTIES[model.difficultyKey]!.label)\nKills: \(stats.kills) · Waves survived: \(stats.wave) · Turrets built: \(stats.turretsBuilt)\n\(flavor)")
    }
}

/* ---------- level select ---------- */
struct LevelScreen: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        OverlayFrame {
            VStack(spacing: 10) {
                Text("SELECT LEVEL")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .kerning(3)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(model.levels) { info in
                                levelRow(info)
                            }
                        }
                        .padding(.horizontal, 8)
                    }
                    .frame(maxWidth: 480, maxHeight: 240)
                    .onAppear { proxy.scrollTo(model.levelIndex, anchor: .center) }
                }
                Button("◂ BACK") { model.showMenu() }
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(.white.opacity(0.7))
            }
            .padding()
        }
    }

    private func levelRow(_ info: LevelInfo) -> some View {
        Button {
            model.selectLevel(info.index)
        } label: {
            HStack(spacing: 10) {
                Text("\(info.index + 1)")
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.12)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(info.title)
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                    if !info.desc.isEmpty {
                        Text(info.desc)
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundColor(.white.opacity(0.55))
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(info.index == model.levelIndex ? Color(hex: 0x2b4fd8).opacity(0.5) : Color.white.opacity(0.06))
            )
            .foregroundColor(.white)
        }
        .id(info.index)
    }
}
