import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://elfaraoncatering.com.ar",
  vite: {
    plugins: [tailwindcss()],
  },
});
