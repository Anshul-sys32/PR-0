import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("file:./data/pr-0.db"),
  PR0_WORKSPACE_ROOT: z.string().optional(),
  DEFAULT_AGENT_MODE: z.enum(["ask-first", "supervised", "autonomous"]).default("supervised"),
  DEFAULT_TASK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(900_000),
  MAX_CONCURRENT_TASKS: z.coerce.number().int().min(1).max(32).default(3),
  MAX_TOOL_STEPS_PER_TASK: z.coerce.number().int().min(1).max(40).default(40),
  MAX_RETRIES_PER_TASK: z.coerce.number().int().min(0).max(5).default(3),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().trim().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().trim().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().trim().min(1).optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().trim().min(1).optional()
});
export type Config = z.infer<typeof envSchema>;
export function loadConfig(env = process.env): Config { return envSchema.parse(env); }
