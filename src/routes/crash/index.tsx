import { component$, isServer } from "@qwik.dev/core";
import { type DocumentHead, Link } from "@qwik.dev/router";
import { OtherContent } from "../../components/other-content";

// Demonstrates bug 2 in isolation, with no timing dependence: ANY exception
// thrown by a head() function during client-side navigation removes the
// document's <head> element and wedges QRL loading.
export const head: DocumentHead = () => {
  if (!isServer) {
    throw new Error("deliberate error in head()");
  }
  return { title: "Crash" };
};

export default component$(() => {
  return (
    <main>
      <h1>Crash</h1>
      {/* lazy chunk importing a CSS module — fails to load once <head> is
          gone, and Qwik retries it forever */}
      <OtherContent />
      <Link href="/">Back to /</Link>
    </main>
  );
});
