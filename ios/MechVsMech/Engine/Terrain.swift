import Foundation
import SceneKit
import UIKit

/* ============================================================
   Terrain queries — ports the query half of world.js.
   Terrain is the single source of truth for physics: there is
   no obstacle list anywhere.
============================================================ */
extension Level {

    private func cellAt(_ x: Double, _ z: Double) -> Cell? {
        let c = Int(floor((x + arenaHW) / TILE))
        let r = Int(floor((z + arenaHD) / TILE))
        guard r >= 0, r < rows, c >= 0, c < cols else { return nil }
        return cells[r][c]
    }

    /* walking-surface height at a world position (walls count as their top) */
    func groundHeightAt(_ x: Double, _ z: Double) -> Double {
        switch cellAt(x, z) {
        case .none:
            // past the last tile there is no floor either: the map border is an
            // edge you can walk off, not an invisible fence (nothing clamps to
            // the arena any more — see collideCircle), so a walker that leaves
            // the district falls out of it
            return VOID_H
        case .some(.wall):
            return WALL_H
        case .some(.void):
            return VOID_H   // nothing to stand on, nothing to stop a shot
        case .some(.ramp(let axisX, let h0, let h1)):
            let f = axisX
                ? (x + arenaHW) / TILE - floor((x + arenaHW) / TILE)
                : (z + arenaHD) / TILE - floor((z + arenaHD) / TILE)
            return h0 + (h1 - h0) * f
        case .some(.flat(let h)):
            return h
        }
    }

    /* push a circle standing at height y out of tiles too tall to step onto */
    func collideTerrain(x px: inout Double, z pz: inout Double, r: Double, y: Double) {
        let c0 = Int(floor((px - r + arenaHW) / TILE)), c1 = Int(floor((px + r + arenaHW) / TILE))
        let r0 = Int(floor((pz - r + arenaHD) / TILE)), r1 = Int(floor((pz + r + arenaHD) / TILE))
        for tr in r0...max(r0, r1) {
            for tc in c0...max(c0, c1) {
                let cell: Cell? = (tr >= 0 && tr < rows && tc >= 0 && tc < cols) ? cells[tr][tc] : nil
                let h: Double
                switch cell {
                case .none: h = VOID_H              // off the grid is a hole too
                case .some(.wall): h = WALL_H
                case .some(.void): h = VOID_H       // a hole never pushes anything out
                case .some(.ramp(_, let h0, let h1)): h = min(h0, h1)
                case .some(.flat(let fh)): h = fh
                }
                if h <= y + STEP { continue }
                let ox = -arenaHW + (Double(tc) + 0.5) * TILE
                let oz = -arenaHD + (Double(tr) + 0.5) * TILE
                let nx = max(ox - TILE / 2, min(px, ox + TILE / 2))
                let nz = max(oz - TILE / 2, min(pz, oz + TILE / 2))
                let dx = px - nx, dz = pz - nz
                let d2 = dx * dx + dz * dz
                if d2 >= r * r { continue }
                if d2 < 1e-6 { // center inside: push along smallest axis
                    let pushX = TILE / 2 - abs(px - ox)
                    let pushZ = TILE / 2 - abs(pz - oz)
                    if pushX < pushZ { px += (px >= ox ? 1 : -1) * (pushX + r) }
                    else { pz += (pz >= oz ? 1 : -1) * (pushZ + r) }
                } else {
                    // measure the step right at the contact edge, so a walker part-way
                    // up a ramp isn't blocked by the level the ramp leads onto
                    let d = sqrt(d2)
                    let hEdge = groundHeightAt(nx + dx / d * 0.5, nz + dz / d * 0.5)
                    if h <= max(y, hEdge) + STEP { continue }
                    px += dx / d * (r - d)
                    pz += dz / d * (r - d)
                }
            }
        }
    }
}

/* ============================================================
   World meshes — ports createWorld() from world.js onto SceneKit
============================================================ */

private let TEX_SCALE = 20.0  // world units per texture repeat

private func makeGroundImage() -> UIImage {
    let size = 512
    UIGraphicsBeginImageContextWithOptions(CGSize(width: size, height: size), true, 1)
    defer { UIGraphicsEndImageContext() }
    let g = UIGraphicsGetCurrentContext()!
    g.setFillColor(UIColor(rgb: 0x6e6c5c).cgColor)
    g.fill(CGRect(x: 0, y: 0, width: size, height: size))
    let tile = 128
    for ty in 0..<4 {
        for tx in 0..<4 {
            let l = 96 + Int(rand01() * 40)
            g.setFillColor(UIColor(red: CGFloat(l + 12) / 255, green: CGFloat(l + 8) / 255, blue: CGFloat(l - 10) / 255, alpha: 1).cgColor)
            let rect = CGRect(x: tx * tile + 2, y: ty * tile + 2, width: tile - 4, height: tile - 4)
            g.fill(rect)
            g.setStrokeColor(UIColor(red: 30 / 255, green: 28 / 255, blue: 20 / 255, alpha: 0.55).cgColor)
            g.setLineWidth(3)
            g.stroke(rect)
            // grime blotches
            for _ in 0..<5 {
                g.setFillColor(UIColor(red: 40 / 255, green: 38 / 255, blue: 25 / 255, alpha: rand01() * 0.18).cgColor)
                let cx = Double(tx * tile) + rand01() * Double(tile)
                let cy = Double(ty * tile) + rand01() * Double(tile)
                let rr = 6 + rand01() * 20
                g.fillEllipse(in: CGRect(x: cx - rr, y: cy - rr, width: rr * 2, height: rr * 2))
            }
        }
    }
    return UIGraphicsGetImageFromCurrentImageContext()!
}

/* Wall skin — the compounds and cover blocks are most of what a player looks
   at from ground level, and a flat colour reads as untextured plastic.
   Mirrors makeWallTexture() in game/world/world.js. */
private let WALL_TEX_SCALE = 16.0

private func makeWallImage() -> UIImage {
    let size = 256
    UIGraphicsBeginImageContextWithOptions(CGSize(width: size, height: size), true, 1)
    defer { UIGraphicsEndImageContext() }
    let g = UIGraphicsGetCurrentContext()!
    g.setFillColor(UIColor(rgb: 0x47535f).cgColor)
    g.fill(CGRect(x: 0, y: 0, width: size, height: size))
    // stacked panels with a highlight on top and a shadow underneath
    for y in stride(from: 0, to: size, by: 64) {
        for x in stride(from: 0, to: size, by: 128) {
            let l = 8 - Int(rand01() * 16)
            g.setFillColor(UIColor(red: CGFloat(71 + l) / 255, green: CGFloat(83 + l) / 255,
                                   blue: CGFloat(95 + l) / 255, alpha: 1).cgColor)
            g.fill(CGRect(x: x + 2, y: y + 2, width: 124, height: 60))
            g.setFillColor(UIColor(white: 1, alpha: 0.07).cgColor)
            g.fill(CGRect(x: x + 2, y: y + 2, width: 124, height: 3))
            g.setFillColor(UIColor(white: 0, alpha: 0.35).cgColor)
            g.fill(CGRect(x: x + 2, y: y + 57, width: 124, height: 5))
        }
    }
    g.setFillColor(UIColor(white: 0, alpha: 0.28).cgColor)   // seams
    for y in stride(from: 0, to: size, by: 64) { g.fill(CGRect(x: 0, y: y, width: size, height: 2)) }
    for x in stride(from: 0, to: size, by: 128) { g.fill(CGRect(x: x, y: 0, width: 2, height: size)) }
    g.setFillColor(UIColor(red: 220 / 255, green: 232 / 255, blue: 245 / 255, alpha: 0.10).cgColor)
    for y in stride(from: 12, to: size, by: 64) {           // rivets
        for x in stride(from: 10, to: size, by: 24) {
            g.fill(CGRect(x: x, y: y, width: 2, height: 2))
        }
    }
    return UIGraphicsGetImageFromCurrentImageContext()!
}

/* the gradient the district sits under — dusk by day, and the night sky fog
   of war brings down (the look's four stops, zenith → ground haze; the fog
   takes the horizon one so distant terrain melts into it). scene.js builds
   the same two on the web. */
func makeSkyImage(_ stops: [Int]) -> UIImage {
    let w = 4, h = 256
    UIGraphicsBeginImageContextWithOptions(CGSize(width: w, height: h), true, 1)
    defer { UIGraphicsEndImageContext() }
    let g = UIGraphicsGetCurrentContext()!
    let colors = stops.map { UIColor(rgb: $0).cgColor }
    let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                          colors: colors as CFArray, locations: [0, 0.55, 0.82, 1])!
    g.drawLinearGradient(grad, start: .zero, end: CGPoint(x: 0, y: h), options: [])
    return UIGraphicsGetImageFromCurrentImageContext()!
}

private func pbrMaterial(color: Int, roughness: Double, metalness: Double = 0) -> SCNMaterial {
    let m = SCNMaterial()
    m.lightingModel = .physicallyBased
    m.diffuse.contents = UIColor(rgb: color)
    m.roughness.contents = roughness
    m.metalness.contents = metalness
    return m
}

private struct TileRect { var r, c, w, d: Int }

/* merge same-height tile runs into as few boxes as possible */
private func greedyRects(level: Level, match: (Cell) -> Bool) -> [TileRect] {
    var used = Array(repeating: Array(repeating: false, count: level.cols), count: level.rows)
    var rects: [TileRect] = []
    for r in 0..<level.rows {
        for c in 0..<level.cols {
            if used[r][c] || !match(level.cells[r][c]) { continue }
            var w = 1
            while c + w < level.cols && !used[r][c + w] && match(level.cells[r][c + w]) { w += 1 }
            var d = 1
            outer: while r + d < level.rows {
                for i in 0..<w where used[r + d][c + i] || !match(level.cells[r + d][c + i]) { break outer }
                d += 1
            }
            for rr in r..<(r + d) { for i in 0..<w { used[rr][c + i] = true } }
            rects.append(TileRect(r: r, c: c, w: w, d: d))
        }
    }
    return rects
}

/* box with the top face tilted into a ramp wedge (h0 → h1 along one axis) */
private func makeWedgeGeometry(axisX: Bool, h0: Double, h1: Double, bottom: Double) -> SCNGeometry {
    let s = TILE / 2
    func topY(_ x: Double, _ z: Double) -> Double {
        let f = (axisX ? x : z) / TILE + 0.5
        return h0 + (h1 - h0) * f
    }
    // 8 corners, counterclockwise looking down: (-,-) (+,-) (+,+) (-,+) in x/z
    let cx: [Double] = [-s, s, s, -s]
    let cz: [Double] = [-s, -s, s, s]
    let top = (0..<4).map { SCNVector3(cx[$0], topY(cx[$0], cz[$0]), cz[$0]) }
    let bot = (0..<4).map { SCNVector3(cx[$0], bottom, cz[$0]) }

    var verts: [SCNVector3] = []
    var norms: [SCNVector3] = []
    var indices: [Int32] = []

    func quad(_ a: SCNVector3, _ b: SCNVector3, _ c: SCNVector3, _ d: SCNVector3) {
        // normal from the first triangle (a,b,c)
        let u = SCNVector3(b.x - a.x, b.y - a.y, b.z - a.z)
        let v = SCNVector3(c.x - a.x, c.y - a.y, c.z - a.z)
        var n = SCNVector3(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x)
        let len = max(1e-6, sqrt(Double(n.x * n.x + n.y * n.y + n.z * n.z)))
        n = SCNVector3(Double(n.x) / len, Double(n.y) / len, Double(n.z) / len)
        let base = Int32(verts.count)
        verts.append(contentsOf: [a, b, c, d])
        norms.append(contentsOf: [n, n, n, n])
        indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
    }

    quad(top[0], top[3], top[2], top[1])   // top (wound to face up)
    quad(bot[0], bot[1], bot[2], bot[3])   // bottom (faces down)
    quad(top[0], top[1], bot[1], bot[0])   // -z side
    quad(top[2], top[3], bot[3], bot[2])   // +z side
    quad(top[1], top[2], bot[2], bot[1])   // +x side
    quad(top[3], top[0], bot[0], bot[3])   // -x side

    let geo = SCNGeometry(
        sources: [SCNGeometrySource(vertices: verts), SCNGeometrySource(normals: norms)],
        elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)]
    )
    return geo
}

/* builds every terrain node into `parent`; returns nothing — physics reads
   the Level grid, never these meshes */
func buildWorld(level: Level, parent: SCNNode) {
    let groundImage = makeGroundImage()

    func groundMaterial(repeatX: Double, repeatY: Double, offsetX: Double = 0, offsetY: Double = 0) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = groundImage
        m.diffuse.wrapS = .repeat
        m.diffuse.wrapT = .repeat
        m.diffuse.contentsTransform = SCNMatrix4Translate(
            SCNMatrix4MakeScale(Float(repeatX), Float(repeatY), 1), Float(offsetX), Float(offsetY), 0)
        m.roughness.contents = 0.95
        m.metalness.contents = 0
        return m
    }

    let sideMat = pbrMaterial(color: 0x5b5648, roughness: 0.9)
    let rampMat = pbrMaterial(color: 0x6b6555, roughness: 0.9)
    let wallImage = makeWallImage()

    /* There is no ground plane under the district and no margin framing it: the
       lowest tier is merged tile boxes like every other tier, so the map ends
       exactly where its last tile does. A plane spilling past the border would
       be ground you fall through, now that walking off the edge is a fall
       (groundHeightAt), and the holes on a "v" map have to stay holes. */

    func addBox(_ rect: TileRect, top: Double, texturedTop: Bool, mat: SCNMaterial,
                faceMats: [SCNMaterial]? = nil) {
        let w = Double(rect.w) * TILE, d = Double(rect.d) * TILE
        let bottom = LOW - 2
        let mx = -level.arenaHW + Double(rect.c) * TILE + w / 2
        let mz = -level.arenaHD + Double(rect.r) * TILE + d / 2
        let box = SCNBox(width: w, height: top - bottom, length: d, chamferRadius: 0)
        if let faceMats {
            box.materials = faceMats
        } else if texturedTop {
            // world-aligned repeats on the +y face so the ground texture doesn't stretch
            let topMat = groundMaterial(
                repeatX: w / TEX_SCALE, repeatY: d / TEX_SCALE,
                offsetX: (mx - w / 2) / TEX_SCALE, offsetY: (mz - d / 2) / TEX_SCALE)
            // SCNBox material order: +z, +x, -z, -x, top, bottom
            box.materials = [mat, mat, mat, mat, topMat, mat]
        } else {
            box.materials = [mat]
        }
        let node = SCNNode(geometry: box)
        node.position = SCNVector3(mx, (top + bottom) / 2, mz)
        node.castsShadow = true
        parent.addChildNode(node)
    }

    // flat terrain, one merged box set per height tier — the lowest one included
    var heights = Set<Double>()
    for row in level.cells {
        for cell in row {
            if case .flat(let h) = cell { heights.insert(h) }
        }
    }
    for h in heights {
        for rect in greedyRects(level: level, match: { if case .flat(let hh) = $0 { return hh == h } else { return false } }) {
            addBox(rect, top: h, texturedTop: true, mat: sideMat)
        }
    }
    for rect in greedyRects(level: level, match: { if case .wall = $0 { return true } else { return false } }) {
        // Per-face materials so the panel texture tiles in world units on a
        // merged rect of any size: SCNBox order is +z, +x, -z, -x, top, bottom,
        // and the two side pairs span different axes.
        let w = Double(rect.w) * TILE, d = Double(rect.d) * TILE
        let h = WALL_H - (LOW - 2)
        func wallFace(_ su: Double, _ sv: Double) -> SCNMaterial {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = wallImage
            m.diffuse.wrapS = .repeat
            m.diffuse.wrapT = .repeat
            m.diffuse.contentsTransform = SCNMatrix4MakeScale(Float(su), Float(sv), 1)
            m.roughness.contents = 0.85
            m.metalness.contents = 0.1
            return m
        }
        let zFace = wallFace(w / WALL_TEX_SCALE, h / WALL_TEX_SCALE)
        let xFace = wallFace(d / WALL_TEX_SCALE, h / WALL_TEX_SCALE)
        let capFace = wallFace(w / WALL_TEX_SCALE, d / WALL_TEX_SCALE)
        addBox(rect, top: WALL_H, texturedTop: false, mat: zFace,
               faceMats: [zFace, xFace, zFace, xFace, capFace, capFace])
    }

    // ramps: wedge boxes
    for r in 0..<level.rows {
        for c in 0..<level.cols {
            guard case .ramp(let axisX, let h0, let h1) = level.cells[r][c] else { continue }
            let geo = makeWedgeGeometry(axisX: axisX, h0: h0, h1: h1, bottom: LOW - 2)
            geo.materials = [rampMat]
            let node = SCNNode(geometry: geo)
            node.position = SCNVector3(
                -level.arenaHW + (Double(c) + 0.5) * TILE, 0,
                -level.arenaHD + (Double(r) + 0.5) * TILE)
            node.castsShadow = true
            parent.addChildNode(node)
        }
    }
}
