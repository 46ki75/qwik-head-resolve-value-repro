import { component$ } from "@qwik.dev/core";
import { type DocumentHead, Link, routeLoader$ } from "@qwik.dev/router";

// A loader whose value the `head` function consumes — the pattern shown in
// the official docs for dynamic <title> / og: tags.
export const useUrl = routeLoader$(({ url }) => url.toString());

export const head: DocumentHead = ({ resolveValue }) => {
  const url = resolveValue(useUrl);
  console.warn("[home head] resolveValue(useUrl) =", JSON.stringify(url));

  // During client-side (SPA) navigation `url` is transiently `undefined`,
  // even though the type of `resolveValue` says it returns `string`.
  // This throws "Failed to construct 'URL': Invalid URL".
  const parsed = new URL(url);

  return {
    title: `Home — ${parsed.pathname}`,
    meta: [{ property: "og:url", content: url }],
  };
};

export default component$(() => {
  return (
    <main>
      <h1>Home</h1>
      <p>
        Click the link below (client-side navigation) and watch the console.
      </p>
      <Link href="/other/" prefetchBundle="off" prefetchData="off">
        Go to /other/
      </Link>
      <br />
      <Link href="/crash/" prefetchBundle="off" prefetchData="off">
        Go to /crash/ (head() throws deliberately — bug 2 in isolation)
      </Link>
    </main>
  );
});
