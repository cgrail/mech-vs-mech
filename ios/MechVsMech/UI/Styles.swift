import SwiftUI

/* shared overlay-screen styling used by the menus and the lobby */

struct MenuButtonStyle: ButtonStyle {
    var prominent = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(prominent ? Color(hex: 0x2b4fd8).opacity(0.85) : Color.white.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(prominent ? 0.6 : 0.25), lineWidth: 1)
            )
            .foregroundColor(.white)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

struct PillToggle: View {
    let label: String
    let selected: Bool
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(selected ? Color(hex: 0x2b4fd8) : Color.white.opacity(0.08)))
                .overlay(Capsule().stroke(Color.white.opacity(selected ? 0.8 : 0.25), lineWidth: 1))
                .foregroundColor(.white.opacity(disabled ? 0.4 : 1))
        }
        .disabled(disabled)
    }
}

struct OverlayFrame<Content: View>: View {
    private let content: Content
    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }
    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea().allowsHitTesting(true)
            content
        }
    }
}

struct TitleBlock: View {
    var h1 = "MECH VS MECH"
    var h1Color = Color.white
    var h2 = "BASE STRIKE"
    var body: some View {
        VStack(spacing: 2) {
            Text(h1)
                .font(.system(size: 34, weight: .black, design: .rounded))
                .kerning(3)
                .foregroundColor(h1Color)
                .shadow(color: .black, radius: 6)
            Text(h2)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .kerning(4)
                .foregroundColor(.white.opacity(0.7))
        }
    }
}
