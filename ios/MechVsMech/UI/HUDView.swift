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
            // cockpit vignette: darkens the edges so the mech and the HUD sit
            // in the bright middle (the web build does this in style.css)
            RadialGradient(
                colors: [.clear, .clear, Color(hex: 0x04050a).opacity(0.42), Color(hex: 0x04050a).opacity(0.68)],
                center: .center, startRadius: 60, endRadius: 460)
                .scaleEffect(x: 1.5, y: 1.0)
                .ignoresSafeArea()
                .allowsHitTesting(false)

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
                if model.hud.ctf { ctfBar }
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

            // action buttons — right edge, vertically centered. They sit in the
            // look/fire zone on purpose: an unaffordable button doesn't hit-test
            // (see actionButton), so tapping it there falls through and fires.
            HStack {
                Spacer()
                VStack(alignment: .trailing, spacing: 12) {
                    Text("🛢️ \(model.hud.salvage)")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundColor(Color(hex: 0xffd23c))
                        .shadow(color: .black, radius: 3)
                        .allowsHitTesting(false)
                    // chase ⇄ bird's eye. Not a combat action, so it rides
                    // above the three that are, a size down — a thumb reaching
                    // for rockets never finds it. Its face is the view a tap
                    // would give (CamView in Engine/State.swift), the same way
                    // the web build's #btnView reads.
                    actionButton(icon: model.hud.camView.next.spec.icon, cost: nil, enabled: true,
                                 caption: model.hud.camView.next.spec.short, size: 46) {
                        model.engine.toggleCamView()
                    }
                    actionButton(icon: "⬆️", cost: nil, enabled: true) {
                        model.engine.requestJump()
                    }
                    actionButton(icon: "🚀", cost: Int(Costs.rocket), enabled: model.hud.canRocket) {
                        model.engine.requestRocket()
                    }
                    actionButton(icon: "🛰️", cost: Int(Costs.turret), enabled: model.hud.canTurret,
                                 badge: model.hud.turrets) {
                        model.engine.requestTurret()
                    }
                }
                .padding(.trailing, 14)
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

    /* same card language as the menus (UI/LobbyStyles.swift): the green button
       is the way on, the flat one is the way out */
    private var pauseOverlay: some View {
        ZStack {
            Color.black.opacity(0.72).ignoresSafeArea()
            VStack(spacing: 14) {
                Text("PAUSED")
                    .font(.system(size: 26, weight: .heavy))
                    .italic()
                    .kerning(4)
                    .foregroundColor(Skin.gold)
                    .shadow(color: Skin.gold.opacity(0.5), radius: 12)
                BigActionButton(title: "RESUME", icon: "play.fill") { resumeFromPause() }
                FlatActionButton(title: model.isMPMatch ? "LEAVE MATCH" : "QUIT TO MENU",
                                 icon: "chevron.left") {
                    showPause = false
                    model.quitToMenu()
                }
            }
            .padding(16)
            .frame(width: 300)
            .background(AngledRect().fill(LobbySkin.cardFill))
            .overlay(AngledRect().stroke(LobbySkin.cardEdge, lineWidth: 1))
        }
    }


    /* capture the flag: my captures, both flag states, theirs — the HUD
       equivalent of the web build's #ctfBar */
    private var ctfBar: some View {
        HStack(spacing: 10) {
            Text("\(model.hud.myCaptures)")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: 0x9fc4ff))
            flagState(model.hud.myFlag, mine: true)
            Text("FIRST TO \(CAPTURES_TO_WIN)")
                .font(.system(size: 9, weight: .bold)).kerning(1)
                .foregroundColor(Color(hex: 0x6a7594))
            flagState(model.hud.foeFlag, mine: false)
            Text("\(model.hud.foeCaptures)")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: 0xff9f9f))
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.45)))
        .shadow(color: .black, radius: 3)
    }

    private func flagState(_ state: FlagState, mine: Bool) -> some View {
        let text = state == .home ? "HOME" : state == .carried ? "TAKEN" : "DROPPED"
        let color = state == .carried ? Color(hex: 0xff5040)
            : state == .dropped ? Color(hex: 0xffd23c)
            : Color(hex: mine ? 0x9fc4ff : 0xff9f9f)
        return Text("🚩 \(text)")
            .font(.system(size: 10, weight: .bold)).kerning(1)
            .foregroundColor(color)
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

    private func actionButton(icon: String, cost: Int?, enabled: Bool, badge: Int? = nil,
                              caption: String? = nil, size: CGFloat = 58,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                ZStack(alignment: .topTrailing) {
                    Text(icon)
                        .font(.system(size: size * 0.45))
                        .frame(width: size, height: size)
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
                if let cost {   // free actions (jump) carry no salvage price
                    Text("🛢️\(cost)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(Color(hex: 0xffd23c))
                        .shadow(color: .black, radius: 2)
                }
                if let caption {   // …and what a free one does, when its icon alone won't say
                    Text(caption)
                        .font(.system(size: 9, weight: .bold, design: .rounded)).kerning(1)
                        .foregroundColor(Color(hex: 0x8ab4ff))
                        .shadow(color: .black, radius: 2)
                }
            }
            .opacity(enabled ? 1 : 0.45)
        }
        // can't afford it → let the touch pass through to the fire control
        // underneath, so a tap here shoots normally instead of doing nothing
        .allowsHitTesting(enabled)
    }
}
