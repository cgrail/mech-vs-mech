import Foundation

/* ============================================================
   Turret building — beside the player, never in the way.
   Ports systems/build.js.

   A turret used to land straight ahead, which put a solid
   emplacement across the walking line at exactly the moment the
   pilot wanted to push forward. It goes to one side instead —
   left, then right if the left is against something — and behind
   only if both flanks are blocked, so building one never costs
   you the way on *or* the way back. (Local +x is the mech's left;
   see localToWorld.)
============================================================ */
private let BUILD_SPOTS = [(9.0, 0.0), (-9.0, 0.0), (0.0, -9.0)]   // left · right · behind

extension GameEngine {

    private func buildPosValid(_ p: SIMD3<Double>) -> Bool {
        if abs(p.x) > level.arenaHW - 4 || abs(p.z) > level.arenaHD - 4 { return false }
        // needs flat footing on the player's own level (no walls, ramps or cliffs)
        let h = level.groundHeightAt(p.x, p.z)
        if abs(h - player.y) > 0.5 { return false }
        for (ox, oz) in [(2.5, 0.0), (-2.5, 0.0), (0.0, 2.5), (0.0, -2.5)] {
            if abs(level.groundHeightAt(p.x + ox, p.z + oz) - h) > 0.1 { return false }
        }
        for e in entities {
            if !e.alive || e === player { continue }
            if distXZ(p.x, p.z, e.x, e.z) < e.hitRadius + 4 { return false }
        }
        return true
    }

    /* the first of those spots the ground will take, or nil if none will */
    private func buildPos() -> SIMD3<Double>? {
        for (ox, oz) in BUILD_SPOTS {
            let p = localToWorld(player, ox, 0, oz)
            if buildPosValid(p) { return p }
        }
        return nil
    }

    @discardableResult
    func placeTurretDirect() -> Bool {
        if !player.alive { return false }
        if stats.salvage < Costs.turret {
            audio.beep(f: 140, f2: 90, dur: 0.15, type: .square, vol: 0.1)
            delegate?.engineBuildHint("NOT ENOUGH SALVAGE — NEED 🛢️ \(Int(Costs.turret))")
            return false
        }
        guard let p = buildPos() else {
            audio.beep(f: 140, f2: 90, dur: 0.15, type: .square, vol: 0.1)
            delegate?.engineBuildHint("NO ROOM BESIDE YOU — NEEDS FLAT OPEN GROUND")
            return false
        }
        stats.salvage -= Costs.turret
        stats.turretsBuilt += 1
        // netId carries my playerId so every client knows who owns (simulates) it
        let netId = isMP ? "t:\(myPlayerId):\(stats.turretsBuilt)" : nil
        let t = makeTurretEntity(team: player.team, x: p.x, z: p.z, netId: netId, owner: myPlayerId)
        if isMP {
            net?.sendGame(["t": "build", "id": t.netId ?? "", "x": wire(p.x, 1), "z": wire(p.z, 1)])
        }
        spawnSpark(p.x, level.groundHeightAt(p.x, p.z) + 2, p.z)
        audio.beep(f: 500, f2: 1100, dur: 0.15, type: .sine, vol: 0.12)
        return true
    }
}
