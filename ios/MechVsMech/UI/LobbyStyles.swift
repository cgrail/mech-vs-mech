import SwiftUI
import CoreGraphics

/* ============================================================
   Screen chrome — titled cards, selectable cards, map thumbnails
   and the one primary action per screen. Every overlay screen is
   built from these: the lobby, the mission menu, the level select
   and the end screen (UI/LobbyView.swift, UI/Menus.swift).

   The layout rule: one column of titled cards, one decision per
   card, filling the screen top to bottom over the orbiting map.
   Nothing grows sideways past the column — a card is at most
   `520` wide and the rows inside it hold at most three controls,
   the same limit the web overlay works to. What doesn't fit
   scrolls, and the nav bar and the action button are pinned, so
   the two things you always need are never scrolled away.

   The big choices are cards you pick with a checkmark (map, mode,
   team, level); the small settings are still LABEL · VALUE
   between ◂ ▸ steppers (`CardOptionRow`), because cycling a value
   in place is what keeps a setting to one row on a phone.
============================================================ */

enum LobbySkin {
    static let cardFill  = Color(hex: 0x0c1120).opacity(0.88)
    static let cardHead  = Color(hex: 0x161d33).opacity(0.95)
    static let cardEdge  = Color(hex: 0x2b3757)
    static let inset     = Color(hex: 0x080c17).opacity(0.85)
    /* the blue "this one is picked" highlight, image-2 style */
    static let pick      = Color(hex: 0x6f9bff)
    static let pickGlow  = Color(hex: 0x3d7bff)
    static let blueHead  = Color(hex: 0x8fb7ff)
    static let redHead   = Color(hex: 0xff9a8a)
    static let blueFill  = Color(hex: 0x14264d)
    static let redFill   = Color(hex: 0x3a1712)
    static let blueEdge  = Color(hex: 0x3a5f9f)
    static let redEdge   = Color(hex: 0x9f4a3a)
    static let slotText  = Color(hex: 0x55617a)

    /* GO green — the end screen already uses Skin.green for VICTORY, so the
       one primary action per screen is in palette rather than a new colour */
    static let goFill = LinearGradient(colors: [Color(hex: 0x7ce065), Color(hex: 0x2f9d3a)],
                                      startPoint: .top, endPoint: .bottom)
    static let deadFill = LinearGradient(colors: [Color(hex: 0x28304a), Color(hex: 0x1a2033)],
                                         startPoint: .top, endPoint: .bottom)
}

/* the corner-cut panel outline the sci-fi HUD look is built on: squared off
   like every other box in the game (CLAUDE.md), with two corners chamfered
   so a card reads as a card without going round */
struct AngledRect: Shape {
    var cut: CGFloat = 12
    func path(in r: CGRect) -> Path {
        let c = min(cut, min(r.width, r.height) / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX + c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - c))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        p.closeSubpath()
        return p
    }
}

/* ---------- the screen frame ----------
   nav bar · scrolling card column · pinned action bar. A screen fills the
   phone and scrolls rather than being scaled down to fit as one block: its
   content grows with the roster, the map list and the level list, and the
   two controls you always need are pinned outside the scroll. */
struct LobbyChrome<Content: View, Footer: View>: View {
    /* nil on the mode select, which has its own big title and nowhere to go back to */
    let title: String?
    var onBack: (() -> Void)?
    /* a row .id() to bring into view when it appears — the map list opens on
       the map the room is already playing rather than at map 1 */
    var scrollTo: String?
    private let content: Content
    private let footer: Footer

    init(title: String?, onBack: (() -> Void)? = nil, scrollTo: String? = nil,
         @ViewBuilder content: () -> Content,
         @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.onBack = onBack
        self.scrollTo = scrollTo
        self.content = content()
        self.footer = footer()
    }

    var body: some View {
        ZStack {
            /* darkest at the top and bottom, thin across the middle: the
               room's map keeps orbiting behind the cards */
            LinearGradient(stops: [
                .init(color: Color(hex: 0x05070f).opacity(0.96), location: 0),
                .init(color: Color(hex: 0x05070f).opacity(0.55), location: 0.34),
                .init(color: Color(hex: 0x05070f).opacity(0.62), location: 0.66),
                .init(color: Color(hex: 0x05070f).opacity(0.97), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()

            VStack(spacing: 0) {
                if let title { LobbyNavBar(title: title, onBack: onBack) }
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) {
                        HStack(spacing: 0) {
                            Spacer(minLength: 0)
                            content.frame(maxWidth: 520)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 16)
                    }
                    // next runloop, not this one: the rows have to exist first
                    .onChange(of: scrollTo) { _, id in
                        guard let id else { return }
                        DispatchQueue.main.async { proxy.scrollTo(id, anchor: .center) }
                    }
                    // …and the level select is already pointed at a row when it opens
                    .onAppear {
                        guard let id = scrollTo else { return }
                        DispatchQueue.main.async { proxy.scrollTo(id, anchor: .center) }
                    }
                }
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    VStack(spacing: 8) { footer }.frame(maxWidth: 520)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(
                    LinearGradient(colors: [Color(hex: 0x05070f).opacity(0),
                                            Color(hex: 0x05070f).opacity(0.92)],
                                   startPoint: .top, endPoint: .bottom)
                    .allowsHitTesting(false)
                )
            }
        }
    }
}

struct LobbyNavBar: View {
    let title: String
    var onBack: (() -> Void)?

    var body: some View {
        ZStack {
            Text(title)
                .font(.system(size: 15, weight: .heavy)).kerning(3)
                .foregroundColor(Skin.lightText)
            HStack {
                if let onBack {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundColor(Skin.blueText)
                            .frame(width: 38, height: 32)
                            .background(Rectangle().fill(LobbySkin.cardFill))
                            .overlay(Rectangle().stroke(LobbySkin.cardEdge, lineWidth: 1))
                    }
                    .buttonStyle(CardButtonStyle())
                }
                Spacer(minLength: 0)
            }
        }
        .frame(height: 44)
        .padding(.horizontal, 12)
        .background(
            VStack(spacing: 0) {
                Color(hex: 0x080c17).opacity(0.9)
                Rectangle().fill(LobbySkin.cardEdge).frame(height: 1)
            }
            .allowsHitTesting(false)
        )
    }
}

/* ---------- a titled card: one decision, one card ---------- */
struct SectionCard<Content: View>: View {
    let icon: String
    let title: String
    /* the right-hand hint, e.g. who gets to make this choice */
    var note: String?
    var accent: Color = LobbySkin.blueHead
    private let content: Content

    init(icon: String, title: String, note: String? = nil,
         accent: Color = LobbySkin.blueHead,
         @ViewBuilder content: () -> Content) {
        self.icon = icon
        self.title = title
        self.note = note
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(accent)
                Text(title)
                    .font(.system(size: 12, weight: .heavy)).kerning(2)
                    .foregroundColor(Skin.lightText)
                Spacer(minLength: 6)
                if let note {
                    Text(note)
                        .font(.system(size: 9, weight: .semibold)).kerning(1)
                        .foregroundColor(Skin.dimText)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(LobbySkin.cardHead)

            content
                .padding(10)
                .frame(maxWidth: .infinity)
        }
        .background(AngledRect().fill(LobbySkin.cardFill))
        .overlay(AngledRect().stroke(LobbySkin.cardEdge, lineWidth: 1))
    }
}

/* Every card in the lobby is a button, and every one of them draws its own
   state (picked, full, not yours to change). The default button style would
   tint the labels and dim the whole card when it is disabled, on top of that
   — so they all take this style instead, which only reports the press. */
struct CardButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.985
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? scale : 1)
    }
}

/* the box that says "this is the one" — image 2's checkbox */
struct CheckBadge: View {
    let on: Bool
    var tint: Color = LobbySkin.pick

    var body: some View {
        ZStack {
            Rectangle().fill(on ? tint.opacity(0.92) : Color.black.opacity(0.28))
            if on {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .black))
                    .foregroundColor(Skin.deepInk)
            }
        }
        .frame(width: 20, height: 20)
        .overlay(Rectangle().stroke(on ? tint : Skin.border, lineWidth: 1))
    }
}

/* the fill + edge + glow every selectable card in the lobby shares */
struct PickBox: ViewModifier {
    var selected: Bool
    var fill: Color = LobbySkin.inset
    var edge: Color = Skin.border
    var glow: Color = LobbySkin.pickGlow

    func body(content: Content) -> some View {
        content
            .background(Rectangle().fill(selected ? fill.opacity(0.95) : LobbySkin.inset))
            .overlay(Rectangle().stroke(selected ? glow : edge, lineWidth: selected ? 2 : 1))
            .shadow(color: selected ? glow.opacity(0.45) : .clear, radius: 10)
    }
}

extension View {
    func pickBox(selected: Bool, fill: Color = LobbySkin.inset,
                 edge: Color = Skin.border, glow: Color = LobbySkin.pickGlow) -> some View {
        modifier(PickBox(selected: selected, fill: fill, edge: edge, glow: glow))
    }
}

/* the coloured glyph tile a card leads with */
struct IconTile: View {
    let icon: String
    var tint: Color = LobbySkin.pick
    var side: CGFloat = 38

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: side * 0.42, weight: .bold))
            .foregroundColor(tint)
            .frame(width: side, height: side)
            .background(Rectangle().fill(tint.opacity(0.14)))
            .overlay(Rectangle().stroke(tint.opacity(0.5), lineWidth: 1))
    }
}

/* ◂ ▸ beside the map card: the neighbouring map, no list to open */
struct StepArrow: View {
    let icon: String
    var height: CGFloat = 96
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .heavy))
                .foregroundColor(Skin.blueText)
                .frame(width: 32, height: height)
                .background(Rectangle().fill(LobbySkin.inset))
                .overlay(Rectangle().stroke(LobbySkin.cardEdge, lineWidth: 1))
        }
        .buttonStyle(CardButtonStyle())
    }
}

/* the big map card — the lobby's room map and the mission menu's district are
   the same thing said twice, so they are drawn by the same view */
struct MapHeroCard<Line: View>: View {
    let text: String?           // level text the thumbnail is drawn from
    let title: String
    var desc: String = ""
    var height: CGFloat = 130
    private let line: Line

    init(text: String?, title: String, desc: String = "", height: CGFloat = 130,
         @ViewBuilder line: () -> Line) {
        self.text = text
        self.title = title
        self.desc = desc
        self.height = height
        self.line = line()
    }

    var body: some View {
        VStack(spacing: 0) {
            MapThumb(text: text).frame(height: height)
            VStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .heavy)).kerning(2)
                    .foregroundColor(Skin.goldSoft)
                    .lineLimit(1)
                line
                    .font(.system(size: 9, weight: .heavy)).kerning(1)
                    .foregroundColor(Skin.blueText)
                if !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 10))
                        .foregroundColor(Skin.dimText)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .frame(maxWidth: .infinity)
            .background(Color(hex: 0x0a0f1c).opacity(0.92))
        }
        .pickBox(selected: true, fill: LobbySkin.inset,
                 edge: LobbySkin.pick, glow: LobbySkin.pickGlow)
    }
}

/* one game mode, as a card you tick — the lobby's room mode and the mission
   menu's single-player mode */
struct ModeCard: View {
    let mode: GameMode
    let selected: Bool
    /* a mode somebody else picked: readable, but plainly not the choice here */
    var dimmed = false

    var body: some View {
        HStack(spacing: 10) {
            IconTile(icon: mode.uiIcon, tint: mode.uiTint)
            VStack(alignment: .leading, spacing: 3) {
                Text(mode.uiTitle)
                    .font(.system(size: 13, weight: .heavy)).kerning(2)
                    .foregroundColor(selected ? Skin.lightText : Skin.blueText)
                Text(mode.uiBlurb)
                    .font(.system(size: 10))
                    .foregroundColor(Skin.dimText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 4)
            CheckBadge(on: selected, tint: mode.uiTint)
        }
        .padding(8)
        .pickBox(selected: selected, fill: LobbySkin.inset,
                 edge: Skin.border, glow: mode.uiTint)
        .opacity(dimmed ? 0.45 : 1)
    }
}

/* ---------- a setting inside a card ----------
   LABEL · VALUE between ◂ ▸ steppers, the option row from the browser build
   (style.css .opt) fitted to a card's width. Cards are for the choices you
   want to see (map, mode, team); a difficulty or a fog toggle is a value you
   cycle, and cycling it in place is what keeps it to one row on a phone. */
struct CardOptionRow: View {
    let label: String
    let value: String
    let step: (Int) -> Void

    var body: some View {
        HStack(spacing: 6) {
            stepper("chevron.left", -1)
            Button { step(1) } label: {
                HStack(spacing: 10) {
                    Text(label)
                        .font(.system(size: 11, weight: .heavy)).kerning(2)
                        .foregroundColor(Skin.dimText)
                    Spacer(minLength: 8)
                    Text(value)
                        .font(.system(size: 12, weight: .heavy)).kerning(1)
                        .foregroundColor(Skin.gold)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 38)
                .pickBox(selected: false)
            }
            .buttonStyle(CardButtonStyle())
            stepper("chevron.right", 1)
        }
    }

    private func stepper(_ icon: String, _ dir: Int) -> some View {
        Button { step(dir) } label: {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .heavy))
                .foregroundColor(Skin.blueText)
                .frame(width: 34, height: 38)
                .background(Rectangle().fill(LobbySkin.inset))
                .overlay(Rectangle().stroke(LobbySkin.cardEdge, lineWidth: 1))
        }
        .buttonStyle(CardButtonStyle())
    }
}

/* ---------- the pinned action button ----------
   One per screen — ENTER LOBBY, CREATE ROOM, START MATCH, DEPLOY. Green
   when it is live, dead grey when the lobby is still waiting on something,
   with the reason underneath instead of in a separate status line. */
struct BigActionButton: View {
    let title: String
    var subtitle: String?
    var enabled = true
    var icon: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                HStack(spacing: 8) {
                    if let icon {
                        Image(systemName: icon).font(.system(size: 14, weight: .heavy))
                    }
                    Text(title).font(.system(size: 17, weight: .heavy)).kerning(3)
                }
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 9, weight: .bold)).kerning(1)
                        .opacity(0.75)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(AngledRect(cut: 10).fill(enabled ? LobbySkin.goFill : LobbySkin.deadFill))
            .overlay(AngledRect(cut: 10).stroke(enabled ? Color(hex: 0xbcffa8) : Skin.border,
                                                lineWidth: enabled ? 2 : 1))
            .shadow(color: enabled ? Color(hex: 0x36c94a).opacity(0.5) : .clear, radius: 14)
            .foregroundColor(enabled ? Color(hex: 0x06210b) : LobbySkin.slotText)
        }
        .buttonStyle(CardButtonStyle(scale: 0.97))
        .disabled(!enabled)
    }
}

/* the quieter sibling: BACK TO LOBBY, LEAVE ROOM, DONE */
struct FlatActionButton: View {
    let title: String
    var icon: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 11, weight: .heavy))
                }
                Text(title).font(.system(size: 12, weight: .heavy)).kerning(2)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundColor(Skin.blueText)
            .background(Rectangle().fill(LobbySkin.cardFill))
            .overlay(Rectangle().stroke(LobbySkin.cardEdge, lineWidth: 1))
        }
        .buttonStyle(CardButtonStyle())
    }
}

/* ---------- map thumbnails ----------
   The lobby offers 60-odd maps and the app ships no art for any of them, so
   a card's picture is drawn from the level text itself: one pixel per 8x8
   tile, scaled up blocky. That makes every map recognisable (the forts at
   either end, the chasms, the plateaus) for the cost of a bitmap.

   The text is whatever the lobby has to hand — the server's copy of the
   room's map if the preview already fetched it, otherwise the bundled
   snapshot. A thumbnail is cosmetic: a stale copy draws a slightly wrong
   picture, never a wrong match (the match itself always fetches, see
   Levels.swift).
*/
enum MapThumbs {
    private static var cache: [Int: CGImage] = [:]

    static func image(for text: String) -> CGImage? {
        let key = text.hashValue
        if let hit = cache[key] { return hit }
        guard let img = render(text) else { return nil }
        cache[key] = img
        return img
    }

    /* terrain tiers run blue-grey light-to-dark, walls read as pale
       structure, ramps warm — the one thing you look for on a map */
    private static let terrain: [Character: Int] = [
        "l": 0x1e2740, "g": 0x33405c, "h": 0x4a5d80, "r": 0x7a6540, "w": 0x8b93ab,
    ]
    private static let markers: [Character: Int] = [
        "P": 0x6fe3ff, "B": 0x3d7bff, "R": 0xff4a3d, "T": 0xff9a3a, "S": 0xc06ad8,
    ]

    private static func render(_ text: String) -> CGImage? {
        let grid = text.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { Array($0) }
        guard !grid.isEmpty, let cols = grid.map({ $0.count }).max(), cols > 0 else { return nil }
        let rows = grid.count
        guard let ctx = CGContext(data: nil, width: cols, height: rows, bitsPerComponent: 8,
                                  bytesPerRow: cols * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.setAllowsAntialiasing(false)
        for (r, row) in grid.enumerated() {
            for (c, ch) in row.enumerated() {
                // "v" chasms are left transparent: a hole in the map reads as one
                guard let hex = markers[ch] ?? terrain[ch] else { continue }
                ctx.setFillColor(red: CGFloat((hex >> 16) & 0xff) / 255,
                                 green: CGFloat((hex >> 8) & 0xff) / 255,
                                 blue: CGFloat(hex & 0xff) / 255, alpha: 1)
                // CoreGraphics counts y up; row 0 is the enemy end and stays on top
                ctx.fill(CGRect(x: c, y: rows - 1 - r, width: 1, height: 1))
            }
        }
        return ctx.makeImage()
    }
}

struct MapThumb: View {
    let text: String?
    var body: some View {
        ZStack {
            Rectangle().fill(Color(hex: 0x04060d))
            if let text, let img = MapThumbs.image(for: text) {
                Image(decorative: img, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(2)
            } else {
                // a map neither the server nor our bundle could hand over
                Image(systemName: "map")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(LobbySkin.slotText)
            }
        }
    }
}

/* ---------- how the lobby draws a game mode ----------
   Engine/State.swift keeps GameMode itself in lockstep with core/state.js;
   the card's icon and one-line pitch are presentation, so they live here. */
extension GameMode {
    var uiTitle: String { self == .ctf ? "CAPTURE THE FLAG" : "BASE ASSAULT" }
    var uiIcon: String { self == .ctf ? "flag.fill" : "building.2.fill" }
    var uiTint: Color { self == .ctf ? Color(hex: 0xff6a55) : Color(hex: 0x5b9dff) }
    var uiBlurb: String {
        self == .ctf
            ? "Steal the enemy flag and run it home — \(CAPTURES_TO_WIN) captures win."
            : "Destroy the enemy base at the far end of the district."
    }
}
