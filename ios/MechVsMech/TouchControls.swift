import UIKit
import CoreMotion

/* ============================================================
   Touch + gyro controls — ports systems/mobile.js

   joystick — left half: floating joystick, up/down moves,
              left/right strafes; right half: drag to turn,
              hold to fire machine guns
   gyro     — compass rotates the mech 1:1 (physically turn
              around to look behind you — by design, no gain),
              lean forward/back moves, side tilt strafes,
              any touch fires

   On-screen buttons (SwiftUI, HUDView) fire rockets / place
   turrets in both schemes.
============================================================ */

private let JOY_R: CGFloat = 48   // knob travel radius in pt
private let DEAD = 0.25           // normalized joystick deadzone

final class TouchControlView: UIView {

    weak var engine: GameEngine?
    var scheme: () -> ControlScheme = { .joystick }

    private let joyBase = UIView()
    private let joyKnob = UIView()
    private var joyTouch: UITouch?
    private var joyCenter = CGPoint.zero
    private var moveActive = false      // hysteresis latch for the fwd/back axis
    private var strafeActive = false    // hysteresis latch for the strafe axis
    private var lookTouch: UITouch?
    private var lookX: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .clear

        joyBase.bounds = CGRect(x: 0, y: 0, width: 110, height: 110)
        joyBase.layer.cornerRadius = 55
        joyBase.layer.borderWidth = 2
        joyBase.layer.borderColor = UIColor(white: 1, alpha: 0.35).cgColor
        joyBase.backgroundColor = UIColor(white: 1, alpha: 0.06)
        joyBase.isUserInteractionEnabled = false
        joyBase.isHidden = true
        addSubview(joyBase)

        joyKnob.bounds = CGRect(x: 0, y: 0, width: 44, height: 44)
        joyKnob.layer.cornerRadius = 22
        joyKnob.backgroundColor = UIColor(white: 1, alpha: 0.4)
        joyKnob.isUserInteractionEnabled = false
        joyBase.addSubview(joyKnob)
        joyKnob.center = CGPoint(x: 55, y: 55)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private var input: TouchInput? { engine?.touch }
    private var playing: Bool { engine?.phase == .playing }

    /* one joystick axis with a hysteresis deadzone: must cross DEAD to engage,
       then fall below half of DEAD to release — so hovering at the edge can't
       flicker the walk animation on and off */
    private func joyAxis(_ v: Double, active: inout Bool) -> Double {
        let a = abs(v)
        if active { if a < DEAD * 0.5 { active = false } }
        else if a > DEAD { active = true }
        return active ? v : 0
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard playing else { return }
        for t in touches {
            let p = t.location(in: self)
            if scheme() == .joystick && joyTouch == nil && p.x < bounds.width * 0.5 {
                // the joystick base appears wherever the left thumb lands
                joyTouch = t
                joyCenter = p
                moveActive = false
                strafeActive = false
                joyBase.center = p
                joyBase.isHidden = false
                joyKnob.center = CGPoint(x: 55, y: 55)
            } else if lookTouch == nil {
                lookTouch = t
                lookX = p.x
                input?.firing = true
            }
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for t in touches {
            let p = t.location(in: self)
            if t === joyTouch {
                var dx = p.x - joyCenter.x, dy = p.y - joyCenter.y
                let d = sqrt(dx * dx + dy * dy)
                if d > JOY_R {
                    dx *= JOY_R / d
                    dy *= JOY_R / d
                }
                joyKnob.center = CGPoint(x: 55 + dx, y: 55 + dy)
                let nx = Double(dx / JOY_R), ny = Double(dy / JOY_R)
                // hysteresis deadzone: a thumb resting near the DEAD edge would
                // otherwise flip move on/off every few frames (finger tremor
                // crossing a single threshold) → feet "dribble" while standing
                input?.strafe = joyAxis(nx, active: &strafeActive)
                input?.move = -joyAxis(ny, active: &moveActive)
            } else if t === lookTouch && scheme() == .joystick {
                if playing { input?.addLookDX(Double(p.x - lookX)) }
                lookX = p.x
            }
        }
    }

    private func endTouches(_ touches: Set<UITouch>) {
        for t in touches {
            if t === joyTouch {
                joyTouch = nil
                moveActive = false
                strafeActive = false
                input?.move = 0
                input?.strafe = 0
                joyBase.isHidden = true
            } else if t === lookTouch {
                lookTouch = nil
                input?.firing = false
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { endTouches(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { endTouches(touches) }
}

/* ============================================================
   Gyro scheme — CoreMotion stand-in for deviceorientation.
   The pose when the match starts becomes "facing forward,
   standing still" (same calibration as the web version).
============================================================ */
final class GyroController {

    private let motion = CMMotionManager()
    private var needCalibration = true
    private var baseAttYaw = 0.0
    private var baseLean = 0.0
    private var baseTilt = 0.0
    private var baseGameYaw = 0.0
    private weak var engine: GameEngine?

    private let LEAN_DEADZONE = 7.0    // degrees of forward/back lean before the mech moves
    private let STRAFE_DEADZONE = 9.0  // degrees of side tilt before the mech strafes

    func start(engine: GameEngine) {
        self.engine = engine
        needCalibration = true
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1 / 60
        motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] dm, _ in
            guard let self, let dm, let engine = self.engine, engine.phase == .playing else { return }
            let g = dm.gravity
            // lean: how far the screen is tipped back from vertical (top edge
            // away from you = screen faces up = larger angle = move forward)
            let lean = atan2(-g.z, sqrt(g.x * g.x + g.y * g.y)) * 180 / .pi
            // side tilt: rotation about the screen normal
            let tilt = atan2(g.y, g.x) * 180 / .pi

            if self.needCalibration {
                self.baseAttYaw = dm.attitude.yaw
                self.baseLean = lean
                self.baseTilt = tilt
                self.baseGameYaw = engine.player.yaw
                self.needCalibration = false
            }

            // compass: rotation about the vertical axis, 1:1 with the mech's yaw
            var dYaw = dm.attitude.yaw - self.baseAttYaw
            if dYaw > .pi { dYaw -= 2 * .pi } else if dYaw < -.pi { dYaw += 2 * .pi }
            engine.touch.yaw = self.baseGameYaw + dYaw

            let dLean = lean - self.baseLean
            engine.touch.move = dLean > self.LEAN_DEADZONE ? 1 : dLean < -self.LEAN_DEADZONE ? -1 : 0

            var dTilt = tilt - self.baseTilt
            if dTilt > 180 { dTilt -= 360 } else if dTilt < -180 { dTilt += 360 }
            engine.touch.strafe = dTilt > self.STRAFE_DEADZONE ? 1 : dTilt < -self.STRAFE_DEADZONE ? -1 : 0
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        engine?.touch.yaw = nil
        engine?.touch.move = 0
        engine?.touch.strafe = 0
    }
}
