import { component$ } from "@qwik.dev/core";
import styles from "./other-content.module.css";

export const OtherContent = component$(() => {
  return (
    <p class={styles.box}>
      This component lives in its own lazy chunk and imports a CSS module.
    </p>
  );
});
