import Foundation
import SceneKit
import UIKit

/* ============================================================
   Capture the flag — ports game/systems/ctf.js

   Each base gets a flag on a stand in its own courtyard, derived
   from the base marker (13 units toward the enemy: clear of the
   base platform and its collision circle, short of the compound's
   inner screen). Touch the enemy flag to carry it, reach your own
   stand to score; dying drops it, touching your own dropped flag
   sends it home, and an untouched drop goes home by itself.

   A flag is not in `entities` — nothing can shoot it and it has no
   hp — but it *is* an Entity, so the AI can steer at it with the
   code it uses for a base (kind .flag).

   Multiplayer: flags are shared and unowned like the bases. Only
   the client that simulates a mech reports what it did with a flag;
   everyone else mirrors the event, and the capture message carries
   the absolute score so a lost packet can't split it.
============================================================ */

let CAPTURES_TO_WIN = 3
private let RETURN_AFTER = 25.0   // seconds a dropped flag waits for a rescue
private let GRAB_R = 4.5          // how close a mech has to be to shoulder a flag
private let CAP_R = 7.0           // …and to its own stand to score
private let LOST_GRACE = 3.0      // carrier vanished without a drop message

enum FlagState { case home, carried, dropped }

final class Flag {
    let team: Team
    let ent: Entity        // the flag itself: a walk-onto target, not in `entities`
    let stand: Entity      // its home stand, targetable in its own right
    let ghost: SCNNode     // translucent flag shown on the stand while it is away
    var home = P3()
    weak var carrier: Entity?
    var state: FlagState = .home
    var dropT = 0.0
    var lostT = 0.0

    init(team: Team, ent: Entity, stand: Entity, ghost: SCNNode) {
        self.team = team
        self.ent = ent
        self.stand = stand
        self.ghost = ghost
    }
}

struct P3 {
    var x = 0.0, y = 0.0, z = 0.0
}

/* ---------- models ---------- */
private func flagNode(_ palette: Palette, ghost: Bool) -> SCNNode {
    let g = SCNNode()
    let poleGeo = SCNCylinder(radius: 0.16, height: 9)
    poleGeo.radialSegmentCount = 6
    let poleMat = SCNMaterial()
    poleMat.lightingModel = .physicallyBased
    poleMat.diffuse.contents = UIColor(rgb: 0xd8dce6)
    poleMat.metalness.contents = 0.6
    poleMat.roughness.contents = 0.4
    poleGeo.materials = [poleMat]
    let pole = SCNNode(geometry: poleGeo)
    pole.position.y = 4.5
    pole.castsShadow = !ghost
    g.addChildNode(pole)

    let clothMat = SCNMaterial()
    clothMat.lightingModel = .physicallyBased
    clothMat.diffuse.contents = UIColor(rgb: palette.body)
    clothMat.emission.contents = UIColor(rgb: palette.accent)
    clothMat.emission.intensity = ghost ? 0.25 : 1.1
    clothMat.roughness.contents = 0.5
    if ghost { clothMat.transparency = 0.35 }
    let cloth = SCNNode(geometry: SCNBox(width: 3.6, height: 2.3, length: 0.16, chamferRadius: 0))
    cloth.geometry!.materials = [clothMat]
    cloth.position = SCNVector3(1.9, 7.6, 0)
    cloth.castsShadow = !ghost
    g.addChildNode(cloth)
    return g
}

private func standNode(_ palette: Palette) -> SCNNode {
    let g = SCNNode()
    let ringGeo = SCNCylinder(radius: 2.8, height: 0.5)
    ringGeo.radialSegmentCount = 12
    let ringMat = SCNMaterial()
    ringMat.lightingModel = .physicallyBased
    ringMat.diffuse.contents = UIColor(rgb: 0x2a2f3a)
    ringMat.roughness.contents = 0.8
    ringGeo.materials = [ringMat]
    let ring = SCNNode(geometry: ringGeo)
    ring.position.y = 0.25
    g.addChildNode(ring)

    let glowGeo = SCNCylinder(radius: 1.7, height: 0.16)
    glowGeo.radialSegmentCount = 12
    let glowMat = SCNMaterial()
    glowMat.lightingModel = .physicallyBased
    glowMat.diffuse.contents = UIColor(rgb: 0x111111)
    glowMat.emission.contents = UIColor(rgb: palette.accent)
    glowMat.emission.intensity = 1.4
    glowGeo.materials = [glowMat]
    let glow = SCNNode(geometry: glowGeo)
    glow.position.y = 0.55
    glow.castsShadow = false
    g.addChildNode(glow)
    return g
}

extension GameEngine {

    /* ---------- setup ---------- */

    /* the flag stand: far enough in front of the base to clear its platform
       and its collision circle, well short of the compound's inner screen.
       A base that doesn't face the enemy down an axis falls back to the
       cardinal pointing at it, then to the base tile itself. */
    private func flagHome(team: Team) -> P3 {
        let b = team == .blue ? level.blueBase : level.redBase
        let o = team == .blue ? level.redBase : level.blueBase
        let dx = o.x - b.x, dz = o.z - b.z
        let d = max(1e-6, (dx * dx + dz * dz).squareRoot())
        let bh = level.groundHeightAt(b.x, b.z)
        var dirs: [(Double, Double)] = [(dx / d, dz / d)]
        dirs.append(abs(dx) > abs(dz) ? (dx < 0 ? -1 : 1, 0) : (0, dz < 0 ? -1 : 1))
        for (ux, uz) in dirs {
            for r in [13.0, 15, 11, 17, 9] {
                let x = b.x + ux * r, z = b.z + uz * r
                let h = level.groundHeightAt(x, z)
                // a wall reads as WALL_H; a step off the base's own tier would
                // put the flag somewhere a mech can't walk back out of
                if h < WALL_H - 0.01 && abs(h - bh) < 1.2 { return P3(x: x, y: h, z: z) }
            }
        }
        return P3(x: b.x, y: bh, z: b.z)
    }

    private func makeFlag(team: Team) -> Flag {
        let palette = team == .blue ? BLUE_PAL : RED_PAL
        let node = flagNode(palette, ghost: false)
        let standGroup = standNode(palette)
        let ghost = flagNode(palette, ghost: true)
        standGroup.addChildNode(ghost)
        scene.rootNode.addChildNode(node)
        scene.rootNode.addChildNode(standGroup)

        // not registered: a flag has no hp and never enters `entities`
        let ent = Entity(kind: .flag, team: team, node: node, hp: 1, hitRadius: 1.2, hitHeight: 6)
        let stand = Entity(kind: .flag, team: team, node: standGroup, hp: 1, hitRadius: 1.2, hitHeight: 5)
        let f = Flag(team: team, ent: ent, stand: stand, ghost: ghost)
        f.home = flagHome(team: team)
        placeAtHome(f)
        stand.x = f.home.x
        stand.y = f.home.y
        stand.z = f.home.z
        stand.syncNode()
        let on = mode == .ctf
        node.isHidden = !on
        standGroup.isHidden = !on
        ghost.isHidden = true
        return f
    }

    /* built once per engine, like the bases (one engine == one level) */
    func setupFlags() {
        flags = [.blue: makeFlag(team: .blue), .red: makeFlag(team: .red)]
    }

    private func placeAtHome(_ f: Flag) {
        f.ent.x = f.home.x
        f.ent.y = f.home.y + 0.6
        f.ent.z = f.home.z
        f.ent.node.eulerAngles.y = 0
        f.ent.syncNode()
    }

    private func flag(_ team: Team) -> Flag { flags[team]! }

    /* the mechs this client simulates: in PvP only my own, in single player
       everything (the AI included). `simulated` still holds for a mech that
       just died — dropping its flag is the owner's call, not the killer's. */
    private func simulated(_ e: Entity?) -> Bool {
        guard let e else { return false }
        return !e.remote && (!isMP || e.owner == myPlayerId)
    }

    private func carriedBy(_ e: Entity) -> Flag? {
        for f in flags.values where f.carrier === e { return f }
        return nil
    }

    private func near(_ e: Entity, _ x: Double, _ y: Double, _ z: Double, _ r: Double) -> Bool {
        abs(e.y - y) < 8 && (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z) < r * r
    }

    /* ---------- state changes (each one is also a wire event) ---------- */

    private func grabFlag(_ f: Flag, by e: Entity, announce: Bool) {
        f.carrier = e
        f.state = .carried
        f.lostT = 0
        if announce, let id = e.netId {
            net?.sendGame(["t": "fgrab", "tm": f.team.wire, "by": id])
        }
        let mine = f.team == myTeam
        delegate?.engineMessage(mine ? "YOUR FLAG HAS BEEN TAKEN" : "ENEMY FLAG TAKEN — RUN IT HOME",
                                colorHex: mine ? 0xff5040 : 0x7CFF6B)
        audio.beep(f: mine ? 200 : 640, f2: mine ? 120 : 900, dur: 0.25, type: .square, vol: 0.09)
    }

    private func dropFlag(_ f: Flag, x: Double, z: Double, announce: Bool) {
        // dropped over a chasm there would be no getting it back — send it home
        if level.groundHeightAt(x, z) < VOID_EDGE {
            returnFlag(f, announce: announce, byTouch: true)
            return
        }
        f.carrier = nil
        f.state = .dropped
        f.dropT = RETURN_AFTER
        f.lostT = 0
        f.ent.x = x
        f.ent.z = z
        f.ent.y = level.groundHeightAt(x, z) + 0.6
        f.ent.syncNode()
        if announce {
            net?.sendGame(["t": "fdrop", "tm": f.team.wire,
                           "x": (x * 10).rounded() / 10, "z": (z * 10).rounded() / 10])
        }
        delegate?.engineMessage(f.team == myTeam ? "YOUR FLAG WAS DROPPED" : "ENEMY FLAG DROPPED",
                                colorHex: 0xffd23c)
    }

    private func returnFlag(_ f: Flag, announce: Bool, byTouch: Bool) {
        f.carrier = nil
        f.state = .home
        f.dropT = 0
        f.lostT = 0
        placeAtHome(f)
        if announce { net?.sendGame(["t": "fret", "tm": f.team.wire]) }
        if byTouch {
            delegate?.engineMessage(f.team == myTeam ? "YOUR FLAG IS BACK HOME" : "ENEMY FLAG RECOVERED",
                                    colorHex: f.team == myTeam ? 0x7CFF6B : 0xffd23c)
            audio.beep(f: 520, f2: 760, dur: 0.18, type: .sine, vol: 0.07)
        }
    }

    private func captureFlag(_ f: Flag, by e: Entity, announce: Bool) {
        let team = e.team
        stats.captures[team, default: 0] += 1
        returnFlag(f, announce: false, byTouch: false)
        if announce {
            net?.sendGame(["t": "fcap", "tm": f.team.wire, "by": e.netId ?? "",
                           "b": stats.captures[.blue] ?? 0, "r": stats.captures[.red] ?? 0])
        }
        finishCapture(team: team)
    }

    /* shared by the scoring client and everyone mirroring it */
    private func finishCapture(team: Team) {
        let mine = team == myTeam
        let us = stats.captures[myTeam] ?? 0, them = stats.captures[enemyTeam] ?? 0
        delegate?.engineMessage("\(mine ? "FLAG CAPTURED" : "ENEMY CAPTURE") — \(us) : \(them)",
                                colorHex: mine ? 0x7CFF6B : 0xff5040)
        audio.boom(vol: 0.25, dur: mine ? 0.7 : 0.4)
        if (stats.captures[team] ?? 0) >= CAPTURES_TO_WIN {
            endGame(victory: mine,
                    reason: mine ? "\(CAPTURES_TO_WIN) FLAGS CAPTURED — DISTRICT SECURED"
                                 : "THE ENEMY CAPTURED \(CAPTURES_TO_WIN) FLAGS")
        }
    }

    /* ---------- multiplayer: mirror what another client's mech did ---------- */
    func onFlagMsg(_ t: String, _ d: [String: Any]) {
        guard let team = Team(wire: jStr(d, "tm")) else { return }
        let f = flag(team)
        switch t {
        case "fgrab":
            guard let id = jStr(d, "by"), let e = netRegistry[id] else { return }
            grabFlag(f, by: e, announce: false)
        case "fdrop":
            guard let x = jNum(d, "x"), let z = jNum(d, "z") else { return }
            dropFlag(f, x: x, z: z, announce: false)
        case "fret":
            returnFlag(f, announce: false, byTouch: true)
        case "fcap":
            let scorer = jStr(d, "by").flatMap { netRegistry[$0] }?.team ?? f.team.enemy
            returnFlag(f, announce: false, byTouch: false)
            stats.captures[.blue] = Int(jNum(d, "b") ?? 0)
            stats.captures[.red] = Int(jNum(d, "r") ?? 0)
            finishCapture(team: scorer)
        default:
            break
        }
    }

    /* ---------- per-frame ---------- */
    func updateCtf(dt: Double) {
        guard mode == .ctf else { return }

        for f in flags.values {
            switch f.state {
            case .carried:
                if let c = f.carrier, c.alive {
                    f.lostT = 0
                    f.ent.x = c.x
                    f.ent.z = c.z
                    f.ent.y = c.y + c.hitHeight + 1.4
                    f.ent.syncNode()
                    f.ent.node.eulerAngles.y = Float(c.yaw + .pi)
                } else if let c = f.carrier, simulated(c) {
                    // my own carrier died: drop it where it fell
                    dropFlag(f, x: c.x, z: c.z, announce: isMP)
                } else {
                    // someone else's is their client's call — but if that
                    // message never comes (they disconnected mid-run) the flag
                    // would be stranded, so bring it home
                    f.lostT += dt
                    if f.lostT > LOST_GRACE { returnFlag(f, announce: false, byTouch: false) }
                }
            case .dropped:
                f.dropT -= dt
                // every client runs this timer off the same drop event
                if f.dropT <= 0 { returnFlag(f, announce: false, byTouch: true) }
            case .home:
                break
            }
            f.ghost.isHidden = f.state == .home
        }

        // touches, for the mechs this client simulates
        for e in entities where e.alive && (e.kind == .player || e.kind == .mech) {
            guard simulated(e) else { continue }
            let own = flag(e.team), foe = flag(e.team.enemy)
            if let carrying = carriedBy(e) {
                if near(e, own.home.x, own.home.y, own.home.z, CAP_R) {
                    captureFlag(carrying, by: e, announce: isMP)
                }
                continue
            }
            if foe.state != .carried && near(e, foe.ent.x, foe.ent.y, foe.ent.z, GRAB_R) {
                grabFlag(foe, by: e, announce: isMP)
            } else if own.state == .dropped && near(e, own.ent.x, own.ent.y, own.ent.z, GRAB_R) {
                returnFlag(own, announce: isMP, byTouch: true)
            }
        }
    }

    /* ---------- what the enemy AI should walk at (AI.swift) ---------- */
    func ctfGoal(_ e: Entity) -> Entity? {
        let own = flag(e.team), foe = flag(e.team.enemy)
        if foe.carrier === e { return own.stand }                      // carrying: run it home
        if own.state == .carried, let thief = own.carrier, thief.alive { return thief }
        if e.flagRunner && foe.state != .carried { return foe.ent }    // fetch theirs
        if own.state == .dropped { return own.ent }                    // ours is loose
        return nil
    }
}
