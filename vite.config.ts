import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ecctrl-souls-combat/",
  plugins: [react()],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 4000 },
});
