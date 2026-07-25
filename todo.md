# Todo

[x] fix issues on ios for smaller screens/center everything. make menu classic like
    → OverlayFrame scales every menu to fit; menus restyled after style.css
[x] add jumping functionality. on ios with a button. on web with ctrol
[x] possbility to go up to highest ground. reach the highest
    → the jump clears a 4-unit tier step, so every plateau is reachable and
      no pit is a trap (walls, at 10, still are)
[x] fog of war. option to not see everything. but only a little bit.
    → 🌫️ pill in the menu: tight render fog + enemies only while in sensor
      range and in line of sight (systems/vision.js)
[x] make robot oponents smarter. they are pretty dumb sometimes. they get stuck on walls. robots stop in front of walls instead of following you
    → width-aware probes, committed wall-following, ledge jumps, fire while moving
[x] in multiplayer jump to next level when current level is finished
    → NEXT MAP on the result screen: server mints a follow-up match for the
      same roster on the next map
[x] add  left/right buttons to switch maps. to make it faster to toggle through maps
[x] map editor which allows creating new maps.
    → MAP EDITOR on the mode screen (web): paint tiles, play it, COPY TEXT
      to paste into levels/levels.txt
[ ] evan bigger maps
[ ] capture the flag mode
[ ] nicer graphics
[ ] option to fall off cliff or off level.
