/// <reference types="@qwik.dev/core" />

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
