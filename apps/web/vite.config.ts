import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const apiTarget = process.env.PR0_WEB_API_TARGET ?? "http://127.0.0.1:5000";
export default defineConfig({ plugins: [react()], server: { port: 5173, host: "127.0.0.1", proxy: { "/api": apiTarget, "/health": apiTarget } } });
