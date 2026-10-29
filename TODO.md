# BUG-HUNT TODO — read-only audit (no fixes applied)

Date: 2026-10-29 · Host: VM (server already live on :3030, pid 131641)
Method: source read + `npm test` + `node --check` + `curl` against the live backend.
UI lens: `.agents/skills/ui-taste/SKILL.md` + `reference/audit.md` (read-only audit, no image-to-UI render available — code/DOM-level evidence only; no viewport render was performed).

Verification results:

- `npm test`: 9/9 pass. `node --check`: OK on all 24 js files (src/**, api/**).
- `curl` codes: `GET /` 200 · `/studio/studio.js` 200 · `/studio/vendor/three.min.js` 200 ·
  `/api/studio/health` 200 · `/api/studio/games` 200 (`[]`) · `/api/studio/capabilities` 200 ·
  `/api/studio/preview-state` 200 · unknown game id/code/export 404 · `game/abc` 404 ·
  `live-preview/../../package.json` blocked (403/404). No CSP/security headers on any response.
- NOTE: one transient `preview-state → {ready:true, title:"Cyber Orbital Orb Rush"}` was observed
  while another session appeared to be building; at rest it is `{ready:false}` and
  `public/live-preview/` is empty. Not counted as a bug.

---

## Critical

- [ ] C1 · Directory path crashes the server process. `sendFile()` streams whatever
      `existsSync` passes, with no `isFile()` guard, and nothing handles the stream `error` event,
      so requesting a path that resolves to a **directory** throws an unhandled stream error and kills
      the process (reproduced in isolation: `node -e` with `createReadStream('/tmp')` throws
      `Unhandled 'error' event`). Reachable via `GET /studio/games/:id/assets/..`
      (regex allows `..`), `/studio/uploads/.`, `/studio/live-preview/.`.
      File: `src/server.js:103-114` (routes `:451-461`, `:464-475`, `:478-496`).
      Repro: `curl http://localhost:3030/studio/games/x/assets/..` (DO NOT run against the shared
      live server — it would kill pid 131641; test on a scratch copy).
      Fix: one line — return 404 unless `fs.statSync(target).isFile()`, plus attach an `error`
      handler to the read stream.
- [ ] C2 · Composer destroys the user's prompt on failed send. The submit handler clears the
      textarea AND the localStorage draft **before** the POST resolves, so a failed
      `/api/studio/terminal/send` loses the text permanently.
      File: `public/studio.js:925-926` (`promptEl.value = ""; clearDraft();` precedes `fetch` at `:935`).
      Repro: stop backend, type a prompt, press Build → text is gone and status says unreachable.
      Fix: one line — move the clear into the success handler only.
- [ ] C3 · Vercel serverless build path produces an **unwinnable game**. `api/generate.js`
      calls `generateThreeJsGameHtml(spec, worldData)` with no layout, so `orbs = []` while
      `TARGET_ORBS` falls back to 12 — score can never reach 12 and the win banner never fires.
      File: `api/generate.js:38` (runtime fallback `src/engine/threejs_runtime.js:183`).
      Repro: POST to the serverless `/api/generate` and count orbs vs `TARGET_ORBS` in the HTML.
      Fix: one line — pass `generateLayout(spec)` as the third argument.
- [ ] C4 · No Content-Security-Policy, no security headers anywhere. The node server sets only
      CORS headers; `next.config.mjs` `headers()` never applies (no Next.js dependency installed —
      `framework: null` static deploy, `package.json:30-39`); `public/index.html:2-21` has no CSP
      meta; generated games ship an inline `<style>` block and the compat helper inlines game JS
      into `<script>`, contradicting the `script-src 'self'` claim in code comments.
      Files: `src/server.js:132-135`, `next.config.mjs:1-18`, `src/engine/threejs_runtime.js:90-137,428-434`.
      Repro: `curl -sI http://localhost:3030/` shows zero `content-security-policy`,
      `x-content-type-options`, `frame-ancestors`.
      Fix: one line — emit `Content-Security-Policy` + `X-Content-Type-Options: nosniff` headers
      from the node server (and document the inline-style exception).

## High

- [ ] H1 · Primary SSE pipeline is dead from the UI. Nothing in `public/studio.js` ever calls
      `POST /api/studio/generate` (all 10 `fetch()` calls go to health/games/preview-state/
      terminal/send/upload/mcp/capabilities); submit only forwards text to the tmux terminal.
      The 240s-timeout SSE route with heartbeat/close handling is therefore untested production code.
      Files: `public/studio.js` (grep `fetch(` → lines 230,256,271,292,332,725,739,769,787,849,935),
      `src/server.js:628-724`.
      Repro: open devtools → Build → only `/api/studio/terminal/send` fires, never `/api/studio/generate`.
      Fix: one line — wire the composer to the SSE route (or delete the route and document tmux-only).
- [ ] H2 · Route docs in the server header comment omit 6 live routes (`/api/studio/upload`,
      `/api/studio/terminal/send`, `/api/studio/mcp*`, `/api/studio/capabilities`,
      `/api/studio/preview-state`, `/studio/vendor/*`, `/studio/uploads/*`).
      File: `src/server.js:7-15`. Repro: read the comment, then `grep "pathname ===" src/server.js`.
      Fix: one line — extend the comment block to list every route.
- [ ] H3 · Corrupt game manifest hangs the request forever. `getGame()` awaits
      `JSON.parse(readFile(...))` with no try/catch, so a corrupt `manifest.json` rejects into a
      handler with no catch → no response is ever written (socket hangs until client timeout).
      File: `src/storage/game_store.js:159-163` (callers `src/server.js:369-390`).
      Repro: write garbage into `storage/games/<id>/manifest.json`, then
      `curl -m 5 /api/studio/games/<id>` → timeout, no status code.
      Fix: one line — wrap the parse in try/catch and return `null` on failure.
- [ ] H4 · Unauthenticated unbounded disk-fill. `POST /api/studio/upload` caps each file at
      10 MB but enforces no total quota, no rate limit, no auth, and no cleanup; `/api/studio/generate`
      and `/api/studio/terminal/send` buffer unbounded JSON bodies the same way.
      File: `src/server.js:502-558` (also `:561-625`, `:628-631`).
      Repro: loop `curl -X POST /api/studio/upload?name=f.bin --data-binary @10mb` → `storage/.uploads` grows forever.
      Fix: one line — cap total `.uploads` size / add a tiny rate limiter.
- [ ] H5 · 3D-backend default is the forbidden non-Meta model with a deadline 5 days out.
      `activeBackend()` defaults to `trellis` (Microsoft) and today is Oct 29 vs the
      Nov 3 swap deadline in-code; a forgotten env var = hackathon disqualification risk.
      File: `src/pipeline/assets_3d.js:27` (deadline `:24`, warning `:43-49`, `REMINDERS.md:3-15`).
      Repro: `ASSET_3D_BACKEND` unset → `backendStatus()` returns `{backend:"trellis", compliant:false}`.
      Fix: one line — flip `DEV_BACKEND` default to `"sam3d"` now.
- [ ] H6 · Publisher refuses legitimate pipeline titles. `JUNK_TITLE` blocks anything starting
      with "cyber orbital" or ending "orb rush", which rejects real generated titles such as the
      observed live-preview title "Cyber Orbital Orb Rush".
      File: `src/tools/publish-game.js:49-50`.
      Repro: `node src/tools/publish-game.js --dir <game> --title "Cyber Orbital Orb Rush"` → refused.
      Fix: one line — anchor the junk patterns (e.g. exact/short-title match only).
- [ ] H7 · Output safety shield is security theater. `validateGeneratedArtifacts()` is never
      called anywhere in the run path (grep: defined once, zero callers), and
      `UnityExporter.validateCompilation()` is likewise never invoked — despite the "Guarantees 0%
      risk" docstring and the QA-gate claims.
      Files: `src/pipeline/safety_shield.js:63-79`, `src/engine/unity_exporter.js:157-183`.
      Repro: `grep -rn validateGeneratedArtifacts|validateCompilation src/ api/` → definitions only.
      Fix: one line — call the shield in `AgentRunner.run()` before `saveGame` (or delete the claim).
- [ ] H8 · Unity export ignores spec gravity. The C# template hardcodes `gravity = -20.0f`
      while WebGL uses the spec value, so desktop and Unity builds of the same game diverge.
      File: `src/engine/unity_exporter.js:37`.
      Repro: design with gravity −8 → web player floats, Unity project falls fast.
      Fix: one line — interpolate the spec gravity into the template like speed/jump.

## Medium

- [ ] M1 · `vercel.json` rewrite target does not exist. `/game/(.*)` proxies to
      `spurcode.duckdns.org/game/$1`, but the server has no `/game/*` route (verified 404).
      File: `vercel.json:14-17`. Repro: any `/game/x` URL → 404. Fix: one line — drop the rewrite.
- [ ] M2 · Dead static route `/studio/tailwind.config.js` always 404s (file absent from `public/`).
      File: `src/server.js:148-161`. Repro: `curl -o /dev/null -w "%{http_code}" /studio/tailwind.config.js` → 404.
      Fix: one line — remove that branch from the static-assets handler.
- [ ] M3 · Hand-published top-level assets are copied but never served. `publish-game.js`
      copies `.css/.png/.json/.glb` next to `index.html`, but the server only serves
      `index.html|game.js` at top level (`assets/*` only under `assets/`), so references 404.
      Files: `src/tools/publish-game.js:119-129`, `src/server.js:478-483`.
      Repro: publish a game with `style.css` → `GET /studio/games/<id>/style.css` → 404.
      Fix: one line — extend the play route allowlist to the documented `ASSET_EXTS` set.
- [ ] M4 · Every static byte is `cache-control: no-cache` with no gzip. The 600 KB vendored
      `three.min.js` and immutable hashed fonts re-download on every load.
      File: `src/server.js:109-112`. Repro: devtools network → `three.min.js` 200 (not 304) each visit.
      Fix: one line — send immutable cache headers for `/studio/vendor/*` and `/studio/fonts/*`.
- [ ] M5 · Build-scope picker is misleading. "3D Model"/"Image" only prepend English text to the
      prompt; the backend has no scope concept and takes the identical tmux path regardless.
      File: `public/studio.js:100-105` (+ `scopeEl` read at `:900`). Repro: pick "Image" → same terminal
      flow, no image-specific behavior. Fix: one line — label it "prompt helper" or thread scope through.
- [ ] M6 · Showcase junk filter is trivially bypassed. `isShowcaseGame` rejects only exact
      `test`/`hi`/`/mcp` strings, so "test game", "untitled 2", "asdf" pass into the Library UI.
      File: `public/studio.js:152-158`. Repro: library entry titled "test game" renders as a card.
      Fix: one line — reuse the server-side-style minimum-signal rule (length + word count + denylist).
- [ ] M7 · No timeouts on any outbound fetch or UI poll. `meta_wonder`/`baseten`/`meta_image`
      await `fetch` with no `AbortSignal.timeout`; the 2 s preview poll runs even when the tab is
      hidden; a hung provider holds SSE sockets open (heartbeat keeps them alive).
      Files: `src/agent/meta_wonder.js:35`, `src/agent/baseten_muse.js:58`,
      `src/pipeline/meta_image.js:27`, `public/studio.js:319-320`.
      Repro: block `api.meta.ai` → SSE run hangs with `: ping` every 15 s indefinitely.
      Fix: one line — add `signal: AbortSignal.timeout(30000)` to each provider fetch.
- [ ] M8 · Stale test-count and route docs. `PIPELINE.md` claims "5 passing" (actual 9),
      `EVIDENCE.md` logs "proof 3" events per run (code emits 4 proofs), `PIPELINE.md` documents
      `GET /api/games` (actual `/api/studio/games`), `src/index.js` advertises retired model IDs
      (`muse-code-1.0`), `TerrainPipeline` accepts `resolution/octaves` then hardcodes 64.
      Files: `PIPELINE.md:73,126`, `docs/EVIDENCE.md:33`, `src/index.js:13`, `src/pipeline/terrain.js:9-20`.
      Repro: `npm test` → 9 pass vs docs; `grep` each claim. Fix: one line each — refresh the numbers/ids.
- [ ] M9 · Dead weight ships to the client. `public/icons/*.svg` (5 files) are unreferenced
      (all icons are inline SVG); npm deps `clsx`, `tailwind-merge`, `qrcode.react`, `lucide-*`,
      `@fontsource/*` are imported nowhere in served code; `createSceneConfig()` is dead.
      Files: `public/icons/`, `package.json:30-39`, `src/runtime/engine.js:5`.
      Repro: `grep -rn "icons/" public/index.html public/studio.js src/` → no hits.
      Fix: one line — delete `public/icons/` or reference it; prune unused deps.
- [ ] M10 · Serverless `/api/games` masks failure and reads the wrong disk. It returns `[]` on
      any error and resolves storage relative to serverless `cwd`, so failures are silent and data
      is always empty on Vercel.
      File: `api/games.js:18-24`. Repro: throw inside `listGames` → still HTTP 200 `[]`.
      Fix: one line — return 500 with an error body instead of `[]`.
- [ ] M11 · Health endpoint reports file existence as key presence. `basetenKeyPresent` is true
      when the vault _script file_ exists, not when a key resolves — green dashboard, dead provider.
      File: `src/server.js:196-201`. Repro: vault script present, no key → still `true`.
      Fix: one line — resolve the key (or attempt a cheap probe) instead of `existsSync`.
- [ ] M12 · Concurrent runs share one work dir. `runDir = run_${Date.now()}` collides when two
      runs start in the same millisecond, mixing CLI outputs and caches.
      File: `src/agent/agent_runner.js:673-679`. Repro: fire two `/generate` POSTs simultaneously.
      Fix: one line — append `crypto.randomBytes(3).toString('hex')` to the dir name.
- [ ] M13 · UI ignores the capabilities it fetches. The model dropdown is hardcoded HTML while
      `/api/studio/capabilities` returns the live allowlist + MCP servers; allowlist edits silently
      desync the UI (duplicate source of truth for 6 model IDs).
      File: `public/studio.js:787-799` vs `public/index.html:467-479`.
      Repro: change `ALLOWED_CLI_MODELS` → dropdown unchanged. Fix: one line — render options from data.
- [ ] M14 · Every submit reloads the terminal iframe. `loadTerminalInline()` runs on each
      successful submit, resetting the visible CLI session even when already loaded.
      File: `public/studio.js:924,962-972`. Repro: submit twice → iframe `src` reassigned, scroll lost.
      Fix: one line — skip when the frame already has a `src`.
- [ ] M15 · Audio/content-type gaps. `CONTENT_TYPES` lacks `.mp3/.wav/.ogg` (served as
      `octet-stream`) and `.wasm/.m4a`; hand-made games referencing them still play but with wrong
      types and console warnings.
      File: `src/server.js:90-101`. Repro: publish game with `jump.mp3` → served `application/octet-stream`.
      Fix: one line — add the missing audio types.

## Low (ui-taste audit dimension: polish / a11y / responsive)

- [ ] L1 · Suspected small-text contrast shortfall (unmeasured — needs a colorimeter check, do not
      treat as confirmed). `--faint: #6d6d7a` at 10–11 px (`terminal-title`, `live-text`, `chain-foot`,
      `game-meta`) on near-black likely lands under WCAG AA 4.5:1.
      File: `public/app.css:21,435-445,201-207,1920-1941`. Repro: sample the rendered pixels at 400% zoom.
      Fix: one line — bump faint text to `#9b9ba8` where it carries information.
- [ ] L2 · Hidden-native-select a11y pattern. `#model-select` is `.sr-only` **and**
      `aria-hidden="true"` **and** `tabindex="-1"`; `role="option"` sits on `<button>`s inside
      `role="listbox"` without `aria-activedescendant` management.
      File: `public/index.html:460-466`, `public/studio.js:506-511`. Repro: keyboard-only run-through of
      the model picker with a screen reader. Fix: one line — drop `aria-hidden` and manage focus
      per listbox pattern (or keep native select visible).
- [ ] L3 · Drawer has no focus trap and Escape steals keystrokes. The library drawer never traps
      focus, and global `Escape` handlers close it (and the plus menu) even while typing in drawer
      inputs (`instruction-input`, MCP name/url).
      Files: `public/studio.js:251-253,480-482,521-523`, `public/index.html:64-102`.
      Repro: open drawer → Tab leaves it; type in MCP field → `Escape` closes everything.
      Fix: one line — guard the handlers with `document.activeElement.tagName !== 'INPUT'`.
- [ ] L4 · Dead CSS overrides ship. The mobile block redeclares `.picker` twice (first block
      dead), and desktop `.send-btn:hover` (translucent) is fully overridden later (solid white).
      Files: `public/app.css:1823-1832`, `:867-871` vs `:936-939`.
      Repro: read the cascade — first declarations never win. Fix: one line — delete the losers.
- [ ] L5 · Mobile ≤960 px: terminal is unreachable in preview mode by design
      (`preview` pane hides `.terminal-section`), so a phone user cannot watch the CLI while the game
      builds — plus `bar-left` relies on horizontal chip scroll with no visible affordance.
      Files: `public/app.css:1778-1791,1843-1851`. Repro: emulate 390×844 → switch to Game Preview
      mid-run. Fix: one line — add a "viewing preview — build continues" status line.
- [ ] L6 · Silent `listGames` fallback hides corruption. A corrupt `index.json` returns `[]`
      (empty library) instead of surfacing the error, same mask pattern as M10.
      File: `src/storage/game_store.js:139-147`. Repro: truncate `storage/games/index.json` → library
      silently empty. Fix: one line — log/throw a distinct `corrupt-index` signal.

## Explicitly checked and NOT bugs

- All JS-referenced element IDs exist in `index.html` (no null-`getElementById` crashes on load).
- `fetch` failures in library/health/preview polling all have `.catch` fallbacks (offline-safe).
- Path-traversal writes are blocked (`live-preview`, `uploads`, `assets` resolve-guards hold;
  `font`/`mcp`/`manifest` regexes are tight) — except the C1 directory-read crash above.
- `npm test` 9/9 green; `node --check` clean on all 24 files; endpoint status codes correct.
- Empty states exist (preview empty, library empty); game/library titles use `textContent` (no XSS sink);
  generated-game title/objective strip `<` (adequate for a text node).
- Reduced-motion block preserves state feedback (`0.01ms`, not `0s`/`none`); 16 px iOS inputs and
  44 px touch targets are honored at ≤960 px per the ios-design playbook.
