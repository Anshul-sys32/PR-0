import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const config = loadConfig(); const app = await createApp(config);
await app.listen({ host: config.HOST, port: config.PORT });
