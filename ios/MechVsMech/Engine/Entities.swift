import Foundation
import SceneKit
import UIKit

/* ============================================================
   Entities — ports entities.js (minus multiplayer netIds).
   One flat `entities` array on the engine; `kind` and `team`
   drive everything else.
============================================================ */

struct Palette {
    let body: Int
    let accent: Int
}

let BLUE_PAL = Palette(body: 0x2b4fd8, accent: 0x6fd2ff)
let RED_PAL = Palette(body: 0xa42a20, accent: 0xffb03a)

final class Entity {
    enum Kind { case player, mech, turret, base }

    let kind: Kind
    let team: Team
    let node: SCNNode

    // authoritative position — the node is synced after each update
    var x = 0.0
    var y = 0.0          // walking height (walkers) / ground height (static)
    var z = 0.0
    var vy = 0.0
    var yaw = 0.0

    var hp: Double
    var maxHp: Double
    var alive = true
    let hitRadius: Double
    let hitHeight: Double
    var bar: HealthBar?

    // multiplayer ownership (SP: netId nil, owner 0, remote false)
    var netId: String?
    var owner = 0            // playerId of the client that simulates this entity
    var remote = false       // a replica driven by the network, not local sim

    // combat / AI (per-entity timers, like the JS object fields)
    var speed = 0.0
    var range = 0.0
    var damage = 0.0
    var fireInterval = 1.0
    var cool = 0.0
    var retargetT = 0.0
    weak var target: Entity?
    weak var aggro: Entity?
    var aggroT = 0.0
    var walkPhase = 0.0
    var strafeDir = 1.0
    var strafeTimer = 0.0
    var stuckT = 0.0
    var detourT = 0.0
    var detourYaw = 0.0
    var px = 0.0
    var pz = 0.0
    var velX = 0.0
    var velZ = 0.0

    // model parts (mech: legs + lamps, turret: head)
    var legL: SCNNode?
    var legR: SCNNode?
    var head: SCNNode?
    var lampR: SCNMaterial?
    var lampB: SCNMaterial?

    // player
    var gunCool = 0.0
    var rocketCool = 0.0
    var lastDamaged = -99.0
    var respawnAt = 0.0

    init(kind: Kind, team: Team, node: SCNNode, hp: Double, hitRadius: Double, hitHeight: Double) {
        self.kind = kind
        self.team = team
        self.node = node
        self.hp = hp
        self.maxHp = hp
        self.hitRadius = hitRadius
        self.hitHeight = hitHeight
    }

    /* write position to the scene graph; walkers add the walk bob */
    func syncNode(bob: Double = 0) {
        node.position = SCNVector3(x, y + bob, z)
    }
}

/* ============================================================
   Health bars — billboard planes standing in for canvas sprites
============================================================ */
final class HealthBar {
    let node: SCNNode
    private let fill: SCNNode
    private let fillMat: SCNMaterial
    private let fullWidth: Double

    init(width: Double) {
        let h = width * 10 / 64
        node = SCNNode()
        let bb = SCNBillboardConstraint()
        bb.freeAxes = .all
        node.constraints = [bb]

        func flatMaterial(_ color: UIColor) -> SCNMaterial {
            let m = SCNMaterial()
            m.lightingModel = .constant
            m.diffuse.contents = color
            m.readsFromDepthBuffer = false
            m.writesToDepthBuffer = false
            return m
        }

        let bg = SCNNode(geometry: SCNPlane(width: width, height: h))
        bg.geometry!.firstMaterial = flatMaterial(UIColor(white: 0, alpha: 0.7))
        bg.renderingOrder = 10
        bg.castsShadow = false
        node.addChildNode(bg)

        fullWidth = width * 60 / 64
        fillMat = flatMaterial(UIColor(rgb: 0x00ff28))
        fill = SCNNode(geometry: SCNPlane(width: fullWidth, height: width * 6 / 64))
        fill.geometry!.firstMaterial = fillMat
        fill.position.z = 0.02
        fill.renderingOrder = 11
        fill.castsShadow = false
        node.addChildNode(fill)
        set(1)
    }

    func set(_ frac: Double) {
        let f = max(0, min(1, frac))
        fill.scale.x = Float(max(0.0001, f))
        fill.position.x = Float(-fullWidth / 2 * (1 - f))
        let r = min(1, 2 - 2 * f)
        let g = min(1, 2 * f)
        fillMat.diffuse.contents = UIColor(red: r, green: g, blue: 40 / 255, alpha: 1)
    }
}

/* ============================================================
   Models: mech, turret, base — box-built, same proportions as
   the three.js versions
============================================================ */

private func stdMaterial(_ color: Int, roughness: Double, metalness: Double) -> SCNMaterial {
    let m = SCNMaterial()
    m.lightingModel = .physicallyBased
    m.diffuse.contents = UIColor(rgb: color)
    m.roughness.contents = roughness
    m.metalness.contents = metalness
    return m
}

@discardableResult
private func addBoxPart(_ w: Double, _ h: Double, _ d: Double, _ mat: SCNMaterial,
                        _ x: Double, _ y: Double, _ z: Double, to parent: SCNNode) -> SCNNode {
    let box = SCNBox(width: w, height: h, length: d, chamferRadius: 0)
    box.materials = [mat]
    let n = SCNNode(geometry: box)
    n.position = SCNVector3(x, y, z)
    n.castsShadow = true
    parent.addChildNode(n)
    return n
}

struct MechModel {
    let group: SCNNode
    let legL: SCNNode
    let legR: SCNNode
    let lampR: SCNMaterial
    let lampB: SCNMaterial
}

func makeMechModel(_ palette: Palette) -> MechModel {
    let g = SCNNode()
    let body = stdMaterial(palette.body, roughness: 0.55, metalness: 0.35)
    let dark = stdMaterial(0x23262e, roughness: 0.7, metalness: 0.3)
    let accent = stdMaterial(palette.accent, roughness: 0.4, metalness: 0.3)

    // legs: pivot groups at hip height so they can swing
    let legL = SCNNode(); legL.position = SCNVector3(-1.1, 2.6, 0); g.addChildNode(legL)
    let legR = SCNNode(); legR.position = SCNVector3(1.1, 2.6, 0); g.addChildNode(legR)
    for leg in [legL, legR] {
        addBoxPart(0.8, 1.6, 1.0, dark, 0, -0.8, 0, to: leg)      // thigh
        addBoxPart(0.7, 1.4, 0.8, body, 0, -2.0, 0.15, to: leg)   // shin
        addBoxPart(1.1, 0.5, 1.8, dark, 0, -2.85, 0.35, to: leg)  // foot
    }

    addBoxPart(2.8, 1.0, 2.0, dark, 0, 2.9, 0, to: g)             // pelvis
    addBoxPart(3.4, 1.8, 2.6, body, 0, 4.2, 0, to: g)             // torso
    addBoxPart(1.6, 0.9, 1.2, accent, 0, 5.4, 0.6, to: g)         // cockpit
    addBoxPart(1.2, 0.35, 0.9, dark, 0, 5.95, 0.4, to: g)         // sensor block

    // shoulder gun pods
    addBoxPart(1.0, 1.0, 2.4, dark, -2.2, 4.5, 0.4, to: g)
    addBoxPart(1.0, 1.0, 2.4, dark, 2.2, 4.5, 0.4, to: g)
    addBoxPart(0.3, 0.3, 1.6, accent, -2.2, 4.5, 1.9, to: g)      // barrels
    addBoxPart(0.3, 0.3, 1.6, accent, 2.2, 4.5, 1.9, to: g)

    // police lights (blink in update)
    let lampRMat = SCNMaterial()
    lampRMat.lightingModel = .physicallyBased
    lampRMat.diffuse.contents = UIColor(rgb: 0x330000)
    lampRMat.emission.contents = UIColor(rgb: 0xff2222)
    lampRMat.emission.intensity = 2
    let lampBMat = SCNMaterial()
    lampBMat.lightingModel = .physicallyBased
    lampBMat.diffuse.contents = UIColor(rgb: 0x000033)
    lampBMat.emission.contents = UIColor(rgb: 0x2244ff)
    lampBMat.emission.intensity = 2
    addBoxPart(0.35, 0.3, 0.35, lampRMat, -0.45, 6.3, 0.4, to: g)
    addBoxPart(0.35, 0.3, 0.35, lampBMat, 0.45, 6.3, 0.4, to: g)

    return MechModel(group: g, legL: legL, legR: legR, lampR: lampRMat, lampB: lampBMat)
}

struct TurretModel {
    let group: SCNNode
    let head: SCNNode
}

func makeTurretModel(_ palette: Palette) -> TurretModel {
    let g = SCNNode()
    let body = stdMaterial(palette.body, roughness: 0.55, metalness: 0.35)
    let dark = stdMaterial(0x2a2d34, roughness: 0.7, metalness: 0)
    let accent = stdMaterial(palette.accent, roughness: 0.4, metalness: 0)

    let baseGeo = SCNCylinder(radius: 1.8, height: 1.2)  // tapered 1.6→2.0 in three.js; cylinder is close enough
    baseGeo.radialSegmentCount = 8
    baseGeo.materials = [dark]
    let base = SCNNode(geometry: baseGeo)
    base.position.y = 0.6
    base.castsShadow = true
    g.addChildNode(base)

    let neckGeo = SCNCylinder(radius: 0.8, height: 1.2)
    neckGeo.radialSegmentCount = 8
    neckGeo.materials = [body]
    let neck = SCNNode(geometry: neckGeo)
    neck.position.y = 1.7
    neck.castsShadow = true
    g.addChildNode(neck)

    let head = SCNNode()
    head.position.y = 2.7
    g.addChildNode(head)
    addBoxPart(2.0, 1.1, 1.6, body, 0, 0, 0, to: head)
    for sx in [-0.45, 0.45] {
        addBoxPart(0.25, 0.25, 2.2, accent, sx, 0.05, 1.4, to: head)
    }
    let eyeMat = SCNMaterial()
    eyeMat.lightingModel = .physicallyBased
    eyeMat.diffuse.contents = UIColor(rgb: 0x111111)
    eyeMat.emission.contents = UIColor(rgb: palette.accent)
    eyeMat.emission.intensity = 2
    addBoxPart(0.5, 0.3, 0.1, eyeMat, 0, 0.35, 0.85, to: head)
    return TurretModel(group: g, head: head)
}

func makeBaseModel(_ palette: Palette) -> SCNNode {
    let g = SCNNode()
    let body = stdMaterial(palette.body, roughness: 0.6, metalness: 0.3)
    let dark = stdMaterial(0x333842, roughness: 0.8, metalness: 0)
    let glow = SCNMaterial()
    glow.lightingModel = .physicallyBased
    glow.diffuse.contents = UIColor(rgb: 0x111111)
    glow.emission.contents = UIColor(rgb: palette.accent)
    glow.emission.intensity = 1.6

    addBoxPart(16, 2, 16, dark, 0, 1, 0, to: g)        // platform
    addBoxPart(8, 9, 8, body, 0, 6.5, 0, to: g)        // tower
    addBoxPart(5, 2.5, 5, dark, 0, 12.2, 0, to: g)     // top

    let spikeGeo = SCNCylinder(radius: 0.22, height: 5) // tapered 0.15→0.3 in three.js
    spikeGeo.radialSegmentCount = 6
    spikeGeo.materials = [dark]
    let spike = SCNNode(geometry: spikeGeo)
    spike.position.y = 16
    g.addChildNode(spike)

    let beaconGeo = SCNSphere(radius: 0.5)
    beaconGeo.segmentCount = 8
    beaconGeo.materials = [glow]
    let beacon = SCNNode(geometry: beaconGeo)
    beacon.position.y = 18.6
    g.addChildNode(beacon)

    for (px, pz) in [(-6.5, -6.5), (6.5, -6.5), (-6.5, 6.5), (6.5, 6.5)] {
        addBoxPart(2, 6, 2, body, px, 4, pz, to: g)    // pillars
    }
    // glowing core panels
    for ry in [0.0, .pi / 2, .pi, -.pi / 2] {
        let panel = addBoxPart(3.4, 4.5, 0.3, glow, sin(ry) * 4.1, 6.2, cos(ry) * 4.1, to: g)
        panel.eulerAngles.y = Float(ry)
        panel.castsShadow = false
    }

    let light = SCNLight()
    light.type = .omni
    light.color = UIColor(rgb: palette.accent)
    light.intensity = 1500
    light.attenuationStartDistance = 0
    light.attenuationEndDistance = 45
    let lightNode = SCNNode()
    lightNode.light = light
    lightNode.position.y = 8
    g.addChildNode(lightNode)
    return g
}

/* ============================================================
   Entity factories — engine methods so they can register into
   the scene + entities array (ports registerEntity & friends)
============================================================ */
extension GameEngine {

    @discardableResult
    func registerEntity(_ e: Entity, barHeight: Double) -> Entity {
        entities.append(e)
        scene.rootNode.addChildNode(e.node)
        if let bar = e.bar {
            bar.node.position.y = Float(barHeight)
            e.node.addChildNode(bar.node)
        }
        if let id = e.netId { netRegistry[id] = e }  // addressable by multiplayer events
        return e
    }

    @discardableResult
    func makeBaseEntity(team: Team, x: Double, z: Double) -> Entity {
        let palette = team == .blue ? BLUE_PAL : RED_PAL
        let node = makeBaseModel(palette)
        let e = Entity(kind: .base, team: team, node: node, hp: 1200, hitRadius: 9.5, hitHeight: 14)
        e.netId = "base:\(team.wire)"   // bases are shared and unowned
        e.x = x
        e.z = z
        e.y = level.groundHeightAt(x, z)
        e.bar = HealthBar(width: 14)
        e.syncNode()
        return registerEntity(e, barHeight: 16)
    }

    @discardableResult
    func makeTurretEntity(team: Team, x: Double, z: Double,
                          netId: String? = nil, owner: Int = 0) -> Entity {
        let palette = team == .blue ? BLUE_PAL : RED_PAL
        let model = makeTurretModel(palette)
        // in multiplayer every turret is player-built — both teams get the blue
        // profile so the match stays symmetric (SP red marker turrets get their
        // stats overwritten by applyDifficulty() on deploy)
        let mine = team == .blue || isMP
        let e = Entity(kind: .turret, team: team, node: model.group,
                       hp: mine ? 260 : 320, hitRadius: 2.2, hitHeight: 4)
        e.netId = netId
        e.owner = owner
        e.head = model.head
        e.x = x
        e.z = z
        e.y = level.groundHeightAt(x, z)
        e.range = mine ? 48 : 44
        e.damage = 8
        e.fireInterval = mine ? 0.28 : 0.34
        e.cool = rand01() * 0.4
        e.bar = HealthBar(width: 5)
        e.syncNode()
        return registerEntity(e, barHeight: 5.2)
    }

    @discardableResult
    func makeEnemyMech(x: Double, z: Double) -> Entity {
        let model = makeMechModel(RED_PAL)
        let m = difficulty.mech
        let e = Entity(kind: .mech, team: .red, node: model.group, hp: m.hp, hitRadius: 2.4, hitHeight: 7)
        e.legL = model.legL
        e.legR = model.legR
        e.lampR = model.lampR
        e.lampB = model.lampB
        e.x = x
        e.z = z
        e.y = level.groundHeightAt(x, z)
        e.px = x
        e.pz = z
        e.speed = m.speed + rand01() * 2
        e.range = m.range
        e.damage = m.damage
        e.fireInterval = m.fireInterval
        e.cool = 1 + rand01()
        e.walkPhase = rand01() * 6
        e.bar = HealthBar(width: 5)
        e.syncNode()
        return registerEntity(e, barHeight: 8.2)
    }
}
