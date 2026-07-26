import SwiftUI

/* Palette and type shared by every overlay screen. Mirrors style.css's
   overlay rules, so the phone screens read as the same game as the browser
   build; the cards, buttons and thumbnails those screens are built from live
   in UI/LobbyStyles.swift. */

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
}

/* step through a list of settings, wrapping at both ends — what ◂ ▸ do
   (CardOptionRow in UI/LobbyStyles.swift) */
func cycled<T: Equatable>(_ all: [T], _ cur: T, _ dir: Int) -> T {
    guard !all.isEmpty else { return cur }
    let i = all.firstIndex(of: cur) ?? 0
    return all[((i + dir) % all.count + all.count) % all.count]
}

/* the game's own title, on the mode select */
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
