import Foundation

/* ============================================================
   Multiplayer transport — ports net.js onto URLSessionWebSocketTask.

   The backend is the web game's Node server (mech.grails.de): a
   dumb lobby + relay speaking JSON. It requires an Origin header
   on the WebSocket upgrade (browsers always send one; URLSession
   does not), so we set one matching the server host.

   All callbacks fire on the main thread. send() is thread-safe
   (called from the SceneKit render thread during a match).
============================================================ */

struct MPPlayer {
    let id: Int
    let name: String
    let team: Team
}

/* match credentials — the iOS analog of the sessionStorage blob
   the web lobby parks before reloading into ?mp=1 */
struct MPConfig {
    let playerId: Int
    let myTeam: Team
    let name: String
    let roster: [MPPlayer]     // everyone in the match, me included
    let matchId: String
    let token: String
    var enemyTeam: Team { myTeam.enemy }
}

extension Team {
    var wire: String { self == .blue ? "blue" : "red" }
    init?(wire: String?) {
        switch wire {
        case "blue": self = .blue
        case "red": self = .red
        default: return nil
        }
    }
}

/* JSON accessors — relay payloads are heterogeneous, like the JS objects */
func jNum(_ d: [String: Any], _ k: String) -> Double? { (d[k] as? NSNumber)?.doubleValue }
func jInt(_ d: [String: Any], _ k: String) -> Int? { (d[k] as? NSNumber)?.intValue }
func jStr(_ d: [String: Any], _ k: String) -> String? { d[k] as? String }

/* compact wire numbers, the toFixed() analog (4 KB server maxPayload) */
func wire(_ v: Double, _ decimals: Int) -> Double {
    let p = pow(10.0, Double(decimals))
    return (v * p).rounded() / p
}

final class Net: NSObject {

    static let defaultURL = "wss://mech.grails.de/ws"

    var onOpen: (() -> Void)?
    var onClose: (() -> Void)?
    var onEvent: ((String, [String: Any]) -> Void)?     // lobby/match control messages
    var onGame: (([String: Any], Int) -> Void)?         // relayed in-match event + sender playerId

    private(set) var isConnected = false
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = false
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: OperationQueue())
    }

    private func serverURL() -> URL {
        let raw = UserDefaults.standard.string(forKey: "mechServer") ?? Net.defaultURL
        return URL(string: raw) ?? URL(string: Net.defaultURL)!
    }

    func connect() {
        guard task == nil else { return }
        let url = serverURL()
        var req = URLRequest(url: url)
        // the server rejects upgrades without a same-host Origin
        var origin = URLComponents(url: url, resolvingAgainstBaseURL: false) ?? URLComponents()
        origin.scheme = url.scheme == "ws" ? "http" : "https"
        origin.path = ""
        origin.query = nil
        if let o = origin.url?.absoluteString {
            req.setValue(o, forHTTPHeaderField: "Origin")
        }
        let t = session.webSocketTask(with: req)
        task = t
        t.resume()
        receiveLoop(t)
    }

    func disconnect() {
        let t = task
        task = nil
        isConnected = false
        t?.cancel(with: .normalClosure, reason: nil)
    }

    func send(_ obj: [String: Any]) {
        guard let t = task,
              let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return }
        t.send(.string(text)) { _ in /* a failed send surfaces as a close */ }
    }

    /* wrap a game event for relay to every other player in the match */
    func sendGame(_ data: [String: Any]) {
        send(["type": "relay", "data": data])
    }

    private func receiveLoop(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self, self.task === t else { return }
            switch result {
            case .failure:
                self.handleClose(t)
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   let type = obj["type"] as? String {
                    DispatchQueue.main.async {
                        if type == "relay" {
                            // in-match game event from another player; the server
                            // stamps the sender — clients trust `from`, never a
                            // sender id inside the payload
                            if let d = obj["data"] as? [String: Any], let from = jInt(obj, "from") {
                                self.onGame?(d, from)
                            }
                        } else {
                            self.onEvent?(type, obj)
                        }
                    }
                }
                self.receiveLoop(t)
            }
        }
    }

    private func handleClose(_ t: URLSessionWebSocketTask) {
        guard task === t else { return }   // dedup: error + didClose both land here
        task = nil
        isConnected = false
        DispatchQueue.main.async { self.onClose?() }
    }
}

extension Net: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        guard task === webSocketTask else { return }
        isConnected = true
        DispatchQueue.main.async { self.onOpen?() }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        handleClose(webSocketTask)
    }
}
