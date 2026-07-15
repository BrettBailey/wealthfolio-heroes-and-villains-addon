import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/addon.tsx",
      formats: ["es"],
      fileName: () => "addon.js",
    },
    rollupOptions: {
      // Everything in the SDK's HOST_DEPENDENCIES: the host resolves these at
      // load time. @wealthfolio/ui especially must not be bundled — it pulls in
      // ~63 transitive deps (Radix, motion, react-i18next), and a bundled copy
      // would run against a second, uninitialised i18next context.
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "@tanstack/react-query",
        "@wealthfolio/addon-sdk",
        "@wealthfolio/ui",
        "date-fns",
        "lucide-react",
        "recharts",
      ],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
