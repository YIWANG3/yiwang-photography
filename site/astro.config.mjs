import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://yiwang.photography",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "always" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
