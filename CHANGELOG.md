# Changelog

Everything notable that lands in MECH VS MECH, web and iOS in one list — the
two builds are one product and ship the same gameplay ([CLAUDE.md](CLAUDE.md)),
so a change that only reached one of them is a bug, not an entry.

The version is the iOS `MARKETING_VERSION` in
[ios/MechVsMech.xcodeproj](ios/MechVsMech.xcodeproj); the web build has no
version of its own and rides whatever the top section says.
[ios/WHATS-NEW.md](ios/WHATS-NEW.md) is the player-facing cut of the same list,
written for the App Store at release time — this file is the developer's record
and is written as the work happens.

## 1.2 — current

### Movement

- **Jump jets clear a wall.** The pilot's impulse peaks at 11.56 units, over
  `WALL_H`, so cover blocks and compound walls are perches and a base fort can
  be entered over the top as well as through its gate. Enemy mechs keep the old
  4.84-unit hop (`MECH_JUMP_V`), so the compounds stay sealed against the AI.
- **The map border is an edge, not a fence.** Nothing clamps a walker to the
  arena any more and everything past the last tile reads as void, so you can
  walk out of the district and fall to your death exactly as you would into a
  chasm. The ground plane and the margin that framed it went with it — every
  map's lowest tier is merged tile boxes now, so the district ends where its
  last tile does. The AI keeps itself on the map: its probes already treat a
  hole under any part of a mech as a wall.
- Jump jets, full stop: the ⬆ button / Ctrl lifts a mech a terrain tier, so
  high ground is reachable anywhere and a pit stopped being a one-way trap.
- Run by pushing the stick to its rim (Shift on a keyboard).
- Damage costs speed — down to 65% of full at zero hull and back up with the
  self-repair, one rule for every pilot and never difficulty-scaled.
- The walk animation is driven by ground actually covered rather than by input,
  so a mech pinned against a wall stands still, and legs shuffle sideways when
  it strafes instead of marching on the spot.
- A turret is built beside the pilot instead of across their path.

### Night mode

- The district is fought at night by default: a `night` look, a sensor lamp on
  the mech, and enemy mechs and turrets drawn only where the sensors reach.
- Contact is a strength, not a flag — half a mech behind a wall is half a
  silhouette, and one that ducks behind a pillar fades rather than popping.
- The lamp browns out and narrows as the mech takes damage, and recovers with
  the self-repair. Turrets you build carry lamps from a fixed pool; enemy
  turrets get none.
- DAY MODE is one row in the mission menu; in multiplayer the room's creator
  picks the weather for everybody.

### Capture the flag

- A second mode beside base assault: steal the flag from the enemy courtyard,
  carry it to your own stand, three captures take the district.
- Dying drops the flag, touching your own dropped flag returns it, and an
  untouched drop goes home after 25 s.
- Flags are the only win condition in the mode — levelling a base only cuts off
  that side's waves.

### Multiplayer

- Phones and browsers share one lobby and one match.
- The room's creator picks the district, the mode and the weather, and the map
  text comes from the server, so a room can never split across two maps.
- The map picker is the level select's own list, map pictures and all.
- A lobby holding exactly one room with space in it walks you straight into it.
- A callsign already taken is suffixed (`ACE` → `ACE 2`), never refused.
- START MATCH is the only button: every pilot deploys as their match lands.
- The end screen rolls into the next district after ten seconds; NEXT MAP skips
  the wait, BACK TO LOBBY gets out, and a dead-ended match counts down to the
  lobby instead.
- Rolling into a rematch no longer reports you to the other pilots as leaving.

### Districts

- Three new ones, including THE RIFT (a chasm splitting the map, three bridges,
  no floor anywhere else) and the 5v5-sized THE SPRAWL and THE EXPANSE.
- Winning a district drops you straight into the next one.

### Enemy mechs

- They wall-follow instead of grinding, probe with their full width so a
  shoulder no longer clips a corner, and jump ledges to reach you.
- A mech that can see you keeps its guns on you while it side-steps.

### Look and menus

- Filmic tone mapping and bloom, a gradient sky the distance fog takes its
  colour from, panelled walls, muzzle flashes on every gun, a cockpit vignette.
- Menus rebuilt as one column of titled cards over the orbiting district, with
  a picture of every map drawn from the map text itself; the same layout fits
  an iPhone SE and a Pro Max.
- Every key is rebindable from a settings screen (web).
- Browser zoom is refused on touch devices.
- Entering a match no longer stalls the iOS menu — music, map pictures and the
  long district lists are off the main thread.

### Fixed

- A flag carried by a mech that dies is dropped where it fell.
- A flag dropped over a chasm goes home instead of being lost.

## 1.1 and earlier

No changelog was kept before 1.2 — the git history is the record.
