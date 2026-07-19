import Foundation
import SceneKit
import UIKit
import simd

/* ============================================================
   Projectiles & damage — ports projectiles.js (single player:
   every projectile is simulated locally, no cosmetic replicas)
============================================================ */

final class Projectile {
    let node: SCNNode
    var pos: SIMD3<Double>
    let vel: SIMD3<Double>
    let team: Team
    let damage: Double
    let rocket: Bool
    let cosmetic: Bool       // replicated enemy shot: visuals only, no damage
    weak var src: Entity?
    var life: Double

    init(node: SCNNode, pos: SIMD3<Double>, vel: SIMD3<Double>, team: Team,
         damage: Double, rocket: Bool, cosmetic: Bool, src: Entity?, life: Double) {
        self.node = node
        self.pos = pos
        self.vel = vel
        self.team = team
        self.damage = damage
        self.rocket = rocket
        self.cosmetic = cosmetic
        self.src = src
        self.life = life
    }
}

private func basicGeometry(_ make: () -> SCNGeometry, color: Int) -> SCNGeometry {
    let g = make()
    let m = SCNMaterial()
    m.lightingModel = .constant
    m.diffuse.contents = UIColor(rgb: color)
    g.materials = [m]
    return g
}

private let tracerGeoBlue = basicGeometry({ SCNBox(width: 0.18, height: 0.18, length: 1.6, chamferRadius: 0) }, color: 0xffe27a)
private let tracerGeoRed = basicGeometry({ SCNBox(width: 0.18, height: 0.18, length: 1.6, chamferRadius: 0) }, color: 0xff5a3a)
private let rocketGeo = basicGeometry({
    let c = SCNCylinder(radius: 0.28, height: 1.4)
    c.radialSegmentCount = 6
    return c
}, color: 0xff8a2a)

/* orient a node's +z axis along `dir` (three.js Object3D.lookAt analog) */
private func orient(_ node: SCNNode, along dir: SIMD3<Double>) {
    let d = simd_normalize(SIMD3<Float>(Float(dir.x), Float(dir.y), Float(dir.z)))
    let front = SIMD3<Float>(0, 0, 1)
    if simd_dot(d, front) < -0.9999 {
        node.simdOrientation = simd_quatf(angle: .pi, axis: SIMD3<Float>(0, 1, 0))
    } else {
        node.simdOrientation = simd_quatf(from: front, to: d)
    }
}

extension GameEngine {

    func spawnProjectile(pos: SIMD3<Double>, dir: SIMD3<Double>, speed: Double, damage: Double,
                         team: Team, rocket: Bool = false, life: Double = 3, src: Entity?,
                         cosmetic: Bool = false) {
        let node: SCNNode
        if rocket {
            let mesh = SCNNode(geometry: rocketGeo)
            mesh.eulerAngles.x = .pi / 2      // cylinder axis y → z
            node = SCNNode()
            node.addChildNode(mesh)
        } else {
            node = SCNNode(geometry: team == .blue ? tracerGeoBlue : tracerGeoRed)
        }
        node.castsShadow = false
        node.position = SCNVector3(pos.x, pos.y, pos.z)
        orient(node, along: dir)
        scene.rootNode.addChildNode(node)
        projectiles.append(Projectile(
            node: node, pos: pos, vel: dir * speed, team: team,
            damage: damage, rocket: rocket, cosmetic: cosmetic, src: src, life: life
        ))
        // multiplayer: broadcast my shots so every other client shows a cosmetic copy
        if isMP && !cosmetic {
            net?.sendGame([
                "t": "shot",
                "x": wire(pos.x, 1), "y": wire(pos.y, 1), "z": wire(pos.z, 1),
                "dx": wire(dir.x, 3), "dy": wire(dir.y, 3), "dz": wire(dir.z, 3),
                "s": speed, "r": rocket ? 1 : 0, "l": life, "tm": team.wire,
            ])
        }
    }

    /* route damage: in multiplayer, entities owned by another client are
       reported to their owner instead of damaged locally; bases are shared
       (unowned), so the shooter applies base damage and broadcasts it for
       everyone to mirror. hp always has exactly one authority. */
    func applyHit(_ e: Entity, _ dmg: Double, src: Entity?) {
        if isMP && e.team == enemyTeam {
            let d = (dmg * 10).rounded() / 10
            if e.kind == .base {
                net?.sendGame(["t": "bhit", "tm": e.team.wire, "d": d])
                damageEntity(e, d, src: src)
            } else if let id = e.netId {
                net?.sendGame(["t": "hit", "id": id, "d": d])   // its owner applies + echoes hp
            }
            return
        }
        damageEntity(e, dmg, src: src)
    }

    func damageEntity(_ e: Entity, _ dmg: Double, src: Entity?) {
        if !e.alive || phase == .over { return }
        e.hp -= dmg
        // mechs retaliate against whoever shot them, even from outside sight range
        if e.kind == .mech, let s = src, s.alive, s.team != e.team {
            e.aggro = s
            e.aggroT = 4
        }
        e.bar?.set(e.hp / e.maxHp)
        if e === player {
            player.lastDamaged = elapsed
        }
        if e.hp <= 0 { killEntity(e); return }
        // echo the authoritative hp of my own entities (player hp rides the state
        // tick; bases are unowned — bhit converges on its own)
        if isMP, let id = e.netId, e.owner == myPlayerId, e.kind != .player {
            net?.sendGame(["t": "hp", "id": id, "hp": Int(e.hp.rounded())])
        }
    }

    func killEntity(_ e: Entity) {
        e.alive = false
        // entities I own die on my client — tell everyone else to mirror it
        // (bases are unowned: every client kills its own copy via bhit damage)
        if isMP, let id = e.netId, e.owner == myPlayerId {
            net?.sendGame(["t": "die", "id": id])
        }
        let scale: Double = e.kind == .base ? 3 : e.kind == .turret ? 1.2 : 1.6
        spawnExplosion(e.x, e.hitHeight / 2, e.z, scale: scale)
        audio.boom(vol: e.kind == .base ? 0.5 : 0.3, dur: e.kind == .base ? 0.8 : 0.4)

        if e.team == enemyTeam {
            // symmetric income in PvP; a kill pays the whole team (every enemy
            // client mirrors the death through this same path)
            let mult = isMP ? 1 : difficulty.salvageMult
            if e.kind == .mech {
                stats.kills += 1
                stats.salvage += 40 * mult
            } else if e.kind == .turret {
                stats.salvage += 80 * mult
            }
        }

        if e.kind == .base {
            endGame(victory: e.team == enemyTeam)
            e.node.removeFromParentNode()
            return
        }

        if e === player {
            e.node.removeFromParentNode()
            player.respawnAt = elapsed + 4
            delegate?.engineRespawnVisible(true)
            return
        }

        e.node.removeFromParentNode()
        if let i = entities.firstIndex(where: { $0 === e }) {
            entities.remove(at: i)
        }
    }

    func splashDamage(pos: SIMD3<Double>, team: Team, radius: Double, maxDmg: Double, src: Entity?) {
        for e in entities {
            if !e.alive || e.team == team { continue }
            let dy = max(0, abs(pos.y - (e.y + e.hitHeight * 0.5)) - e.hitHeight * 0.5)
            let d = distXZ(pos.x, pos.z, e.x, e.z) - e.hitRadius + dy
            if d < radius {
                applyHit(e, maxDmg * (1 - max(0, d) / radius), src: src)
            }
        }
    }

    func updateProjectiles(dt: Double) {
        for i in stride(from: projectiles.count - 1, through: 0, by: -1) {
            let p = projectiles[i]
            p.pos += p.vel * dt
            p.node.position = SCNVector3(p.pos.x, p.pos.y, p.pos.z)
            p.life -= dt
            var dead = p.life <= 0
            var boom = false

            // terrain: ground, walls and cliff sides all stop shots
            if !dead && p.pos.y < level.groundHeightAt(p.pos.x, p.pos.z) + 0.15 {
                dead = true
                boom = true
            }

            if !dead {
                for e in entities {
                    if !e.alive || e.team == p.team { continue }
                    if p.pos.y > e.y + e.hitHeight + 1 || p.pos.y < e.y - 1 { continue }
                    let dx = p.pos.x - e.x, dz = p.pos.z - e.z
                    let r = e.hitRadius + (p.rocket ? 0.6 : 0.25)
                    if dx * dx + dz * dz < r * r {
                        if p.rocket { boom = true }
                        else if !p.cosmetic { applyHit(e, p.damage, src: p.src) }
                        dead = true
                        spawnSpark(p.pos.x, p.pos.y, p.pos.z)
                        break
                    }
                }
            }

            if dead {
                if p.rocket && boom {
                    if !p.cosmetic { splashDamage(pos: p.pos, team: p.team, radius: 9, maxDmg: p.damage, src: p.src) }
                    spawnExplosion(p.pos.x, max(1, p.pos.y), p.pos.z, scale: 0.9)
                    audio.boom(vol: 0.22, dur: 0.3)
                }
                p.node.removeFromParentNode()
                projectiles.remove(at: i)
            }
        }
    }
}
