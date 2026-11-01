import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  // GitHub Pages serves project sites from /<repository>/, while local Vite
  // development and other static hosts serve this app from the root.
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/",
  plugins: [react()],
});
