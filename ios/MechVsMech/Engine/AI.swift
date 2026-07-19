import Foundation
import SceneKit
import simd

/* ============================================================
   AI: turrets + enemy mechs + waves — ports systems/ai.js.
   All red-side stats come from the difficulty tables in
   State.swift — tune there, not with magic numbers here.
============================================================ */

/* rotate a direction around the +y axis (three.js applyAxisAngle(UP, a)) */
private func rotateY(_ v: SIMD3<Double>, _ a: Double) -> SIMD3<Double> {
    let s = sin(a), c = cos(a)
    return SIMD3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
}

extension GameEngine {

    /* can e walk `dist` units along `yaw`? Ledges too tall to step up block;
       walking down (dropping off an edge) is always allowed. */
    private func clearDir(_ e: Entity, yaw: Double, dist: Double) -> Bool {
        let sx = sin(yaw), cz = cos(yaw)
        var y = e.y
        var s = 1.2
        while s <= dist {
            let h = level.groundHeightAt(e.x + sx * s, e.z + cz * s)
            if h > y + STEP { return false }
            y = h
            s += 1.2
        }
        return true
    }

    func updateTurret(_ e: Entity, dt: Double) {
        e.cool -= dt
        e.retargetT -= dt
        if e.retargetT <= 0 {
            e.retargetT = 0.4
            let t = nearestEnemyOf(team: e.team, x: e.x, z: e.z, range: e.range, excludeBase: true)
            if let t, !losBlocked(e.x, e.y + 3, e.z, t.x, aimY(t), t.z) {
                e.target = t
            } else {
                e.target = nil
            }
        }
        guard let target = e.target, target.alive else {
            e.target = nil
            return
        }

        let desired = atan2(target.x - e.x, target.z - e.z)
        let diff = angDiff(desired, e.yaw)
        let turn = 4 * dt
        e.yaw += max(-turn, min(turn, diff))
        e.head?.eulerAngles.y = Float(e.yaw)
        // pitch the head toward the target's level
        let dXZ = distXZ(e, target)
        e.head?.eulerAngles.x = Float(-atan2(aimY(target) - (e.y + 3), max(dXZ, 1)))

        if abs(diff) < 0.15 && e.cool <= 0 {
            e.cool = e.fireInterval
            let muzzle = localToWorld(e, 0, 3.0, 2.2)
            // red turrets lead moving targets on higher difficulties (never in PvP)
            let lead = (e.team == .red && !isMP) ? difficulty.mech.aimLead : 0
            let tof = dXZ / 100
            let ax = target.x + target.velX * tof * lead
            let az = target.z + target.velZ * tof * lead
            let dir = simd_normalize(SIMD3(ax, aimY(target), az) - muzzle)
            spawnProjectile(pos: muzzle, dir: dir, speed: 100, damage: e.damage, team: e.team, life: 1, src: e)
            audio.laser(vol: 0.03, startF: e.team == .blue ? 2200 : 1300)
        }
    }

    func updateEnemyMech(_ e: Entity, dt: Double) {
        let cfg = difficulty.mech
        e.cool -= dt
        e.retargetT -= dt
        if e.aggroT > 0 {
            e.aggroT -= dt
            if e.aggro == nil || e.aggro?.alive != true {
                e.aggro = nil
                e.aggroT = 0
            }
        }
        if e.retargetT <= 0 {
            e.retargetT = cfg.retarget
            // priority: whoever shot us recently > player in sight > close /
            // already-damaged blue turret > blue base
            var t: Entity? = e.aggroT > 0 ? e.aggro : nil
            if t == nil, player.alive, distXZ(e, player) < cfg.sight { t = player }
            if t == nil {
                var bs = Double.infinity
                for o in entities {
                    if !o.alive || o.team != .blue || o.kind != .turret { continue }
                    let d = distXZ(e, o)
                    if d > 46 { continue }
                    let score = d * (0.55 + 0.45 * (o.hp / o.maxHp)) // finish off weakened turrets
                    if score < bs {
                        bs = score
                        t = o
                    }
                }
            }
            if t == nil { t = blueBase.alive ? blueBase : (player.alive ? player : nil) }
            e.target = t
        }
        guard let target = e.target, target.alive else { return }

        let d = distXZ(e, target)
        let attackRange = target.kind == .base ? 32 : e.range
        // open fire on the player as soon as they're spotted, while still closing to preferred range
        let fireRange = target === player ? cfg.sight : attackRange
        let clear = !losBlocked(e.x, e.y + 4.5, e.z, target.x, aimY(target), target.z)
        let desired = atan2(target.x - e.x, target.z - e.z)

        // steering: head for the target, swerving around obstacles in the way
        var steerYaw = desired
        if e.detourT > 0 {
            e.detourT -= dt
            steerYaw = e.detourYaw
        } else if !clearDir(e, yaw: desired, dist: 10) {
            for off in [0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1] {
                if clearDir(e, yaw: desired + off, dist: 9) {
                    steerYaw = desired + off
                    break
                }
            }
        }

        let shouldMove = d > attackRange * 0.85 || !clear
        var stepYaw: Double? = nil
        if shouldMove {
            stepYaw = steerYaw
        } else if cfg.strafe && target === player {
            // hold range but strafe sideways to dodge return fire
            e.strafeTimer -= dt
            if e.strafeTimer <= 0 {
                e.strafeTimer = 1.1 + rand01() * 1.5
                e.strafeDir = -e.strafeDir
            }
            let sy = desired + (.pi / 2) * e.strafeDir
            if clearDir(e, yaw: sy, dist: 5) { stepYaw = sy }
        }

        // face the travel direction while marching, the target while fighting
        let faceYaw = shouldMove ? steerYaw : desired
        let turn = 3.2 * dt
        let fd = angDiff(faceYaw, e.yaw)
        e.yaw += max(-turn, min(turn, fd))
        e.node.eulerAngles.y = Float(e.yaw)

        if let stepYaw {
            let spd = shouldMove ? e.speed : e.speed * 0.6
            let moveYaw = shouldMove ? e.yaw : stepYaw // strafing sidesteps without turning
            e.x += sin(moveYaw) * spd * dt
            e.z += cos(moveYaw) * spd * dt
            collideCircle(x: &e.x, z: &e.z, r: 2.2, y: e.y)
            e.walkPhase += dt * 7
            let sw = sin(e.walkPhase) * 0.55
            e.legL?.eulerAngles.x = Float(sw)
            e.legR?.eulerAngles.x = Float(-sw)

            // barely moving? take a random detour instead of grinding into the wall
            let stepped = distXZ(e.x, e.z, e.px, e.pz)
            if shouldMove && stepped < spd * dt * 0.25 {
                e.stuckT += dt
                if e.stuckT > 0.7 {
                    e.stuckT = 0
                    e.detourT = 0.9
                    e.detourYaw = e.yaw + (rand01() < 0.5 ? 1 : -1) * (1.6 + rand01())
                }
            } else {
                e.stuckT = 0
            }
        }
        let onGround = updateVertical(e, dt: dt)
        e.syncNode(bob: stepYaw != nil && onGround ? abs(sin(e.walkPhase)) * 0.25 : 0)
        e.px = e.x
        e.pz = e.z

        // fire: lead moving targets, tighter spread on harder difficulties
        let aimDiff = abs(angDiff(desired, e.yaw))
        if d < fireRange && clear && aimDiff < 0.25 && e.cool <= 0 {
            e.cool = e.fireInterval * (0.8 + rand01() * 0.5)
            let muzzle = localToWorld(e, rand01() < 0.5 ? -2.2 : 2.2, 4.5, 2.7)
            let tof = d / 70
            let ax = target.x + target.velX * tof * cfg.aimLead
            let az = target.z + target.velZ * tof * cfg.aimLead
            let spread = (rand01() - 0.5) * cfg.spread
            // auto-pitch to the target's level, spread only sideways
            var dir = simd_normalize(SIMD3(ax - muzzle.x, aimY(target) - muzzle.y, az - muzzle.z))
            dir = rotateY(dir, spread)
            spawnProjectile(pos: muzzle, dir: dir, speed: 70, damage: e.damage, team: .red, life: 1.4, src: e)
            audio.laser(vol: 0.025, startF: 1100)
        }
    }

    /* waves */
    func updateWaves() {
        if elapsed < nextWaveAt || !redBase.alive { return }
        let w = difficulty.wave
        nextWaveAt = elapsed + w.interval
        let alive = entities.filter { $0.kind == .mech && $0.team == .red }.count
        if alive >= w.maxAlive { return }
        stats.wave += 1
        let n = min(w.base + stats.wave / w.growthDiv, w.maxPerWave)
        // spawn at the level's S markers — main force at the one nearest the red
        // base, flankers rotating through the others
        var pts = level.enemySpawns.isEmpty
            ? [P2(x: redBase.x, z: redBase.z + 16)]
            : level.enemySpawns
        pts.sort { distXZ($0.x, $0.z, redBase.x, redBase.z) < distXZ($1.x, $1.z, redBase.x, redBase.z) }
        for i in 0..<n {
            if w.flank && stats.wave >= 2 && pts.count > 1 && i % 3 == 2 {
                let p = pts[1 + i % (pts.count - 1)]
                makeEnemyMech(x: p.x + (rand01() - 0.5) * 6, z: p.z + (rand01() - 0.5) * 6)
            } else {
                let x = (Double(i) - Double(n - 1) / 2) * 7
                makeEnemyMech(x: pts[0].x + x + (rand01() - 0.5) * 3, z: pts[0].z + (rand01() - 0.5) * 4)
            }
        }
        delegate?.engineMessage("WAVE \(stats.wave) INCOMING", colorHex: 0xff9a5a)
        audio.beep(f: 90, f2: 55, dur: 0.6, type: .sawtooth, vol: 0.12)
    }
}
