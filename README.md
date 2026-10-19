# Picky

A static, touch-based chooser with eleven modes. No build step or runtime dependencies are required.

## Modes and appearance

- **Finger:** hold two or more fingers to choose winners or losers.
- **Wheel:** place two or more fingers in the lower half. Picky counts them automatically and spins after the shared buildup.
- **4-Way:** one finger in each quarter; the two sides pick finalists, then one winner.
- **Dice:** hold for 2.4 seconds to roll a Blender-authored d6, d8, d12, or d20. The landed result fills the screen.
- **1–100:** choose the maximum using the top arrows (100 by default). Tap for steps of one; hold an arrow for steps of ten. Hold the play area to pick from 1 through your maximum; the count-up always takes one second.
- **Multi Dice:** roll 1–3 six-sided dice (two by default), then see the total.
- **Finger 5+:** each person taps to leave a numbered bubble at that exact spot. Choose a winner count, then tap Pick once. After the pulses, the winning bubbles stay highlighted against their colors for two seconds before the same roster returns. Undo removes the latest player; Clear starts a new roster.
- **Teams:** choose 2–5 teams and hold fingers on the screen. Picky balances everyone across the teams, with at most four people per team. Teammates share a color and connecting lines. Five people in two teams becomes three and two. If the selected team count cannot fit everyone, increase it before choosing.
- **Teams 5+:** tap to leave numbered bubbles, then hold Pick to form teams. The same limits and balancing apply. Release Pick to return to the same roster after a short reading pause.
- **Ranking:** hold 2–5 fingers. Each dot receives a unique rank from 1 through the number of players.
- **Tournament 5+:** choose 6–25 people. Picky asks for balanced groups of up to five fingers, highlights one winner per round like Finger mode, then asks those winners to return for the winners bracket. Picky chooses the final winner automatically. Tournament dots have no ranks or number labels.

The bottom button shows the current mode. Tap it to reveal other pinned modes and **More…**; Finger and Wheel are pinned by default. More opens a centered, scrollable icon list and Settings. Settings has a two-column pin grid for up to three modes and a Dark/Light appearance switch. Pins and appearance persist; game settings reset separately. Light uses a cream background, inked shapes, red accents, and the supplied cartoon wordmark throughout the app.

Every selection builds up with three pulses over 2.4 seconds. Controls, hints, and the logo disappear during the buildup; there is no progress bar or charging caption. Dice, numbers, and Finger 5+ show a compact Picky wordmark while waiting. Dice and number results show only the outcome; lift to clear them, like Finger mode. Releasing early cancels held rounds. Finger 5+ runs automatically from one tap and highlights the selected bubbles in place. Results have no captions, navigation, or replay button.

Teams and Ranking leave their dots and connections visible for 1.5 seconds after the last finger lifts. Teams 5+ uses the same pause after releasing Pick. Tournament rounds also pause after everyone lifts before showing the next round. No replay or next-round buttons are needed.

## Run locally

Serve this directory with `python3 -m http.server 8000`, then open `http://localhost:8000/`. Use a touch device or browser touch emulation for gameplay. Service workers work on localhost or HTTPS, not when opening `index.html` directly as a file.

## Offline use and releases

Mobile browser visits open with a short iPhone/iPad or Android home-screen installation guide. A quiet **Try in browser** button permits the current visit; it is not saved as a permanent dismissal. The guide returns on a new visit or browser return, while desktop browsers and installed apps open directly to the game. Android offers the native install prompt when available and manual menu steps otherwise. The guide works offline with the rest of the app.

The iPhone and Android install icons have fully opaque, pure-black backgrounds. Their new filenames keep installation previews from reusing the old transparent icon. A previously added iPhone icon may need to be removed and added again to pick up the new artwork.

`node tools/build-icons.mjs` exports all icon sizes from the existing SVG source and checks their opacity, black edges, unchanged mark, and maskable safe area. It requires Sharp locally or in the bundled desktop runtime.

Installation wording follows [Apple's Home Screen instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios) and [Chrome's Android web-app instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

The first online visit installs a complete offline copy. Later launches load that copy immediately, including the logo, game code, and icons, without waiting for the network. Updates download in the background and become active after existing Picky windows close. A failed update keeps the previous working copy.

For every release:

1. Change `CACHE_VERSION` in `service-worker.js` whenever an app file changes. Use a new value for every release, including rollbacks.
2. If adding a required asset, add it to `SHELL_FILES` in that file.
3. Publish `index.html`, all root-level `.css` and `.js` files, `manifest.json`, `PickyNB.png`, `images/`, and `assets/dice/models.json` together to the same HTTPS directory. Root hosting and subdirectories such as `/Picky/` are supported. Blender source, tools, and tests are not needed at runtime.

Serve `service-worker.js` as JavaScript; do not rewrite missing files to HTML. The registration bypasses the browser HTTP cache when checking for worker updates.

To prepare only the runtime files for hosting, run `node tools/build-site.mjs`.
The generated `dist/` directory is ignored by Git. Sites deployment configuration
is stored in `.openai/hosting.json`; keep its project ID when publishing updates.

## Game settings

- Lifting fingers, cancelling a countdown, or finishing a round preserves the selected count and winner/loser choice.
- Switching modes or returning after the app was backgrounded resets the current game's defaults: one winner in Finger/Finger 5+, four players in 4-Way, d6 in Dice, a maximum of 100 in 1–100, and two dice in Multi Dice. Wheel detects its players automatically. Finger 5+ starts a fresh roster.
- A fresh page load starts in Finger mode.
- Teams modes reset to two teams; Tournament 5+ resets to ten people. Repeating a tournament preserves the chosen total; leaving the mode or reopening resets it.
- The first five players receive separated neon hues. Larger games use the remaining shades, choosing the next color by its perceptual distance from every active color.

## Blender dice

`assets/dice/picky-dice.blend` is the editable source. `tools/build-dice.py` creates all four Platonic dice in Blender and exports `assets/dice/models.json`, only 1,975 bytes. The lightweight perspective renderer uses this mesh data directly, with no WebGL library, texture downloads, or idle animation loop. Roll outcomes use uniform random selection; animations orient the corresponding face toward the viewer.

To rebuild the meshes:

```sh
blender --background --python tools/build-dice.py
```

## Verification

Run the dependency-free color and service-worker regressions:

```sh
node --test tests/*.test.cjs
```

Run browser regressions with Playwright available through Node's module search path (or the bundled Codex runtime) and Chrome installed:

```sh
node tests/gameplay.browser.cjs
node tests/expanded.browser.cjs
node tests/navigation.browser.cjs
node tests/number-range.browser.cjs
node tests/group-placement.browser.cjs
node tests/party.browser.cjs
node tests/tournament.browser.cjs
node tests/install.browser.cjs
```

`CHROME_PATH` can override the Chrome executable. Browser checks cover real multitouch, all eleven game modes, team capacity and balanced remainders, ranking uniqueness, complete tournaments, settings and lifecycle resets, pins and theme persistence, fixed number-animation timing, slow-network startup, and offline reopening at both `/` and `/Picky/`.
