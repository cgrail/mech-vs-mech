import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack {
            GameView()
                .ignoresSafeArea()

            if model.screen == .playing || model.screen == .over {
                HUDView()
            }

            switch model.screen {
            case .mode: ModeScreen()
            case .menu: MenuScreen()
            case .levelSelect: LevelScreen()
            case .lobby: LobbyView(lobby: model.lobby)
            case .over: MenuScreen(over: true)
            case .playing: EmptyView()
            }
        }
        .preferredColorScheme(.dark)
        .persistentSystemOverlays(.hidden)
    }
}
