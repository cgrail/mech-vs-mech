import Foundation
import SceneKit
import UIKit
import simd

/* ============================================================
   Multiplayer match sync — ports systems/remote.js (up to 5 v 5)

   Ownership: each client simulates only what it owns — its player
   mech, the turrets it built, its projectiles. Everyone else's
   entities are replicas driven by network events (the server
   stamps each relayed event with the sender's playerId, so `from`
   is trustworthy):

     s        15 Hz state (position/yaw/velocity/hp + turret yaws)
     shot     a projectile was fired → spawn a cosmetic copy
     hit      my projectile hit an entity YOU own → you apply it
     hp       authoritative hp echo after a hit was applied
     bhit     damage to a base — shared, everyone mirrors it
     build    a turret was built
     die      an entity its owner simulates died → mirror it
     respawn  a player redeployed

   Damage to owned entities is shooter-reported but owner-applied,
   so hp has exactly one authority. Base hp converges because every
   client applies every bhit exactly once.
============================================================ */

struct PeerState {
    var x = 0.0, z = 0.0, y = 0.0, yaw = 0.0
    var vx = 0.0, vz = 0.0
    var moving = false
    var age = 0.0
}

final class Peer {
    let id: Int
    let name: String
    let team: Team
    let idx: Int
    let ent: Entity
    var connected = true
    var st = PeerState()

    init(id: Int, name: String, team: Team, idx: Int, ent: Entity) {
        self.id = id
        self.name = name
        self.team = team
        self.idx = idx
        self.ent = ent
    }
}

/* floating callsign so team fights stay readable */
private func makeNameTag(_ text: String, team: Team) -> SCNNode {
    let w = 256, h = 40
    UIGraphicsBeginImageContextWithOptions(CGSize(width: w, height: h), false, 1)
    let ctx = UIGraphicsGetCurrentContext()!
    let para = NSMutableParagraphStyle()
    para.alignment = .center
    let attrs: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: 26, weight: .bold),
        .foregroundColor: UIColor(rgb: team == .red ? 0xffb3a6 : 0xa9c9ff),
        .paragraphStyle: para,
        .shadow: {
            let s = NSShadow()
            s.shadowColor = UIColor(white: 0, alpha: 0.9)
            s.shadowBlurRadius = 5
            return s
        }(),
    ]
    (text as NSString).draw(in: CGRect(x: 0, y: 4, width: w, height: h - 4), withAttributes: attrs)
    let img = UIGraphicsGetImageFromCurrentImageContext()!
    UIGraphicsEndImageContext()
    _ = ctx

    let plane = SCNPlane(width: 9, height: 9 * Double(h) / Double(w))
    let mat = SCNMaterial()
    mat.lightingModel = .constant
    mat.diffuse.contents = img
    mat.isDoubleSided = true
    mat.readsFromDepthBuffer = false
    mat.writesToDepthBuffer = false
    plane.firstMaterial = mat
    let node = SCNNode(geometry: plane)
    node.castsShadow = false
    node.renderingOrder = 10
    node.position.y = 9.6
    let bb = SCNBillboardConstraint()
    bb.freeAxes = .all
    node.constraints = [bb]
    return node
}

extension GameEngine {

    /* spawn a replica for every other player in the match */
    func initMatch() {
        guard let mp else { return }
        for p in mp.roster where p.id != mp.playerId {
            makePeer(p)
        }
    }

    private func makePeer(_ p: MPPlayer) {
        let idx = teamIndexOf(playerId: p.id, team: p.team, roster: mp!.roster)
        let sp = spawnPointFor(team: p.team, idx: idx)
        let y = level.groundHeightAt(sp.pos.x, sp.pos.z)
        let model = makeMechModel(p.team == .red ? RED_PAL : BLUE_PAL)
        let e = Entity(kind: .mech, team: p.team, node: model.group, hp: 300, hitRadius: 2.4, hitHeight: 7)
        e.netId = "player:\(p.id)"
        e.owner = p.id
        e.remote = true
        e.legL = model.legL
        e.legR = model.legR
        e.lampR = model.lampR
        e.lampB = model.lampB
        e.x = sp.pos.x
        e.z = sp.pos.z
        e.y = y
        e.yaw = atan2(sp.face.x - sp.pos.x, sp.face.z - sp.pos.z)
        e.bar = HealthBar(width: 5)
        e.syncNode()
        e.node.eulerAngles.y = Float(e.yaw)
        e.node.addChildNode(makeNameTag(p.name, team: p.team))
        registerEntity(e, barHeight: 8.2)

        let peer = Peer(id: p.id, name: p.name, team: p.team, idx: idx, ent: e)
        peer.st = PeerState(x: sp.pos.x, z: sp.pos.z, y: y, yaw: e.yaw,
                            vx: 0, vz: 0, moving: false, age: 0)
        peers[p.id] = peer
    }

    // MARK: - Inbound events (called on the render thread via enqueue)

    /* a relayed game event; `from` is the server-stamped sender playerId */
    func onGameMsg(_ d: [String: Any], from: Int) {
        enqueue { self.handleGameMsg(d, from: from) }
    }

    private func handleGameMsg(_ d: [String: Any], from: Int) {
        guard let t = jStr(d, "t") else { return }
        let peer = peers[from]
        switch t {
        case "s":   // a player's state tick
            guard let peer else { return }
            var st = peer.st
            st.x = jNum(d, "x") ?? st.x
            st.z = jNum(d, "z") ?? st.z
            st.y = jNum(d, "y") ?? st.y
            st.yaw = jNum(d, "yaw") ?? st.yaw
            st.vx = jNum(d, "vx") ?? 0
            st.vz = jNum(d, "vz") ?? 0
            st.moving = (jInt(d, "m") ?? 0) != 0
            st.age = 0
            peer.st = st
            let e = peer.ent
            if e.alive, let hp = jNum(d, "hp") {
                e.hp = hp
                e.bar?.set(hp / e.maxHp)
            }
            if let tu = d["tu"] as? [[Any]] {
                for pair in tu where pair.count == 2 {
                    guard let id = pair[0] as? String,
                          let yaw = (pair[1] as? NSNumber)?.doubleValue,
                          let tur = netRegistry[id], tur.alive, tur.head != nil, tur.owner == from
                    else { continue }
                    tur.yaw = yaw
                    tur.head?.eulerAngles.y = Float(yaw)
                }
            }

        case "shot":   // cosmetic: real damage arrives as hit/bhit from the shooter
            guard let team = Team(wire: jStr(d, "tm")),
                  let x = jNum(d, "x"), let y = jNum(d, "y"), let z = jNum(d, "z"),
                  let dx = jNum(d, "dx"), let dy = jNum(d, "dy"), let dz = jNum(d, "dz") else { return }
            spawnProjectile(
                pos: SIMD3(x, y, z), dir: SIMD3(dx, dy, dz),
                speed: jNum(d, "s") ?? 100, damage: 0, team: team,
                rocket: (jInt(d, "r") ?? 0) != 0, life: jNum(d, "l") ?? 3,
                src: nil, cosmetic: true)

        case "hit":   // a projectile hit an entity I own — I apply it
            guard let id = jStr(d, "id"), let e = netRegistry[id],
                  e.alive, e.owner == myPlayerId, let dmg = jNum(d, "d") else { return }
            damageEntity(e, dmg, src: peer?.ent)

        case "bhit":  // base damage — shared entity, everyone mirrors the event
            let base = jStr(d, "tm") == "blue" ? blueBase! : redBase!
            if base.alive, let dmg = jNum(d, "d") { damageEntity(base, dmg, src: peer?.ent) }

        case "hp":    // authoritative hp of another player's entity after a hit
            guard let id = jStr(d, "id"), let e = netRegistry[id],
                  e.alive, e.owner == from, let hp = jNum(d, "hp") else { return }
            e.hp = hp
            e.bar?.set(hp / e.maxHp)

        case "build":
            guard let peer, let id = jStr(d, "id"), netRegistry[id] == nil,
                  let x = jNum(d, "x"), let z = jNum(d, "z") else { return }
            let tur = makeTurretEntity(team: peer.team, x: x, z: z, netId: id, owner: from)
            tur.remote = true

        case "die":   // an entity died on its owner's client — mirror it
            guard let id = jStr(d, "id"), let e = netRegistry[id], e.alive, e.owner == from else { return }
            killEntity(e)

        case "respawn":
            guard let peer else { return }
            let e = peer.ent
            let sp = spawnPointFor(team: peer.team, idx: peer.idx)
            e.alive = true
            e.hp = e.maxHp
            e.bar?.set(1)
            e.y = level.groundHeightAt(sp.pos.x, sp.pos.z)
            e.vy = 0
            e.x = sp.pos.x
            e.z = sp.pos.z
            peer.st = PeerState(x: sp.pos.x, z: sp.pos.z, y: e.y, yaw: e.yaw,
                                vx: 0, vz: 0, moving: false, age: 0)
            e.syncNode()
            if !entities.contains(where: { $0 === e }) { entities.append(e) }  // killEntity spliced it
            if e.node.parent == nil { scene.rootNode.addChildNode(e.node) }

        default:
            break
        }
    }

    /* a player's socket dropped: despawn everything they owned — nobody is left
       to simulate it, and hits on it would never be applied */
    func handlePeerLeft(id: Int, name: String) {
        guard let peer = peers[id], peer.connected else { return }
        peer.connected = false
        for e in entities where e.owner == id {
            e.alive = false
            e.node.removeFromParentNode()
        }
        entities.removeAll { $0.owner == id && !$0.alive }
        delegate?.engineMessage("\(name.isEmpty ? peer.name : name) DISCONNECTED",
                                colorHex: peer.team == myTeam ? 0xff8a7a : 0x8ab4ff)
        if peer.team == enemyTeam
            && !peers.values.contains(where: { $0.team == enemyTeam && $0.connected }) {
            endGame(victory: true, reason: "ALL OPPONENTS DISCONNECTED — DISTRICT SECURED")
        }
    }

    /* a player reconnected mid-match (their client restarted from scratch) */
    func handlePeerJoined(id: Int, name: String) {
        guard let mp, let p = mp.roster.first(where: { $0.id == id }) else { return }
        if let existing = peers[id], existing.connected { return }
        // remove the stale replica, then build a fresh one
        if let old = peers[id] {
            old.ent.alive = false
            old.ent.node.removeFromParentNode()
            entities.removeAll { $0 === old.ent }
        }
        makePeer(p)
        delegate?.engineMessage("\(p.name) RECONNECTED", colorHex: 0x8ab4ff)
    }

    func handleConnectionLost() {
        endGame(victory: false, reason: "CONNECTION TO SERVER LOST")
    }

    // MARK: - Per-frame: send my state, ease every replica

    private static let sendDT = 1.0 / 15.0

    func remoteUpdate(dt: Double) {
        guard isMP else { return }

        if phase == .playing {
            sendAcc += dt
            if sendAcc >= Self.sendDT {
                sendAcc = sendAcc.truncatingRemainder(dividingBy: Self.sendDT)
                sendState()
            }
        }

        let blink = sin(elapsed * 10) > 0
        for peer in peers.values {
            let e = peer.ent
            if !e.alive { continue }
            var st = peer.st

            // ease toward the last packet, extrapolated briefly along its velocity
            st.age = min(st.age + dt, 0.25)
            let tx = st.x + st.vx * st.age, tz = st.z + st.vz * st.age
            if hypot(tx - e.x, tz - e.z) > 14 {   // snap after teleports
                e.x = tx; e.z = tz; e.y = st.y
            }
            let k = 1 - exp(-12 * dt)
            e.x += (tx - e.x) * k
            e.z += (tz - e.z) * k
            e.y += (st.y - e.y) * min(1, 14 * dt)
            let dyaw = angDiff(st.yaw, e.yaw)
            e.yaw += dyaw * min(1, 12 * dt)
            e.node.eulerAngles.y = Float(e.yaw)
            e.velX = st.vx
            e.velZ = st.vz
            peer.st = st

            if st.moving { e.walkPhase += dt * 9 }
            let sw = st.moving ? sin(e.walkPhase) * 0.55 : 0
            e.legL?.eulerAngles.x = Float(sw)
            e.legR?.eulerAngles.x = Float(-sw)
            e.syncNode(bob: st.moving ? abs(sin(e.walkPhase)) * 0.25 : 0)

            e.lampR?.emission.intensity = blink ? 3 : 0.3
            e.lampB?.emission.intensity = blink ? 0.3 : 3
        }
    }

    private func sendState() {
        var tu: [[Any]] = []
        for e in entities where e.alive && e.kind == .turret && e.owner == myPlayerId && e.netId != nil {
            tu.append([e.netId!, wire(e.yaw, 2)])
        }
        net?.sendGame([
            "t": "s",
            "x": wire(player.x, 2), "z": wire(player.z, 2), "y": wire(player.y, 2),
            "yaw": wire(player.yaw, 3),
            "vx": wire(player.velX, 1), "vz": wire(player.velZ, 1),
            "hp": Int(player.hp.rounded()),
            "m": (player.velX != 0 || player.velZ != 0) ? 1 : 0,
            "tu": tu,
        ])
    }
}
