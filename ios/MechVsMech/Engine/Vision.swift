import Foundation
import SceneKit

/* ============================================================
   Fog of war — an optional, purely local view restriction.
   Ports systems/vision.js.

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are drawn only as
   far as the sensors reach them.

   Contact is a *strength*, never a flag — that is the whole
   design, and what an earlier boolean version got wrong. A
   yes/no verdict from one ray to one point flips the moment the
   ray clips a corner, so a mech edging round cover strobed, and
   one at the rim of the sensor circle blinked with every step.
   Instead `e.contact` is 0…1:

   - five rays per target (three up its body, two straddling it
     at shoulder width) — half a mech behind a wall reads half
     seen and sits there steadily instead of flickering;
   - the outer FALLOFF units of the sensor circle are a fade
     rather than a cliff;
   - contact is faded into `e.fade` fast (FADE_IN) and out slowly
     (FADE_OUT) after a HOLD of sensor lock, so a target that
     ducks behind a pillar for a moment never disappears at all.
     Fast in / slow out is also what hides the fact that the
     sweep only runs every TICK seconds.

   (The web build keeps one more thing off the same sweep — a
   lost contact's last position, which its minimap remembers for
   a few seconds. This build has no minimap, so it has no mark.)

   And a shot fired from somewhere I cannot see is not drawn
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
private let FALLOFF = 22.0                       // the outer band of that circle, faded not cut
private let FOG = (near: 26.0, far: 96.0)        // render fog while fog of war is on
private let CLEAR = (near: 90.0, far: 280.0)     // the normal in-game fog
private let TICK = 0.08                          // seconds between line-of-sight sweeps
private let FADE_IN = 0.12                       // seconds a contact takes to materialise
private let FADE_OUT = 0.5                       // …and to dissolve once it is really gone
private let HOLD = 0.4                           // sensor lock: contact is kept this long after it breaks

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
       verdict rather than casting another ray (AI.swift, at every fire point).
       `seen` is "drawn at all", not "drawn solidly" — a mech I can make out as
       a silhouette must be allowed to flash, or it would fire invisibly. It
       starts true, so nothing is gated before the first sweep. */
    func hiddenShooter(_ e: Entity) -> Bool {
        fogOfWar && !e.seen
    }

    /* ---------- how much of a target the sensors have ----------
       Five rays: up the body (a mech behind a low wall is seen head-first) and
       out to either side of it (a mech edging round a corner is seen shoulder
       first). The fraction that get through, scaled by how far into the sensor
       circle it is — both are what make contact a strength rather than a flip. */
    private func contactOf(_ e: Entity, _ px: Double, _ py: Double, _ pz: Double) -> Double {
        let dx = e.x - px, dz = e.z - pz
        let d2 = dx * dx + dz * dz
        if d2 > VISION_R * VISION_R { return 0 }
        let d = d2.squareRoot()
        let range = min(1, (VISION_R - d) / FALLOFF)
        // perpendicular to the line of sight, so the pair straddles whatever
        // cover is between us rather than lying along it
        let s = d > 0.01 ? e.hitRadius * 0.8 / d : 0
        let ox = -dz * s, oz = dx * s
        let mid = aimY(e)
        func clear(_ x: Double, _ y: Double, _ z: Double) -> Double {
            losBlocked(px, py, pz, x, y, z) ? 0 : 1
        }
        let hits = clear(e.x, mid, e.z)                          // torso
            + clear(e.x, e.y + e.hitHeight * 0.9, e.z)           // head
            + clear(e.x, e.y + e.hitHeight * 0.25, e.z)          // legs
            + clear(e.x + ox, mid, e.z + oz)                     // one shoulder
            + clear(e.x - ox, mid, e.z - oz)                     // the other
        return range * hits / 5
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
                    e.contact = 1
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
                if e.team == player.team || e.kind == .base { e.contact = 1; continue }
                e.contact = e.alive ? contactOf(e, player.x, player.y + 5, player.z) : 0
            }
        }

        /* the fade: every frame, so contact reads as smooth however coarse the
           sweep above is. Rising is quick, falling waits out the sensor lock
           and then takes its time — a target is never lost between two frames. */
        for e in entities {
            // created since the last sweep, so it has no verdict yet: teammates
            // and landmarks are never hidden, an enemy is out of contact until
            // the sweep says otherwise — either way it settles without flashing
            if e.contact < 0 { e.contact = e.team == player.team || e.kind == .base ? 1 : 0 }
            if e.fade < 0 { e.fade = e.contact }     // first frame for it: snap, don't fade
            else if e.fade < e.contact {
                e.fade = min(e.contact, e.fade + dt / FADE_IN)
                e.hold = HOLD
            } else if e.fade > e.contact {
                e.hold -= dt
                if e.hold <= 0 { e.fade = max(e.contact, e.fade - dt / FADE_OUT) }
            } else { e.hold = HOLD }
            // "drawn at all" — what the muzzle-flash gate asks about
            e.seen = e.fade > 0.02
            applyFade(e, e.fade)
        }
    }
}
