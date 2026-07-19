import Foundation
import SceneKit
import simd

/* ============================================================
   Player combat & movement — ports player.js for the touch
   control surface (no keyboard, no boost, weapon 1 held-fire;
   rockets and turrets are buttons)
============================================================ */

private let LOOK_SENS = 0.005   // radians per pt of horizontal look drag

extension GameEngine {

    func setupPlayer() {
        // in multiplayer my team comes from the lobby, and my spawn index keeps
        // teammates off each other's spot
        let idx = isMP ? teamIndexOf(playerId: myPlayerId, team: myTeam, roster: mp!.roster) : 0
        let sp = spawnPointFor(team: myTeam, idx: idx)
        spawnPos = sp.pos
        spawnYaw = atan2(sp.face.x - sp.pos.x, sp.face.z - sp.pos.z)   // face the enemy base
        let model = makeMechModel(myTeam == .red ? RED_PAL : BLUE_PAL)
        let e = Entity(kind: .player, team: myTeam, node: model.group, hp: 300, hitRadius: 2.4, hitHeight: 7)
        e.netId = isMP ? "player:\(myPlayerId)" : nil
        e.owner = myPlayerId
        e.legL = model.legL
        e.legR = model.legR
        e.lampR = model.lampR
        e.lampB = model.lampB
        e.x = sp.pos.x
        e.z = sp.pos.z
        e.y = level.groundHeightAt(sp.pos.x, sp.pos.z)
        e.yaw = spawnYaw
        e.bar = HealthBar(width: 5)
        e.syncNode()
        e.node.eulerAngles.y = Float(e.yaw)
        player = e
        registerEntity(e, barHeight: 8.2)
    }

    /* Future-Cop style aim assist: snap to best enemy in a narrow cone */
    private func findAimTarget(muzzle: SIMD3<Double>, yaw: Double) -> Entity? {
        var best: Entity? = nil
        var bestAng = 0.16
        for e in entities {
            if !e.alive || e.team == player.team { continue }
            let dx = e.x - muzzle.x, dz = e.z - muzzle.z
            let d = (dx * dx + dz * dz).squareRoot()
            if d > 75 || d < 2 { continue }
            let ang = abs(angDiff(atan2(dx, dz), yaw))
            if ang < bestAng + (e.kind == .base ? 0.1 : 0) {
                if losBlocked(muzzle.x, muzzle.y, muzzle.z, e.x, aimY(e), e.z) { continue }
                bestAng = ang
                best = e
            }
        }
        return best
    }

    private func aimDir(from muzzle: SIMD3<Double>, yaw: Double) -> SIMD3<Double> {
        if let target = findAimTarget(muzzle: muzzle, yaw: yaw) {
            // guns auto-pitch to the target's level
            return simd_normalize(SIMD3(target.x, aimY(target), target.z) - muzzle)
        }
        return SIMD3(sin(yaw), 0, cos(yaw))
    }

    func firePlayerGun() {
        if player.gunCool > 0 { return }
        player.gunCool = 0.11
        gunSide = -gunSide
        let muzzle = localToWorld(player, 2.2 * gunSide, 4.5, 2.7)
        let dir = aimDir(from: muzzle, yaw: player.yaw)
        spawnProjectile(pos: muzzle, dir: dir, speed: 130, damage: 9, team: player.team, life: 1.2, src: player)
        audio.laser(vol: 0.06, startF: 1800)
    }

    func fireRocket() {
        if !player.alive || player.rocketCool > 0 { return }
        if stats.salvage < Costs.rocket {
            audio.beep(f: 140, f2: 90, dur: 0.15, type: .square, vol: 0.1)
            delegate?.engineBuildHint("NEED 🛢️ \(Int(Costs.rocket)) PER ROCKET")
            return
        }
        player.rocketCool = 0.55
        stats.salvage -= Costs.rocket
        let muzzle = localToWorld(player, 0, 4.8, 2.2)
        let dir = aimDir(from: muzzle, yaw: player.yaw)
        spawnProjectile(pos: muzzle, dir: dir, speed: 60, damage: 60, team: player.team, rocket: true, life: 3, src: player)
        audio.beep(f: 160, f2: 40, dur: 0.35, type: .sawtooth, vol: 0.12)
    }

    func updatePlayer(dt: Double) {
        let lookDX = touch.takeLookDX()   // drain even while dead, so respawn doesn't jump
        if !player.alive {
            if elapsed >= player.respawnAt { respawnPlayer() }
            return
        }
        let speed = 16.0
        player.yaw -= lookDX * LOOK_SENS
        if let targetYaw = touch.yaw {
            // ease toward the compass heading along the shortest arc (1:1, no gain)
            let d = angDiff(targetYaw, player.yaw)
            player.yaw += d * min(1, 10 * dt)
        }
        let fwd = SIMD3<Double>(sin(player.yaw), 0, cos(player.yaw))
        let right = SIMD3<Double>(-fwd.z, 0, fwd.x)
        var move = SIMD3<Double>.zero
        let tm = touch.move, ts = touch.strafe
        if tm > 0 { move += fwd }
        if tm < 0 { move -= fwd }
        if ts < 0 { move -= right }
        if ts > 0 { move += right }

        let moving = simd_length_squared(move) > 0
        if moving {
            move = simd_normalize(move)
            player.x += move.x * speed * dt
            player.z += move.z * speed * dt
            player.walkPhase += dt * 9
        }
        // tracked so enemy AI can lead its shots
        player.velX = moving ? move.x * speed : 0
        player.velZ = moving ? move.z * speed : 0
        collideCircle(x: &player.x, z: &player.z, r: 2.2, y: player.y)
        let onGround = updateVertical(player, dt: dt)
        player.node.eulerAngles.y = Float(player.yaw)

        // walk animation + bob
        let sw = moving ? sin(player.walkPhase) * 0.55 : 0
        player.legL?.eulerAngles.x = Float(sw)
        player.legR?.eulerAngles.x = Float(-sw)
        player.syncNode(bob: moving && onGround ? abs(sin(player.walkPhase)) * 0.25 : 0)

        // police light blink
        let blink = sin(elapsed * 10) > 0
        player.lampR?.emission.intensity = blink ? 3 : 0.3
        player.lampB?.emission.intensity = blink ? 0.3 : 3

        player.gunCool -= dt
        player.rocketCool -= dt
        if touch.firing {
            firePlayerGun()
        }

        // slow self-repair after 5s without damage
        if player.hp < player.maxHp && elapsed - player.lastDamaged > 5 {
            player.hp = min(player.maxHp, player.hp + 9 * dt)
            player.bar?.set(player.hp / player.maxHp)
        }
    }

    private func respawnPlayer() {
        player.alive = true
        player.hp = player.maxHp
        player.bar?.set(1)
        player.yaw = spawnYaw
        player.x = spawnPos.x
        player.z = spawnPos.z
        player.y = level.groundHeightAt(spawnPos.x, spawnPos.z)
        player.vy = 0
        player.syncNode()
        player.node.eulerAngles.y = Float(player.yaw)
        scene.rootNode.addChildNode(player.node)
        delegate?.engineRespawnVisible(false)
        if isMP { net?.sendGame(["t": "respawn"]) }
        delegate?.engineMessage("MECH REDEPLOYED", colorHex: 0x8ab4ff)
    }
}
