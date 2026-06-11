Title: [🐞] V2 An exception thrown in `head()` during SPA navigation removes the `<head>` element and wedges QRL loading in an infinite retry loop (v2)

### Which component is affected?

Qwik Runtime

(The head re-render is driven by Qwik City / `@qwik.dev/router`; the `<head>` destruction and the QRL retry loop are in Qwik Core.)

### Describe the bug

If a route's `head()` function throws during **client-side (SPA) navigation**, Qwik's head re-render aborts mid-flight and leaves the document with **no `<head>` element at all** — `document.head === null` from that point on.

The fallout cascades:

1. In dev mode, every QRL chunk that imports CSS now fails to load: Vite's injected `updateStyle` calls `document.head.appendChild(...)` and throws `TypeError: Cannot read properties of null (reading 'appendChild')`.
2. Qwik does not cache the rejected QRL import (`LazyRef.$setRef$` resets `$ref$` to `null` on rejection, "we can try again later"), so the failed chunk is retried in a tight loop (~every 250 ms), forever. The console accumulates **tens of thousands of errors within seconds** and the page is permanently wedged — no styles, no further interactivity, navigation dead.

A user-code exception in a head function arguably shouldn't be able to destroy the document or hang the app. Note this is easy to hit accidentally: a companion issue ("`resolveValue()` returns `undefined` inside `head()` during SPA navigation") shows the router itself handing `head()` an `undefined` loader value, so any non-defensive head function ends up here.

**Expected behavior:**

- An exception in `head()` is contained: log it, keep (or restore) the previous `<head>` element, and continue. The document must never be left without a `<head>`.
- A QRL whose import keeps failing should back off or give up rather than retry in an unbounded tight loop.

I'm reporting this only; I'm not planning to submit a PR.

### Reproduction

<https://github.com/46ki75/qwik-head-resolve-value-repro>

### Steps to reproduce

The `/crash/` route isolates this bug deterministically — its `head()` throws on the client unconditionally, no timing involved:

```tsx
export const head: DocumentHead = () => {
  if (!isServer) {
    throw new Error("deliberate error in head()");
  }
  return { title: "Crash" };
};
```

```bash
pnpm install
pnpm exec playwright-core install chromium   # once
pnpm repro:crash
```

Output (single SPA navigation `/` → `/crash/`):

```text
attempt 1: spaNav=true headNull=true errors=33794 title="Home — /"
  unique errors:
   - Error: deliberate error in head()
   - qrl OtherContent_component_... failed to load TypeError: Cannot read properties of null (reading 'appendChild')
   - TypeError: Cannot read properties of null (reading 'appendChild')

BUG REPRODUCED: an exception thrown in head() during SPA navigation removed <head> and wedged QRL loading.
```

Manual alternative: `pnpm dev`, click the "/crash/" link, watch `document.head` become `null` in the console and the error loop start. A full page reload (SSR) of `/crash/` renders fine — only the client-side head re-render is affected.

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

- The retry loop lives in `LazyRef.$setRef$` (`@qwik.dev/core`, `qrl-class`): on rejection it logs `qrl <symbol> failed to load` and resets the ref so the next render attempt re-imports — with a permanently broken document, that never converges.
- The two issues compound: the companion bug supplies the exception, this bug turns it into a full page failure. Fixing either materially reduces the severity of the other, but both are worth fixing independently.
- Related but not a duplicate: #8634 (QRL chunks fail to load on cold Vite dev SSR) shares the `qrl ... failed to load` + retry-loop tail, but its root cause is Vite dep-optimization returning `504 Outdated Optimize Dep`, not a `null` `document.head`.
