import Foundation
import simd

/* ============================================================
   Math / collision helpers — ports core/helpers.js
============================================================ */

func distXZ(_ ax: Double, _ az: Double, _ bx: Double, _ bz: Double) -> Double {
    let dx = ax - bx, dz = az - bz
    return (dx * dx + dz * dz).squareRoot()
}

func distXZ(_ a: Entity, _ b: Entity) -> Double { distXZ(a.x, a.z, b.x, b.z) }

/* where guns auto-point on a target (torso height above its ground) */
func aimY(_ e: Entity) -> Double {
    e.y + min(3.5, e.hitHeight * 0.55)
}

/* muzzle offsets in an entity's local frame (forward = +z at yaw 0) */
func localToWorld(_ e: Entity, _ ox: Double, _ oy: Double, _ oz: Double) -> SIMD3<Double> {
    let s = sin(e.yaw), c = cos(e.yaw)
    return SIMD3(
        e.x + ox * c + oz * s,
        e.y + oy,
        e.z - ox * s + oz * c
    )
}

extension GameEngine {

    /* 3D line of sight: blocked where the ray dips into terrain or walls.
       A cliff rim naturally blocks shots down a level until the shooter
       steps up to the edge. */
    func losBlocked(_ ax: Double, _ ay: Double, _ az: Double,
                    _ bx: Double, _ by: Double, _ bz: Double) -> Bool {
        let dx = bx - ax, dy = by - ay, dz = bz - az
        let steps = Int(ceil((dx * dx + dz * dz).squareRoot() / 2))
        guard steps > 1 else { return false }
        for i in 1..<steps {
            let t = Double(i) / Double(steps)
            if ay + dy * t < level.groundHeightAt(ax + dx * t, az + dz * t) + 0.25 {
                return true
            }
        }
        return false
    }

    func nearestEnemyOf(team: Team, x: Double, z: Double, range: Double, excludeBase: Bool = false) -> Entity? {
        var best: Entity? = nil
        var bestD = range
        for e in entities {
            if !e.alive || e.team == team { continue }
            if excludeBase && e.kind == .base { continue }
            let d = distXZ(x, z, e.x, e.z)
            if d < bestD {
                bestD = d
                best = e
            }
        }
        return best
    }

    /* circle vs terrain tiles + solid entities + arena clamp; y = walker's height */
    func collideCircle(x: inout Double, z: inout Double, r: Double, y: Double) {
        level.collideTerrain(x: &x, z: &z, r: r, y: y)
        // solid entities (bases, turrets) as circles
        for e in entities {
            if !e.alive || e.kind == .mech || e.kind == .player { continue }
            if abs(e.y - y) > 6 { continue } // different level
            let rr = r + e.hitRadius * 0.85
            let dx = x - e.x, dz = z - e.z
            let d = (dx * dx + dz * dz).squareRoot()
            if d < rr && d > 1e-4 {
                x += dx / d * (rr - d)
                z += dz / d * (rr - d)
            }
        }
        x = max(-level.arenaHW + r, min(level.arenaHW - r, x))
        z = max(-level.arenaHD + r, min(level.arenaHD - r, z))
    }

    /* keep e.y glued to the ground, or fall once it walks off an edge.
       Returns true while on the ground. */
    func updateVertical(_ e: Entity, dt: Double) -> Bool {
        let gh = level.groundHeightAt(e.x, e.z)
        if gh >= e.y - 0.9 { // ground contact, incl. walking up/down ramps
            e.y = gh
            e.vy = 0
            return true
        }
        e.vy -= 50 * dt
        e.y = max(gh, e.y + e.vy * dt)
        if e.y == gh {
            e.vy = 0
            return true
        }
        return false
    }

    /* light mech-vs-mech separation */
    func separateMechs() {
        let mechs = entities.filter { $0.alive && ($0.kind == .mech || $0.kind == .player) }
        guard mechs.count > 1 else { return }
        for i in 0..<(mechs.count - 1) {
            for j in (i + 1)..<mechs.count {
                let a = mechs[i], b = mechs[j]
                if abs(a.y - b.y) > 4 { continue } // different level
                let dx = b.x - a.x, dz = b.z - a.z
                let d = (dx * dx + dz * dz).squareRoot()
                let minD = 4.4
                if d < minD && d > 1e-4 {
                    // a network-driven mech can't be pushed — its position is authoritative
                    let ra = a.remote, rb = b.remote
                    if ra && rb { continue }
                    let push = (ra || rb) ? (minD - d) : (minD - d) / 2
                    if !ra {
                        a.x -= dx / d * push
                        a.z -= dz / d * push
                        a.node.position.x = Float(a.x)
                        a.node.position.z = Float(a.z)
                    }
                    if !rb {
                        b.x += dx / d * push
                        b.z += dz / d * push
                        b.node.position.x = Float(b.x)
                        b.node.position.z = Float(b.z)
                    }
                }
            }
        }
    }

    /* fan teammates out around a shared spawn marker: idx 0 is the marker
       itself, higher indices take the idx-th nearby spot on the same terrain
       height. Deterministic, so every client places every player identically. */
    private static let spawnRing: [(Double, Double)] =
        [(-7, 0), (7, 0), (0, 7), (-7, 7), (7, 7), (0, -7), (-7, -7), (7, -7)]

    private func offsetSpawn(_ p: P2, _ idx: Int) -> P2 {
        if idx == 0 { return p }
        let h = level.groundHeightAt(p.x, p.z)
        var n = 0
        for (ox, oz) in Self.spawnRing {
            let q = P2(x: p.x + ox, z: p.z + oz)
            if abs(level.groundHeightAt(q.x, q.z) - h) < 0.5 {
                n += 1
                if n == idx { return q }
            }
        }
        return p   // every spot taken/invalid — mech separation nudges them apart
    }

    /* where a player mech deploys: team + index within that team. Blue fans
       out around the level's P marker; red rotates through the enemy-wave S
       markers, falling back to just in front of the red base. `face` is what
       the mech should look at on spawn (the enemy base). */
    func spawnPointFor(team: Team, idx: Int) -> (pos: P2, face: P2) {
        if team == .blue {
            return (offsetSpawn(level.playerSpawn, idx), level.redBase)
        }
        let s = level.enemySpawns
        if !s.isEmpty {
            return (offsetSpawn(s[idx % s.count], idx / s.count), level.blueBase)
        }
        let rb = level.redBase, bb = level.blueBase
        let d = max(1, hypot(bb.x - rb.x, bb.z - rb.z))
        let p = P2(x: rb.x + (bb.x - rb.x) / d * 16, z: rb.z + (bb.z - rb.z) / d * 16)
        return (offsetSpawn(p, idx), bb)
    }

    /* my position within my team's roster (0 in single player), used to pick
       a spawn spot that no teammate occupies */
    func teamIndexOf(playerId: Int, team: Team, roster: [MPPlayer]) -> Int {
        let sorted = roster.filter { $0.team == team }.sorted { $0.id < $1.id }
        return max(0, sorted.firstIndex { $0.id == playerId } ?? 0)
    }

    /* single-player convenience: player is blue on the P marker facing red */
    func spawnPoint() -> (pos: P2, yaw: Double) {
        let sp = spawnPointFor(team: .blue, idx: 0)
        return (sp.pos, atan2(sp.face.x - sp.pos.x, sp.face.z - sp.pos.z))
    }
}
