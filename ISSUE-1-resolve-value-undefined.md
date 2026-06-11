Title: [🐞] V2 `resolveValue()` returns `undefined` inside `head()` during SPA navigation, violating its type (v2)

### Which component is affected?

Qwik City (routing)

### Describe the bug

Reading a route loader from a `head` function via `resolveValue()` — the documented pattern for dynamic `<title>` / OG tags — can return `undefined` during **client-side (SPA) navigation**, even though `ResolveSyncValue`'s return type promises the loader's value.

```tsx
export const useUrl = routeLoader$(({ url }) => url.toString());

export const head: DocumentHead = ({ resolveValue }) => {
  const url = resolveValue(useUrl); // typed as `string`, actually `undefined`
  const parsed = new URL(url); // 💥 TypeError: Failed to construct 'URL': Invalid URL
  return { title: parsed.pathname };
};
```

This works on SSR (and always worked in v1, where loaders resolve before `head()` runs). On SPA navigation, v2 resolves the head reactively, and there is a scheduling window in which the target route's loader signal has no value yet: `resolveHead()`'s `getData` reads `loaderState[id].value` and returns `undefined`.

The window is timing-dependent: it opens when loading the target route's modules in the client environment is slow relative to head resolution. In dev that means _whenever the route's modules need a fresh transform_ (first navigation after the dev server starts, or after any file edit / HMR invalidation); with a warm transform cache the loader usually wins and the bug hides. Real apps whose loaders hit a DB or API see it constantly.

Because any dereference of the loader value throws, the practical impact is a crash inside head resolution — which, due to a separate containment problem (see companion issue "an exception thrown in `head()` during SPA navigation removes the `<head>` element"), takes down the whole page: `document.head` becomes `null` and QRL loading enters an infinite retry loop.
**Expected behavior** — either of:

- `resolveValue(loader)` inside `head()` waits for the loader before the head
  is resolved (v1 behavior, matches the current type), or
- the transient state is made explicit: type it `T | undefined` during client-side navigation and document that `head()` re-resolves once the loader signal lands.

I'm reporting this only; I'm not planning to submit a PR.

### Reproduction

<https://github.com/46ki75/qwik-head-resolve-value-repro>

### Steps to reproduce

```bash
pnpm install
pnpm exec playwright-core install chromium   # once
pnpm repro
```

The script starts the dev server and SPA-navigates `/` ⇄ `/other/` with a cold transform cache (it touches the route files between attempts, equivalent to an edit or a fresh server). Output:

```text
attempt 1: spaNav=true resolveValueUndefined=true headNull=true errors=18091 title="Home — /"
  unique errors:
   - TypeError: Failed to construct 'URL': Invalid URL
   - qrl OtherContent_component_... failed to load TypeError: Cannot read properties of null (reading 'appendChild')

BUG REPRODUCED: resolveValue() returned undefined in head() during SPA navigation
```

The route's `head` logs `resolveValue(useUrl) = undefined` (a `console.warn` left in the repro for visibility).

Manual alternative: `pnpm dev`, open the page, and click the "Go to /other/" link **right after the server starts** (cold cache) — a full page reload of `/other/` always works fine, only the SPA navigation crashes.

### System Info

```shell
@qwik.dev/core:   2.0.0-beta.37
@qwik.dev/router: 2.0.0-beta.37
vite:             7.3.2
node:             24.16.0
pnpm:             10.33.0
OS:               Linux (WSL2)
Browser:          Chromium (headless and headed)
```

### Additional Information

- `resolveHead()` → `getData` in `lib/chunks/head.qwik.mjs` returns `loaderState[id].value`, which is `undefined` while the route-loader async
  signal hasn't produced a value.
- Workaround for URL-only cases: use the route location that `head` already receives (`({ url }) => ({ title: url.pathname })`) instead of a loader.
- Workaround for real data loaders: guard and return a partial head; the head re-resolves when the signal lands:

  ```tsx
  export const head: DocumentHead = ({ url, resolveValue }) => {
    const data = resolveValue(useData);
    if (!data) return {}; // transient during SPA navigation
    return { title: data.title };
  };
  ```

- Related but not a duplicate: #4427 (`resolveValue(useAction)` returns `undefined` in `routeLoader$`) — same "resolveValue returns undefined" symptom in a different context (action inside a loader, pre-v2 reactive head).
