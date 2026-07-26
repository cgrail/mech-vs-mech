# Todo

[x] get rid of setting url parameters in the web app. keep all the state in browser only. refreshing the browser should start from the entry - always. document this also in claude.md
    → game/core/boot.js: a one-shot sessionStorage handoff carries what a
      reload needs, the map is remembered in localStorage, and ?level=/?mp=
      are stripped out of the address bar at boot
[x] when fog of war is active you sometimes see enemies shoot, but you don't see the enemy if he's around the corner and they appear in a weird way. it's not a smooth appearance.
    → contact fades in/out instead of switching, and a shot fired from cover
      is not drawn (no muzzle flash, tracer appears once it clears the corner)
[x] menus break for smaller screens. do not put more than 2-3 small elements in a row. make the screens taller instead of wider. document this also in claude.md also make the menu elements same size that it feels more natural and enable menu keyboard navigation. menus should look like from 90s game. use vertical menus or menu layout
    → one vertical column of same-sized rows on both builds (game/ui/menu.js,
      UI/Styles.swift OptionRow): every setting cycles through ◂ ▸ instead of
      a button per value, squared-off 90s skin, and ↑↓ ←→ Enter drive it
[ ] on multiplayer, start next game when one games is finished after 10 seconds to keep the momentum going. continue with the next level
[ ] on multiplayer, when only one room is available and there is enough capacity, directly enter that room. make it smoother