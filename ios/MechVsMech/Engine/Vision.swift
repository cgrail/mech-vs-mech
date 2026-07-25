import Foundation
import SceneKit

/* ============================================================
   Fog of war — an optional, purely local view restriction.
   Ports systems/vision.js.

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are only drawn
   while they are inside VISION_R *and* in line of sight — step
   behind a wall and they are gone.

   Bases and everything on my own team are always visible: they
   are landmarks and teammates, not intel. Nothing here is sent
   over the wire — it can only ever hide things from the player
   who switched it on, so it is safe in multiplayer too.
============================================================ */

let VISION_R = 78.0                              // how far the mech's sensors see
private let FOG = (near: 26.0, far: 96.0)        // render fog while fog of war is on
private let CLEAR = (near: 90.0, far: 280.0)     // the normal in-game fog

extension GameEngine {

    /* the play fog for the current setting — called when a match starts and
       whenever the option is toggled mid-game */
    func applyFog() {
        let f = fogOfWar ? FOG : CLEAR
        scene.fogStartDistance = f.near
        scene.fogEndDistance = f.far
    }

    func updateVision(dt: Double) {
        if !fogOfWar {
            if visionHiding {   // just switched off: put the whole district back
                visionHiding = false
                for e in entities {
                    e.seen = true
                    e.node.isHidden = false
                }
            }
            return
        }
        visionHiding = true
        visionAcc -= dt
        if visionAcc > 0 { return }
        visionAcc = 0.12   // a few frames' worth: LOS sampling is the expensive part
        let eye = player.y + 5
        for e in entities {
            if e.team == player.team || e.kind == .base {
                e.seen = true
                e.node.isHidden = false
                continue
            }
            e.seen = e.alive && distXZ(player.x, player.z, e.x, e.z) <= VISION_R
                && !losBlocked(player.x, eye, player.z, e.x, aimY(e), e.z)
            e.node.isHidden = !e.seen
        }
    }
}
