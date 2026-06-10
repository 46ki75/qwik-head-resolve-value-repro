# Qwik v2 — `resolveValue()` returns `undefined` in `head()` during SPA navigation, and the resulting exception destroys `<head>`

Minimal reproduction for two related bugs in `@qwik.dev/router@2.0.0-beta.37`.

## Bug 1 — `resolveValue()` violates its type contract during client-side navigation

The documented pattern for dynamic `<title>` / OG tags reads a route loader
from the `head` function:

```tsx
export const useUrl = routeLoader$(({ url }) => url.toString());

export const head: DocumentHead = ({ resolveValue }) => {
  const url = resolveValue(useUrl); // typed as `string`
  const parsed = new URL(url);      // 💥 TypeError: Failed to construct 'URL': Invalid URL
  ...
};
```

This works in v1 (loaders resolve before `head()` runs) and on v2 SSR. But on
**client-side (SPA) navigation**, v2 resolves the head reactively, and there
is a scheduling window in which the target route's loader signal has no value
yet — `resolveValue` returns **`undefined`**, even though its return type
says otherwise. Any head function that dereferences the value throws.

### When the window opens

The race is timing-dependent: it fires when loading the target route's
modules in the **client** environment is slow relative to the head
resolution — concretely, in dev mode, whenever the route's modules need a
fresh transform (first navigation after the dev server starts, or after any
file edit / HMR invalidation). With a warm transform cache the loader
usually wins and everything looks fine, which makes this easy to miss and
maddening to debug. Real apps whose loaders hit a database or API (always
slower than a warm module load) see it constantly.

## Bug 2 — an exception in `head()` removes the `<head>` element and wedges the app

The fallout is far worse than a missing title. When `head()` throws during
the SPA navigation, Qwik's head re-render aborts mid-flight and the document
is left with **no `<head>` element at all** (`document.head === null`).

From that point on, in dev mode, **every QRL chunk that imports CSS fails**:
Vite's `updateStyle` calls `document.head.appendChild(...)` →
`TypeError: Cannot read properties of null (reading 'appendChild')` — and
Qwik retries the failed QRL in a tight loop, forever:

```text
qrl OtherContent_component_... failed to load TypeError: Cannot read properties of null (reading 'appendChild')
    at updateStyle (http://localhost:5198/@vite/client:1070:18)
    ... (repeats indefinitely — ~18,000 console errors in a few seconds)
```

A user-code exception in a head function arguably shouldn't be able to
destroy the document and hang the page.

## Versions

| package            | version         |
| ------------------ | --------------- |
| `@qwik.dev/core`   | `2.0.0-beta.37` |
| `@qwik.dev/router` | `2.0.0-beta.37` |
| `vite`             | `7.3.2`         |

## Reproduce

```bash
pnpm install

# Option A — headless, deterministic (needs a Chromium binary):
pnpm exec playwright-core install chromium   # once
pnpm repro
#   starts the dev server, SPA-navigates / -> /other/ -> / ... with a cold
#   transform cache, and exits non-zero when the bug is present:
#     attempt 1: spaNav=true resolveValueUndefined=true headNull=true errors=18091
#     - TypeError: Failed to construct 'URL': Invalid URL
#     - qrl OtherContent_component_... failed to load TypeError: ...appendChild...
#   (set PLAYWRIGHT_CHROMIUM_PATH to use a specific Chromium binary)

# Bug 2 in isolation — deterministic, no timing involved (the /crash/ route's
# head() throws deliberately on the client):
pnpm repro:crash

# Option B — real dev server + browser:
pnpm dev
#   open the printed URL, open the devtools console, and click the
#   "Go to /other/" link (client-side navigation). Because of the timing
#   dependence, do this RIGHT AFTER the server starts (cold cache), or touch
#   a route file first; with a warm cache the navigation can succeed.
#   => "[other head] resolveValue(useUrl) = undefined"
#   => "Failed to construct 'URL': Invalid URL"
#   => endless "Cannot read properties of null (reading 'appendChild')"
#   => document.head === null
#   A full page reload (SSR) of /other/ always works fine.
```

## Files

- `src/routes/index.tsx` — home route; loader + `head` pattern, link to `/other/`.
- `src/routes/other/index.tsx` — target route; same pattern, its loader has a
  200 ms delay simulating a DB/API call.
- `src/routes/crash/index.tsx` — isolates bug 2: its `head()` throws on the
  client unconditionally, so the `<head>` destruction reproduces on every
  navigation with no timing dependence.
- `src/components/other-content.tsx` — a lazy chunk importing a CSS module, to
  demonstrate the bug-2 fallout (QRL + `updateStyle` retry loop).
- `check.mjs` — headless reproduction. For bug 1 (`pnpm repro`) it invalidates
  the dev server's transform cache before each attempt (touches the route
  files — equivalent to a fresh server or an edit) so the race fires
  deterministically; `pnpm repro:crash` runs the bug-2 scenario.
- `ISSUE-1-resolve-value-undefined.md`, `ISSUE-2-head-exception-fallout.md` —
  draft texts for the upstream issues.

## Expected

- `resolveValue(loader)` in `head()` either waits for the loader (v1
  behavior, matches its type) or is explicitly typed/documented as
  `T | undefined` during client-side navigation.
- An exception thrown by a `head()` function must not remove the document's
  `<head>` element or put the QRL loader into an infinite retry loop.

## Workaround

- Don't pass values through a loader just to reach `head()` — `head` already
  receives the route location: `({ url }) => ({ title: url.pathname })`.
- For real data loaders, guard for `undefined` and return a partial head; the
  head re-resolves once the loader signal lands:

```tsx
export const head: DocumentHead = ({ url, resolveValue }) => {
  const data = resolveValue(useData);
  if (!data) return {}; // transient state during SPA navigation
  return { title: data.title };
};
```
