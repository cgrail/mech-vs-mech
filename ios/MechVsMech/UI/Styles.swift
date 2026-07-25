import SwiftUI

/* shared overlay-screen styling used by the menus and the lobby.
   Palette and type mirror style.css's overlay rules, so the phone
   screens read as the same game as the browser build. */

enum Skin {
    static let gold      = Color(hex: 0xffd23c)
    static let goldSoft  = Color(hex: 0xffe27a)
    static let amber     = Color(hex: 0xf5a623)
    static let goldEdge  = Color(hex: 0xfff2c0)
    static let ink       = Color(hex: 0x111111)
    static let deepInk   = Color(hex: 0x101427)
    static let blueText  = Color(hex: 0x9fb4ff)
    static let lightText = Color(hex: 0xcdd8ff)
    static let dimText   = Color(hex: 0x8a92ad)
    static let border    = Color(hex: 0x3a4468)
    static let borderLit = Color(hex: 0x4a5578)
    static let blue      = Color(hex: 0x2b4fd8)
    static let red       = Color(hex: 0xa42a20)
    static let green     = Color(hex: 0x7CFF6B)
    static let danger    = Color(hex: 0xff5040)
    static let veil      = Color(hex: 0x06060c)

    static let panel     = Color(hex: 0x141828).opacity(0.85)
    static let panelSoft = Color(hex: 0x141828).opacity(0.5)

    /* the .selected pill fill from style.css */
    static let selectedFill = LinearGradient(colors: [Color(hex: 0xcdd8ff), Color(hex: 0x7d97e8)],
                                            startPoint: .top, endPoint: .bottom)
    static let goldFill = LinearGradient(colors: [goldSoft, amber],
                                        startPoint: .top, endPoint: .bottom)
}

/* DEPLOY-style gold button, or the quieter navy one used everywhere else */
struct MenuButtonStyle: ButtonStyle {
    var prominent = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, prominent ? 26 : 18)
            .padding(.vertical, prominent ? 11 : 9)
            .background(
                Group {
                    if prominent {
                        RoundedRectangle(cornerRadius: 8).fill(Skin.goldFill)
                            .shadow(color: Skin.amber.opacity(0.5), radius: 12)
                    } else {
                        RoundedRectangle(cornerRadius: 6).fill(Skin.panel)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: prominent ? 8 : 6)
                    .stroke(prominent ? Skin.goldEdge : Skin.border, lineWidth: prominent ? 2 : 1)
            )
            .foregroundColor(prominent ? Skin.ink : Skin.blueText)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

/* difficulty / control-scheme picker button (#diffRow, #ctrlRow) */
struct PillToggle: View {
    let label: String
    let selected: Bool
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .kerning(2)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(
                    Group {
                        if selected {
                            RoundedRectangle(cornerRadius: 6).fill(Skin.selectedFill)
                                .shadow(color: Color(hex: 0x7896ff).opacity(0.45), radius: 10)
                        } else {
                            RoundedRectangle(cornerRadius: 6).fill(Skin.panel)
                        }
                    }
                )
                .overlay(RoundedRectangle(cornerRadius: 6)
                    .stroke(selected ? Color(hex: 0xe6ecff) : Skin.border, lineWidth: 1))
                .foregroundColor(selected ? Skin.deepInk : Skin.blueText)
                .opacity(disabled ? 0.5 : 1)
        }
        .disabled(disabled)
    }
}

/* the flat "◂ BACK" links under every screen */
struct GhostButton: View {
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label).font(.system(size: 12, weight: .bold)).kerning(2)
        }
        .buttonStyle(MenuButtonStyle())
    }
}

/* .panel from style.css — the briefing / mission-report box */
struct PanelBox: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: 10).fill(Skin.panel))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Skin.border, lineWidth: 1))
    }
}

/* a row in the level / map / room lists */
struct ListRowBox: ViewModifier {
    var selected = false
    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: 8).fill(Skin.panelSoft))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .stroke(selected ? Skin.gold : Skin.border, lineWidth: 1))
            .shadow(color: selected ? Skin.gold.opacity(0.3) : .clear, radius: 8)
    }
}

extension View {
    func panelBox() -> some View { modifier(PanelBox()) }
    func listRowBox(selected: Bool = false) -> some View { modifier(ListRowBox(selected: selected)) }
}

/* ---------- fitting the overlay onto small phones ----------
   Every menu is laid out at its natural size and then scaled down as one
   block until it fits inside the safe area, so an iPhone SE shows the same
   composition as a Pro Max instead of clipping it. Screens that hold a
   scrolling list read `overlaySize` to cap the list at a share of the
   screen instead of a fixed point height (the web's `max-height: 58vh`). */

private struct OverlaySizeKey: EnvironmentKey {
    static let defaultValue = CGSize(width: 812, height: 375)
}

extension EnvironmentValues {
    var overlaySize: CGSize {
        get { self[OverlaySizeKey.self] }
        set { self[OverlaySizeKey.self] = newValue }
    }
}

private struct NaturalSizeKey: PreferenceKey {
    static let defaultValue = CGSize.zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        let next = nextValue()
        if next != .zero { value = next }
    }
}

struct OverlayFrame<Content: View>: View {
    /* the level select dims less so the map keeps showing through */
    var dim: Double = 0.35
    private let content: Content
    @State private var natural: CGSize = .zero

    init(dim: Double = 0.35, @ViewBuilder content: () -> Content) {
        self.dim = dim
        self.content = content()
    }

    var body: some View {
        ZStack {
            Skin.veil.opacity(dim).ignoresSafeArea().allowsHitTesting(true)
            GeometryReader { geo in
                let avail = CGSize(width: max(geo.size.width - 16, 1),
                                   height: max(geo.size.height - 12, 1))
                let scale = min(1, min(avail.width / max(natural.width, 1),
                                       avail.height / max(natural.height, 1)))
                content
                    .environment(\.overlaySize, avail)
                    .background(GeometryReader { g in
                        Color.clear.preference(key: NaturalSizeKey.self, value: g.size)
                    })
                    .scaleEffect(scale)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
            .onPreferenceChange(NaturalSizeKey.self) { natural = $0 }
        }
    }
}

struct TitleBlock: View {
    var eyebrow: String? = "grails.de"
    var h1 = "MECH VS MECH"
    var h1Color = Skin.gold
    var h2 = "BASE STRIKE"
    var body: some View {
        VStack(spacing: 4) {
            if let eyebrow {
                Text(eyebrow)
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(2)
                    .foregroundColor(Skin.dimText)
            }
            Text(h1)
                .font(.system(size: 38, weight: .heavy))
                .italic()
                .kerning(4)
                .foregroundColor(h1Color)
                .shadow(color: h1Color.opacity(0.55), radius: 14)
                .shadow(color: .black, radius: 1, x: 2, y: 2)
            Text(h2)
                .font(.system(size: 14, weight: .semibold))
                .kerning(2)
                .foregroundColor(Skin.blueText)
                .multilineTextAlignment(.center)
        }
    }
}

/* the small caps heading the level select / lobby screens use */
struct ScreenTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 15, weight: .bold))
            .kerning(3)
            .foregroundColor(Skin.blueText)
    }
}
