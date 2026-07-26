# Todo

[x] walking animation sometimes hangs. if i stand still, feet still move. only animate if i'm really moving
[x] strafe left/right should use an animation where the feet strafe left or right. currently they move forward
[x] if i'm going on ios from start menu to single player, the screen and background animation freezes. maybe offload displaying the mini map into an own thread and show the screen before displaying all details instead of freezing
[x] if the name is already taken for multiplayer, just append some number or suffix and continue. 
[x] in pilot callsign screen, offer the enter lobby button also after the name instead of only at the bottom
[ ] allow selecting the map editor levels also in multi player
    (not started — an editor map lives in one browser, so the level TEXT has to
     reach the server and from there every other client. Needs: setLevel to
     carry the text, the server to validate + store it under a minted param and
     serve it from /level/<param>, a bigger ws maxPayload than 4 KB (a 64x64 map
     is ~4.2 KB), and both clients to load a map by param they don't have —
     world.js currently 404s on levels/<name>.txt, and the lobby preview and
     thumbnails resolve out of the local bundle too)
[x] on web, use same level select list as in single player. it should behave the same
[x] in multi player. auto deploy if match is started and every client is ready
[x] the stand still animation is still shaky. see video: /Users/christian/Desktop/Screen Recording 2026-07-26 at 18.55.32.mov