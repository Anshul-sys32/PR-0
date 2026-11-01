import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { DatabaseService } from "./db.js";
import { loadConfig } from "./config.js";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const db = new DatabaseService(loadConfig().DATABASE_URL); db.close(); console.log("Database initialized.");
