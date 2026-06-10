import { defineConfig } from "vite";
import { qwikVite } from "@qwik.dev/core/optimizer";
import { qwikRouter } from "@qwik.dev/router/vite";

export default defineConfig(() => {
  return {
    plugins: [qwikRouter(), qwikVite()],
  };
});
