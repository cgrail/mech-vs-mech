# Todo

[x] add settings menu - allow changing keybindings like movement, jumping, shooting, building turrects etc
[x] fog of war doesn't feel good. even with fading in, enemies show up and hide to unpredictable. maybe use light instead, so something like a flashlight mode
    (fixed the unpredictable part: contact is now a strength, not a yes/no —
     five rays per target, a faded sensor rim, fast-in/slow-out with a hold,
     and a lingering last-known blip on the minimap. The literal flashlight is
     the line below, because it is a look decision, not a bug)
[ ] fog of war, the light version: actually darken the district and mount a
    sensor lamp on the mech, instead of only fading contacts. Needs the light
    rig AND the tone mapping retuned together on both builds (see CLAUDE.md,
    "The look is tone-mapped, not lit brighter") — worth it?
[x] if fog of war is enabled for single player mode, it is also enabled for multi player mode which is not configurable. make it also an option in multi player
[x] in capture the flag you should not win by destroying the enemy base. you can do it, but you won't win
[x] on mobile you can't run. if you pull the joystick hard forward, then the bot should run.
