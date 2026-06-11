Title: [🐞] V2 `resolveValue()` returns `undefined` inside `head()` during SPA navigation, violating its type (v2)

### Which component is affected?

Qwik City (routing)

### Describe the bug

Reading a route loader from a `head` function via `resolveValue()` — the typed, intended way to read loader data in `head` (`DocumentHeadProps.resolveValue`), and the documented pattern for dynamic `<title>` / OG tags in v1 — can return `undefined` during **client-side (SPA) navigation**, even though `ResolveSyncValue`'s loader overload promises the loader's value (`Awaited<T>`, not `Awaited<T> | undefined`).

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
System:
  OS: Linux 6.6 Ubuntu 24.04.4 LTS 24.04.4 LTS (Noble Numbat)
  CPU: (16) x64 Intel(R) Core(TM) Ultra 7 255H
  Memory: 11.95 GB / 15.31 GB
  Container: Yes
  Shell: 5.2.21 - /bin/bash
Binaries:
  Node: 24.14.1 - /home/ikuma/.volta/tools/image/node/24.14.1/bin/node
  npm: 11.11.0 - /home/ikuma/.volta/tools/image/node/24.14.1/bin/npm
  pnpm: 10.33.0 - /home/ikuma/.volta/bin/pnpm
Browsers:
  Chrome: 148.0.7778.167
npmPackages:
  typescript: 5.8.3 => 5.8.3
  vite: 7.3.2 => 7.3.2
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
