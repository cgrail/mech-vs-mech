import Foundation
import SceneKit

/* ============================================================
   Fog of war — an optional, purely local view restriction.
   Ports systems/vision.js.

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are only drawn
   while they are inside VISION_R *and* in line of sight — step
   behind a wall and they are gone.

   Two things keep that from reading as a glitch:

   - contact is *faded*, not switched. A mech coming round a
     corner takes FADE seconds to materialise instead of
     appearing between two frames, which also hides the fact
     that the line-of-sight sweep only runs every TICK seconds.
   - a shot fired from somewhere I cannot see is not drawn
     either (`covertShot` / `hiddenShooter`). Muzzle flashes and
     tracers blooming out of thin air used to give away every
     hidden mech the moment it opened fire — the fog hid the
     shooter and then advertised it.

   Bases and everything on my own team are always visible: they
   are landmarks and teammates, not intel. Nothing here is sent
   over the wire — it can only ever hide things from the player
   who switched it on, so it is safe in multiplayer too.
============================================================ */

let VISION_R = 78.0                              // how far the mech's sensors see
private let FOG = (near: 26.0, far: 96.0)        // render fog while fog of war is on
private let CLEAR = (near: 90.0, far: 280.0)     // the normal in-game fog
private let TICK = 0.08                          // seconds between line-of-sight sweeps
private let FADE = 0.15                          // seconds an enemy takes to fade in or out

extension GameEngine {

    /* the play fog for the current setting — called when a match starts and
       whenever the option is toggled mid-game */
    func applyFog() {
        let f = fogOfWar ? FOG : CLEAR
        scene.fogStartDistance = f.near
        scene.fogEndDistance = f.far
    }

    /* ---------- sensor contact with a bare world point ----------
       The eye is the mech's sensor block, the same height the guns check LOS
       from, so what the player can see and what they can shoot agree. */
    func inSight(_ x: Double, _ y: Double, _ z: Double) -> Bool {
        let dx = player.x - x, dz = player.z - z
        return dx * dx + dz * dz <= VISION_R * VISION_R
            && !losBlocked(player.x, player.y + 5, player.z, x, y, z)
    }

    /* An enemy shot spawned where I can't see it: drawn only once it clears
       whatever the shooter is behind (Projectiles.swift keeps re-testing it).
       Team-based rather than shooter-based so a replicated multiplayer shot,
       which arrives without its shooter, is covered by the same rule. */
    func covertShot(_ pos: SIMD3<Double>, _ team: Team) -> Bool {
        fogOfWar && team != player.team && !inSight(pos.x, pos.y, pos.z)
    }

    /* the muzzle flash of an enemy I cannot see. Free: it reads the sweep's own
       verdict rather than casting another ray (AI.swift, at every fire point) */
    func hiddenShooter(_ e: Entity) -> Bool {
        fogOfWar && e.seenKnown && !e.seen
    }

    /* SceneKit's node opacity already cascades through a subtree, so a whole
       mech fades with one assignment — no material walk needed (the web build
       has to set opacity per material, see vision.js). */
    private func applyFade(_ e: Entity, _ v: Double) {
        e.node.opacity = CGFloat(v)
        e.node.isHidden = v <= 0.002
    }

    func updateVision(dt: Double) {
        if !fogOfWar {
            if visionHiding {   // just switched off: put the whole district back
                visionHiding = false
                for e in entities {
                    e.seen = true
                    e.fade = 1
                    applyFade(e, 1)
                }
            }
            return
        }
        visionHiding = true

        /* the sweep: the expensive part, so it runs on its own budget */
        visionAcc -= dt
        if visionAcc <= 0 {
            visionAcc = TICK
            for e in entities {
                e.seenKnown = true
                if e.team == player.team || e.kind == .base { e.seen = true; continue }
                let dx = player.x - e.x, dz = player.z - e.z
                e.seen = e.alive && dx * dx + dz * dz <= VISION_R * VISION_R
                    && !losBlocked(player.x, player.y + 5, player.z, e.x, aimY(e), e.z)
            }
        }

        /* the fade: every frame, so contact reads as smooth however coarse the
           sweep above is */
        for e in entities {
            // created since the last sweep, so it has no verdict yet: teammates
            // and landmarks are never hidden, an enemy is out of contact until
            // the sweep says otherwise — either way it settles without flashing
            if !e.seenKnown { e.seen = e.team == player.team || e.kind == .base }
            let want: Double = e.seen ? 1 : 0
            if e.fade < 0 { e.fade = want }          // first frame for it: snap, don't fade
            else if e.fade != want {
                let step = dt / FADE
                e.fade = want > 0 ? min(1, e.fade + step) : max(0, e.fade - step)
            }
            applyFade(e, e.fade)
        }
    }
}
