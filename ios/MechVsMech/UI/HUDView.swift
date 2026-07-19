import SwiftUI

extension Color {
    init(hex: Int) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

/* ============================================================
   In-game HUD — ports ui/hud.js (mobile layout: no minimap,
   no weapon slots; rockets and turrets are buttons)
============================================================ */
struct HUDView: View {
    @EnvironmentObject var model: AppModel
    @State private var showPause = false

    var body: some View {
        ZStack {
            // crosshair
            Circle()
                .fill(Color.white.opacity(0.8))
                .frame(width: 4, height: 4)
                .allowsHitTesting(false)

            // base health bars
            VStack(spacing: 4) {
                HStack(spacing: 18) {
                    baseBar(label: "YOUR BASE", frac: model.hud.myBaseFrac, color: Color(hex: 0x4d8dff))
                    baseBar(label: "ENEMY BASE", frac: model.hud.foeBaseFrac, color: Color(hex: 0xff5040))
                }
                .padding(.top, 8)
                if let msg = model.message {
                    Text(msg.text)
                        .font(.system(size: 17, weight: .black, design: .rounded))
                        .foregroundColor(Color(hex: msg.colorHex))
                        .shadow(color: .black, radius: 3)
                        .padding(.top, 6)
                        .transition(.opacity)
                }
                Spacer()
            }
            .allowsHitTesting(false)

            // player hp column (left edge)
            HStack {
                VStack {
                    Spacer()
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.5))
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(hex: 0x7CFF6B))
                            .frame(height: max(0, 130 * model.hud.hpFrac))
                    }
                    .frame(width: 12, height: 130)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.3), lineWidth: 1))
                    Spacer()
                }
                .padding(.leading, 10)
                Spacer()
            }
            .allowsHitTesting(false)

            // center hints
            VStack {
                Spacer()
                if let hint = model.buildHint {
                    Text(hint)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundColor(Color(hex: 0xff8a7a))
                        .shadow(color: .black, radius: 3)
                }
                if model.respawnVisible {
                    Text("MECH DESTROYED — RESPAWNING")
                        .font(.system(size: 20, weight: .black, design: .rounded))
                        .foregroundColor(Color(hex: 0xff5040))
                        .shadow(color: .black, radius: 4)
                }
                Spacer().frame(height: 70)
            }
            .allowsHitTesting(false)

            // salvage + action buttons (bottom right, above the fire thumb zone)
            VStack {
                Spacer()
                HStack(alignment: .bottom, spacing: 12) {
                    Spacer()
                    Text("🛢️ \(model.hud.salvage)")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundColor(Color(hex: 0xffd23c))
                        .shadow(color: .black, radius: 3)
                        .padding(.bottom, 22)
                        .allowsHitTesting(false)
                    actionButton(icon: "🚀", cost: Int(Costs.rocket), enabled: model.hud.canRocket) {
                        model.engine.requestRocket()
                    }
                    actionButton(icon: "🛰️", cost: Int(Costs.turret), enabled: model.hud.canTurret,
                                 badge: model.hud.turrets) {
                        model.engine.requestTurret()
                    }
                }
                .padding(.trailing, 14)
                .padding(.bottom, 10)
            }

            // pause / quit button (top-right corner) — shown only in play
            if model.screen == .playing {
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            if !model.isMPMatch { model.engine.pauseSim() }
                            showPause = true
                        } label: {
                            Image(systemName: "pause.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 42, height: 42)
                                .background(Circle().fill(Color.black.opacity(0.45)))
                                .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 1.5))
                        }
                        .padding(.top, 6)
                        .padding(.trailing, 12)
                    }
                    Spacer()
                }
            }

            // in-game menu overlay: resume, or bail to the menu / lobby
            if showPause && model.screen == .playing {
                pauseOverlay
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.message)
        .animation(.easeInOut(duration: 0.2), value: showPause)
    }

    private func resumeFromPause() {
        if !model.isMPMatch { model.engine.resumeSim() }
        showPause = false
    }

    private var pauseOverlay: some View {
        ZStack {
            Color.black.opacity(0.72).ignoresSafeArea()
            VStack(spacing: 16) {
                Text("PAUSED")
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .kerning(4)
                    .foregroundColor(.white)
                    .shadow(color: .black, radius: 6)
                Button { resumeFromPause() } label: {
                    Text("▶ RESUME")
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .frame(width: 240)
                }
                .buttonStyle(MenuButtonStyle(prominent: true))
                Button {
                    showPause = false
                    model.quitToMenu()
                } label: {
                    Text(model.isMPMatch ? "LEAVE MATCH" : "QUIT TO MENU")
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .frame(width: 240)
                }
                .buttonStyle(MenuButtonStyle())
            }
        }
    }

    private func baseBar(label: String, frac: Double, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .foregroundColor(.white.opacity(0.85))
                .shadow(color: .black, radius: 2)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(Color.black.opacity(0.55))
                RoundedRectangle(cornerRadius: 3).fill(color)
                    .frame(width: max(0, 130 * frac))
            }
            .frame(width: 130, height: 8)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.white.opacity(0.25), lineWidth: 1))
        }
    }

    private func actionButton(icon: String, cost: Int, enabled: Bool, badge: Int? = nil,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                ZStack(alignment: .topTrailing) {
                    Text(icon)
                        .font(.system(size: 26))
                        .frame(width: 58, height: 58)
                        .background(Circle().fill(Color.black.opacity(0.45)))
                        .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 1.5))
                    if let badge {
                        Text("\(badge)")
                            .font(.system(size: 11, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .padding(4)
                            .background(Circle().fill(Color(hex: 0x2b4fd8)))
                    }
                }
                Text("🛢️\(cost)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(Color(hex: 0xffd23c))
                    .shadow(color: .black, radius: 2)
            }
            .opacity(enabled ? 1 : 0.45)
        }
    }
}
