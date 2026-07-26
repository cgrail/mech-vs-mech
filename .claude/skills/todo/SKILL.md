---
name: todo
description: Work the next item(s) off todo.md in this repo — one item at a time, web and iOS in lockstep, one commit per finished item. Use when asked to "work on the todos", "do the next todo", "keep going through todo.md", or when handed a todo item by name.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

## The list

!`cat todo.md`

`todo.md` at the repo root is the backlog. `[ ]` is open, `[x]` is done — done items stay in the file as a record, they are not deleted.

Arguments, if any, name which item(s) to take (a number, a keyword, "all"). With no arguments: take the **topmost `[ ]` item** and keep going down the list until the context/usage limit stops you.

## One item = one commit

Do **not** batch items. For each item, in order:

1. **Read the item as a bug report, not a spec.** Most entries are one line of the user's shorthand ("feet still move when standing still"). Find the actual code before deciding what the fix is — the described symptom is usually a small piece of a shared code path.
2. **Locate both sides.** Every gameplay/UI change lands twice: the JS module under `game/` and its Swift counterpart under `ios/MechVsMech/` (`ios/README.md` has the file-by-file map). Same commit, or the two builds disagree mid-match. If an item is genuinely web-only (map editor) or iOS-only, say so in the commit body.
3. **Implement.** Match the surrounding code's idiom on each side — the Swift is a port, not a transliteration; read the neighbouring Swift before writing any.
4. **Check the constraints in CLAUDE.md** that the change touches. The ones that bite most often:
   - relay message shapes and the per-player ownership model must change on both sides together;
   - PvP stays symmetric — anything difficulty-scaled is `!MP.active` only;
   - menus are one scrolling column of cards, three controls per row max, one green action per screen;
   - nothing writes a URL parameter — reload state goes through the `mechBoot` handoff;
   - `window.__mech` stays exposed in `game/main.js`.
5. **Verify what can be verified from here.**
   ```bash
   node --input-type=module --check < game/<changed>.js   # per changed module
   npm run check-levels                                   # if any level changed
   cp levels/levels.txt ios/MechVsMech/Resources/levels.txt   # if any level changed
   ```
   **Never** launch Chrome or a headless browser, and never try to build the Xcode project — the user does all in-browser and on-device testing. Xcode project membership: new Swift files must be added to `ios/MechVsMech.xcodeproj/project.pbxproj`, so prefer extending an existing file over adding one.
6. **Docs, only if something significant changed.** A new subsystem, a changed invariant, a new message type, a rule a future edit could break → the matching section of [CLAUDE.md](../../../CLAUDE.md). A player-visible feature, control or option → [README.md](../../../README.md). A bug fix that changes no rule → neither.
7. **Tick the item** in `todo.md`: `[ ]` → `[x]`. If the work revealed a follow-up the user should decide on, append it as a new `[ ]` line rather than doing it silently.
8. **Commit everything for that item together** — code (web + iOS), `todo.md`, docs. Message style is the repo's: imperative subject, no scope prefix, ~60 chars ("Handle dead-end rematch when opponents disconnect"). Body only when the *why* isn't obvious from the subject. Do not push.

## Reporting

After each commit, tell the user in two or three lines: what the item turned out to be, what changed on each side, and **what to verify manually** (the browser and device steps you could not run). Then start the next item without asking — stop only when the list is empty, an item genuinely needs a decision only the user can make, or you run out of room.
