# Astria

[English](README.md) · [Português (Brasil)](README.pt-BR.md)

A compact, portable multi-account browser for **browser games** on Windows. Open the games you choose, keep separate account sessions, arrange their windows and control which pages stay active. No game accounts or game files are included.

## Download

**[Download the latest portable ZIP](https://github.com/ikugan132/Astria/releases/latest)** from Releases. Choose `Astria-Portable-x.y.z.zip`; GitHub's automatic “Source code” archives are for developers, not the runnable app.

1. Extract the ZIP completely to a short, writable path such as `D:\Astria`.
2. Open **Astria.exe** inside the extracted folder.
3. Keep all supporting files and `portable.flag` beside the executable.

Windows x64 is required. You do not need Node.js or an installer. Windows may show SmartScreen or Firewall prompts because the executable does not have a commercial Windows code-signing certificate.

## Update your existing portable folder by copying files

1. Close Astria and back up your existing folder.
2. Extract the new ZIP somewhere else.
3. Copy **all files and folders inside `Astria-Portable-x.y.z`** into your existing Astria folder, replacing the program files. `Astria.exe` must end up beside your existing `Save` folder, not inside another nested folder.
4. **Keep your existing Save folder.** Release ZIPs contain no Save folder, so they do not replace profiles, logins or downloaded saves.
5. Open Astria.exe from your existing folder.

The in-app alternative is **☰ → Check for updates… → Download update → Restart and update**. It verifies the signed package, preserves Save and keeps the previous program in Save/Backups. It never forces a restart while you are playing.

**Upgrading from 1.6.0 or 1.6.1:** their Windows updater can stop after closing Astria. Use the ZIP replacement steps above for this first upgrade. Version 1.6.2 fixes the helper lifecycle for subsequent in-app updates. Your Save folder remains separate from program files.

## Language

Open **☰ → Language → English / Português (Brasil)**. The choice is saved and applies immediately to Astria's interface, menus and dialogs. It does not change the language of websites or games. Fresh installations start in English; existing profiles keep Portuguese until you choose another language.

## Accounts, layouts and activity

- Use **+** to add a workspace or an account. Enter any browser game's HTTP/HTTPS URL and log in inside its page.
- Each Astria account has its own cookies, localStorage, IndexedDB, CacheStorage and service workers.
- Selecting an account or workspace sends keyboard focus to its visible game. You can use its controls without clicking inside the page again; dialogs and game chat fields keep their own focus.
- Game shortcuts, including Ctrl+W, Alt+W, Ctrl+R and F5, reach the focused game with their modifiers intact. Astria does not assign browser close, reload or new-tab shortcuts. Use the toolbar or menus for browser actions and the window's Close button to exit. Windows-reserved shortcuts remain controlled by Windows.
- Right-click an account to rename it, choose a color, control sound/zoom or change its activity.
- Click the speaker beside a panel's RAM/CPU indicator to mute or unmute that account, including its popups. The crossed speaker means muted. Each account remembers its audio setting after restarting.
- Drag the sidebar edge to resize it. Panel headers contain layouts, theme switch and approximate page RAM/CPU usage.

| Mode | Behavior |
| --- | --- |
| Always active / maximum performance | Speedometer icon. Keeps the page loaded and adds no animation FPS cap. Uses more resources. |
| Adaptive Eco | Battery-and-lightning icon. Up to 60 FPS active; secondary budgets adapt to loaded account count. |
| Power saving | Battery-and-lightning icon. Stays loaded across accounts and workspaces and paces animation callbacks to 15 FPS by default. |
| Active when visible | Reduces background activity and unloads a hidden page after five minutes. Showing it reconnects the game. |
| Suspended | Unloads immediately. Resume reopens the same saved profile. |

The battery-and-lightning button selects **Adaptive Eco**: the active account runs at up to 60 FPS; secondary accounts use their power-saving limit up to 15 FPS, capped at 10 FPS with four loaded accounts and 5 FPS with eight. Existing manual Power saving settings remain unchanged. Choose **Activity → Power saving** in the account menu for a fixed limit, then **Power-saving FPS → 1 / 5 / 10 / 15 / 30 FPS**. Both modes keep the same page and connection.

Open the sliders button beside the page cost, or **☰ → Performance → About activity modes**, for:

- **Visual rest:** loaded hidden accounts stay connected at up to 2 FPS and are muted. Their saved audio choice returns when shown. Newly loaded image animations are disabled; Chromium may keep already loaded images animating until reload. Do not reload an active game just to apply this setting.
- **Fixed resolution per account:** Automatic, 720p (1280×720), 768p (1366×768), 900p (1600×900) or 1080p (1920×1080). A virtual viewport at device scale 1 fits the panel without cropping or changing the stored zoom. It may reduce rendering cost when the game sizes its canvas to the viewport; it does not shrink every game's assets.
- **Ultra mode:** the expand button shows one game fullscreen and caps the other loaded accounts at 1 FPS, without disconnecting them. Use the same button to exit. Account/workspace switching exits Ultra. Visual rest and Ultra also keep already loaded Active when visible pages loaded while enabled; disabling them restores the normal five-minute unload rule.
- **Clean unused memory:** manually requests JavaScript garbage collection in that account. It preserves live objects, storage and connections. Requests are serialized and successful cleanup has a two-minute cooldown per page; pages under debugging are skipped. Live textures and game data cannot safely be forced out of RAM.

The star logo has outward rays and a short expansion on launch. Reduced-motion preferences disable it. No continuous logo animation consumes resources while playing.

Power saving limits requestAnimationFrame callbacks in the page, embedded frames and account popups. It leaves browser clocks, timers, networking, CSS animations and worker loops unchanged, so it cannot guarantee a fixed CPU or power budget. Games that calculate progress per frame can behave differently at reduced FPS. Actual FPS can be lower than the target when covered, minimized or under load. The loaded page still uses RAM for live game data, images and other resources; reducing FPS does not remove those assets or impose a safe fixed memory cap. Power saving never unloads an account. Suspended releases its renderer memory and disconnects the game.

Unloading may disconnect a character. Offline progress depends on the game. Memory figures exclude shared app/GPU overhead. Compatibility depends on the website and its authentication requirements.

### Floating layout

Choose **Layout → Floating** in the panel toolbar or app menu, then select which accounts should float. You can select several secondary accounts, or leave all unchecked for just the main account. Open **Layout → Floating accounts…** or the account context menu to change this later.

Click a miniature to swap that account with the main account; the other floating windows stay in place. Press and drag to move it without swapping. Drag its bottom-right grip to resize while preserving the game's proportions. The **− / +** buttons change its size without dragging; focus the grip and use arrow keys for fine adjustments. The **pin** button locks movement and resizing while keeping click-to-swap available. Unpin to adjust it again. Each window's position, relative size and pin setting are saved per workspace. The corner button moves it to the next corner. The main toolbar's swap button and arrow keys operate the first floating window.

Selecting another account in the sidebar puts the previous main account in that account's floating slot, or the first slot if it was not floating. Pages keep their existing sessions and activity modes; no screenshot polling or duplicate game instance is used. Windows stay inside the visible game when resizing or using a fixed resolution. Suspended accounts do not show until resumed. Dialogs and other workspaces hide the windows. In Ultra fullscreen, floating windows still swap and follow Ultra's existing secondary-account frame limit.

Left-clicking an account's color selects the account, including with the sidebar collapsed. To customize its color, right-click the account and choose **Choose color…**.

## Portable data

### Native automation

Open an account's **Automation** button, or right-click it and choose **Auto Clicker…** / **Macro Maker…**. These are separate tools:

- **Auto Clicker:** add targets, choose their points on the game page, select a mouse button or keyboard input, set each interval, then start. Each point can show a circle at 50% opacity, red by default, with a color picker. Turn off **Show circle** to keep the actions running without any marker. Markers have no name, crosshair or countdown. Preview temporarily uncovers the game. Inputs stay in that account; the Windows cursor remains free.
- While automation runs, that account stays loaded and its background timers remain active, including when Astria is minimized or another workspace is selected. **Stop** restores its usual activity policy; Eco still limits rendering FPS. Closing, suspending or navigating the page stops automation, and reopening Astria never starts it automatically.
- **Macro Maker:** create ordered key, mouse, move, scroll, text and wait steps; configure start/repeat delays, run once or repeat, and import/export version-2 Macro Maker JSON files.

Targets use account-page coordinates and scale with floating windows, fixed resolutions and zoom. They follow the account when swapping floating/main views. If the game rearranges its controls, choose the point again. Clicking to choose a point does not click the game. Esc or right-click cancels selection.

Each account runs independently. Starting one tool stops the other tool in that account. Use **Stop**, the account menu, or **Menu → Automation → Stop all automation**. Normal game shortcuts remain available. Reloading/navigating, suspending or closing the account stops its automation; reopening Astria never starts it automatically. The existing five-minute unload policy still applies to accounts set to Active when visible. No extra game instance or screen polling is used.

Settings and macro exports stay in **Save/Automation**, separately from game profiles. Importing a macro never gives it desktop control: all inputs remain inside its chosen Astria account.

Pages opened in the background start with a usable viewport, based on the visible panel, rather than a 1×1 surface. This lets games calculate their initial canvas, camera and interface at a normal size. Switching Always active accounts keeps the same page instance and its in-memory state; it does not reload or copy another account's data.

Astria creates **Save** beside the executable on first launch:

| Folder | Contents |
| --- | --- |
| Profile | Settings and separate Chromium account profiles |
| Games | Files/saves downloaded or exported from games |
| Automation | Per-account macro profiles, clicker targets and macro exports |
| Backups | Configuration exports and previous programs from updates |
| Updates | Verified update staging and local update logs |
| Temp, Logs, CrashDumps | Temporary and diagnostic data |

Use **☰ → Open Save folder** to find your files. `Save/LEIA-ME.txt` maps account names to profile folders. To move or back up Astria, close it first and copy the **entire folder, including Save**. Do not run two copies using the same Save.

Online progress normally stays on the game's server. Windows-protected cookies may require a new login on another PC or Windows user. Configuration export includes names, URLs and preferences, but no cookies or passwords. **Never distribute your populated Save folder.** Share the clean release ZIP.

Each account uses Chromium's native HTTP cache inside its own profile. Game files are not intercepted or transferred through Astria's main process. This can use more disk space than a shared cache, while avoiding that extra loading overhead. Existing `Save/SharedAssets` folders from older releases are preserved but no longer used. All account caches move with Save.

Always active keeps pages loaded and timers running when switching accounts or workspaces, or opening Astria dialogs. Covered games may animate at reduced FPS. Every active game still needs its own CPU, RAM and GPU resources; running several can reduce the FPS available to the selected game. Use Active when visible or Suspended for accounts that do not need to keep running. Minimizing or hiding the application uses Chromium's normal hidden-page behavior so games can use their own background update mechanisms. Actual online progress depends on the game, particularly if it calculates progress from animation frames instead of elapsed time.

Closing Astria or restarting it for an update lets game pages run their normal shutdown events before the browser exits, then flushes their browser storage. This allows games to send their final connection/save messages. A page that does not finish closing has a five-second fallback. It does not guarantee recovery of state already lost on the game's server.

When opening Astria, the selected visible account starts first. Other visible pages use a small loading queue, and hidden Always active or Power saving accounts open one at a time after the visible navigation finishes. A slow site's initial loading slot expires after ten seconds so it cannot block the other accounts indefinitely. Selecting a queued account gives it priority. Activity settings and saved sessions are preserved.

For faster startup after turning on the PC, keep the entire portable Astria folder, including Save, on an SSD. A mechanical hard drive can be much slower when Windows has not cached the program and profile files yet. Changing the storage location requires closing Astria first; no caches or profiles need to be deleted.

## Project policy and security

The official project is maintained by its owner. Outside pull requests, issues and discussions are disabled. Other users can download releases and read the public source; they cannot push changes to the official repository. Public materials remain copyable under the included license.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and security boundaries. Owner build instructions are in [CONTRIBUTING.md](CONTRIBUTING.md). MIT license.
