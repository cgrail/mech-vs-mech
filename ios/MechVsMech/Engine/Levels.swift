import Foundation

/* ============================================================
   Level loading + parsing — ports the level half of world.js

   All levels live in one bundle, Resources/levels.txt (a copy of
   the web repo's levels/levels.txt) — a "=== <name>" line starts
   a level, file order is play order. Within a level, one character
   per 8x8 tile:
     g ground · l low ground · h high ground · w wall
     r ramp (slopes between the differing tiles next to it)
   Markers (terrain under them is inherited from the tile to their
   left):  P player spawn · B blue base · R red base
           T red turret   · S enemy wave spawn point
============================================================ */

let TILE = 8.0
let LOW = -4.0          // floor of the lowest tier
let WALL_H = 10.0       // absolute top of wall tiles
let STEP = 0.75         // tallest ledge a mech can step up while walking

private let TIER: [Character: Double] = ["l": -4, "g": 0, "h": 4]

struct P2 {
    var x = 0.0
    var z = 0.0
}

enum Cell {
    case flat(h: Double)
    case wall
    case ramp(axisX: Bool, h0: Double, h1: Double)
}

struct LevelParseError: Error {
    let message: String
}

/* one entry of the bundle; title/desc come from the first comment line
   ("# TITLE — player-facing description"), like the web level menu */
struct LevelInfo: Identifiable {
    let index: Int      // 0-based position in the bundle (play order)
    let name: String
    let text: String
    let title: String
    let desc: String
    var id: Int { index }
}

/* title/desc come from the level's first comment line
   ("# TITLE — player-facing description"), like the web level menu */
func makeLevelInfo(index: Int, name: String, text: String) -> LevelInfo {
    let first = text.split(separator: "\n").first { $0.hasPrefix("#") }.map(String.init) ?? ""
    var title = name.uppercased()
    var desc = ""
    // "# TITLE — description"
    if let dashRange = first.range(of: " — ") {
        let t = first[first.index(first.startIndex, offsetBy: 1)..<dashRange.lowerBound]
            .trimmingCharacters(in: .whitespaces)
        if !t.isEmpty && t.count <= 20 { title = t.uppercased() }
        desc = String(first[dashRange.upperBound...]).trimmingCharacters(in: .whitespaces)
    }
    return LevelInfo(index: index, name: name, text: text, title: title, desc: desc)
}

func loadLevelBundle() -> [LevelInfo] {
    guard let url = Bundle.main.url(forResource: "levels", withExtension: "txt"),
          let raw = try? String(contentsOf: url, encoding: .utf8) else {
        return []
    }
    var out: [LevelInfo] = []
    var curName: String? = nil
    var curText = ""
    func flush() {
        guard let name = curName else { return }
        out.append(makeLevelInfo(index: out.count, name: name, text: curText))
    }
    for line in raw.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("===") {
            flush()
            curName = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
            curText = ""
        } else if curName != nil {
            curText += String(line) + "\n"
        }
    }
    flush()
    return out
}

/* the bundle entry a lobby level param names — numeric params are the
   short form of "levelN", the same mapping the server and the web use */
func levelNameFor(param: String) -> String {
    if !param.isEmpty, param.allSatisfy(\.isNumber), let n = Int(param) { return "level\(n)" }
    return param
}

/* ============================================================
   Match maps come from the server, not from Resources/levels.txt

   Resources/levels.txt is a hand-copied snapshot of the web repo's
   bundle and can be older than what is deployed — and a client that
   loads different terrain from the rest of the match deploys onto a
   different map: wrong spawns, replicas walking through walls. So a
   multiplayer match fetches its one level from the server the lobby
   runs on (GET /level/<param>) and plays that text.

   `done` always fires on the main thread; nil means "the server had
   nothing usable" and the caller falls back to the bundled copy.
============================================================ */
func fetchServerLevel(param: String, url: URL, done: @escaping (LevelInfo?) -> Void) {
    var req = URLRequest(url: url)
    req.timeoutInterval = 8          // bounded: the match start waits on this
    req.cachePolicy = .reloadIgnoringLocalCacheData   // a deploy can change a level
    URLSession.shared.dataTask(with: req) { data, resp, _ in
        var info: LevelInfo? = nil
        let name = levelNameFor(param: param)
        if (resp as? HTTPURLResponse)?.statusCode == 200, let data,
           let text = String(data: data, encoding: .utf8),
           // a level this build can't parse is worse than the bundled copy
           (try? Level(text: text, name: name)) != nil {
            info = makeLevelInfo(index: 0, name: name, text: text)
        }
        DispatchQueue.main.async { done(info) }
    }.resume()
}

/* ============================================================
   Parsed level: terrain grid + marker positions.
   Terrain queries live in Terrain.swift as an extension.
============================================================ */
final class Level {
    let rows: Int
    let cols: Int
    let arenaHW: Double     // half width (x)
    let arenaHD: Double     // half depth (z)
    var cells: [[Cell]]

    var playerSpawn = P2()
    var blueBase = P2()
    var redBase = P2()
    var redTurrets: [P2] = []
    var enemySpawns: [P2] = []

    init(text: String, name: String) throws {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
        let rows = lines.count
        if rows == 0 {
            throw LevelParseError(message: "Level \"\(name)\" is empty — it has no terrain rows")
        }
        var chars = lines.map { Array($0) }
        let cols = chars.map(\.count).max() ?? 0
        for (r, row) in chars.enumerated() {
            if row.count != cols {
                throw LevelParseError(message: "Level \"\(name)\": terrain row \(r + 1) is \(row.count) tiles wide but the widest row is \(cols) — all rows must be equal length")
            }
            for (c, ch) in row.enumerated() where !"glhwrPBRTS".contains(ch) {
                throw LevelParseError(message: "Level \"\(name)\": unknown tile character \"\(ch)\" at row \(r + 1), column \(c + 1) — valid tiles are g l h w r and markers P B R T S")
            }
        }
        self.rows = rows
        self.cols = cols
        self.arenaHW = Double(cols) * TILE / 2
        self.arenaHD = Double(rows) * TILE / 2

        let hw = arenaHW, hd = arenaHD
        let cx = { (c: Int) in -hw + (Double(c) + 0.5) * TILE }
        let cz = { (r: Int) in -hd + (Double(r) + 0.5) * TILE }

        // pull out markers; the tile itself becomes plain terrain
        var seen = Set<Character>()
        for r in 0..<rows {
            for c in 0..<cols {
                let ch = chars[r][c]
                guard "PBRTS".contains(ch) else { continue }
                seen.insert(ch)
                let p = P2(x: cx(c), z: cz(r))
                switch ch {
                case "P": playerSpawn = p
                case "B": blueBase = p
                case "R": redBase = p
                case "T": redTurrets.append(p)
                default: enemySpawns.append(p)
                }
                let left: Character? = c > 0 ? chars[r][c - 1] : nil
                let right: Character? = c + 1 < cols ? chars[r][c + 1] : nil
                if let l = left, TIER[l] != nil { chars[r][c] = l }
                else if let rt = right, TIER[rt] != nil { chars[r][c] = rt }
                else { chars[r][c] = "g" }
            }
        }
        let needed: [Character: String] = [
            "P": "a \"P\" player-spawn marker",
            "B": "a \"B\" blue-base marker",
            "R": "an \"R\" red-base marker",
            "S": "an \"S\" enemy-spawn marker",
        ]
        for (ch, what) in needed where !seen.contains(ch) {
            throw LevelParseError(message: "Level \"\(name)\" has no \(what) — every level needs one")
        }

        cells = chars.map { row in
            row.map { ch in
                if ch == "w" { return Cell.wall }
                if ch == "r" { return Cell.ramp(axisX: true, h0: 0, h1: 0) }
                return Cell.flat(h: TIER[ch] ?? 0)
            }
        }

        // ramps slope between their flat neighbours — the steepest axis wins
        func flatH(_ r: Int, _ c: Int) -> Double? {
            guard r >= 0, r < rows, c >= 0, c < cols else { return nil }
            if case .flat(let h) = cells[r][c] { return h }
            return nil
        }
        for r in 0..<rows {
            for c in 0..<cols {
                guard case .ramp = cells[r][c] else { continue }
                let L = flatH(r, c - 1), R = flatH(r, c + 1)
                let U = flatH(r - 1, c), D = flatH(r + 1, c)
                let dx = (L != nil && R != nil) ? abs(L! - R!) : -1
                let dz = (U != nil && D != nil) ? abs(U! - D!) : -1
                if dx >= dz && dx > 0 {
                    cells[r][c] = .ramp(axisX: true, h0: L!, h1: R!)
                } else if dz > 0 {
                    cells[r][c] = .ramp(axisX: false, h0: U!, h1: D!)
                } else {
                    cells[r][c] = .flat(h: L ?? R ?? U ?? D ?? 0)
                }
            }
        }
    }
}
