import "dotenv/config";
import { DatabaseService } from "./db.js";
import { loadConfig } from "./config.js";
const db = new DatabaseService(loadConfig().DATABASE_URL); db.close(); console.log("Database initialized.");
