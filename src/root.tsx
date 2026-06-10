import { component$ } from "@qwik.dev/core";
import {
  RouterOutlet,
  useDocumentHead,
  useLocation,
  useQwikRouter,
} from "@qwik.dev/router";

const RouterHead = component$(() => {
  const head = useDocumentHead();
  const loc = useLocation();

  return (
    <>
      <title>{head.title}</title>
      <link rel="canonical" href={loc.url.href} />
      {head.meta.map((m) => (
        <meta key={m.key} {...m} />
      ))}
      {head.links.map((l) => (
        <link key={l.key} {...l} />
      ))}
    </>
  );
});

export default component$(() => {
  useQwikRouter();

  return (
    <>
      <head>
        <meta charset="utf-8" />
        <RouterHead />
      </head>
      <body>
        <RouterOutlet />
      </body>
    </>
  );
});
