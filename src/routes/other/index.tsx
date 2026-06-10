import { component$ } from "@qwik.dev/core";
import { type DocumentHead, Link, routeLoader$ } from "@qwik.dev/router";
import { OtherContent } from "../../components/other-content";

export const useUrl = routeLoader$(async ({ url }) => {
  // Simulate a realistic backend call (DB / API).
  await new Promise((r) => setTimeout(r, 200));
  return url.toString();
});

export const head: DocumentHead = ({ resolveValue }) => {
  const url = resolveValue(useUrl);
  console.warn("[other head] resolveValue(useUrl) =", JSON.stringify(url));

  // Same pattern as the home route — throws during SPA navigation because
  // `url` is `undefined` until the loader's async signal resolves.
  const parsed = new URL(url);

  return {
    title: `Other — ${parsed.pathname}`,
    meta: [{ property: "og:url", content: url }],
  };
};

export default component$(() => {
  return (
    <main>
      <h1>Other</h1>
      {/* OtherContent is a separate lazy chunk that imports a CSS module.
          After the head() exception destroys the <head> element, loading
          this chunk fails in Vite's updateStyle (document.head is null)
          and Qwik retries it forever. */}
      <OtherContent />
      <Link href="/">Back to /</Link>
    </main>
  );
});
