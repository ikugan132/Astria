# Account order and extensions implementation plan

**Goal:** Reorder sidebar accounts and install user-provided unpacked Chrome extensions separately in each account, with an Extensions button beside Performance.

**Architecture:** Preserve the global accounts array and persist validated per-workspace permutations. Copy extensions into portable Save/Extensions with a stable manifest key; load them only in the chosen persistent account session. Use Electron's native extension loader, pinned MIT electron-chrome-extensions 4.10.0 for browser APIs and a restricted debugger/side-panel adapter for account pages.

**Constraints:** Existing typography, game shortcuts, profile cookies, floating layouts and running automation must remain intact. No user extension source or Save enters the public repository. No Node or Astria host API in extension pages. Only folder installations with a manifest, never automatic Chrome Store downloads. Use temporary fixture profiles for tests.

- [ ] Validate exact account permutations; add drag/drop plus native Move up/Move down alternatives; test persistence and session identity.
- [ ] Validate and copy extension folders atomically; preserve identity after moving the portable directory; reject traversal, symlinks and oversized packages.
- [ ] Add account-only extension contexts, panels and required APIs. Bound debugger access to the same account and release held input on removal.
- [ ] Add the compact Extensions manager, folder picker, per-account enable/disable/remove/open controls, EN/PT-BR labels and permission information.
- [ ] Test real MV3 content scripts, service workers, panel messaging, storage isolation, debugger input and the user's extension in a simulated page. Check existing layouts/automation, package, verify signed update and publish.

**Compatibility:** Electron provides partial Chrome API support. Native probe of the supplied extension showed missing debugger, commands, windows, sidePanel and notifications; merely loading the manifest does not establish compatibility. Unsupported APIs must report a useful error. The extension's own game-specific behavior still requires user verification in the actual game.
