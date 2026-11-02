import type {WorldDO} from './world-do.ts';

export interface Env {
  ASSETS: Fetcher;
  WORLD: DurableObjectNamespace<WorldDO>;
  BURST?: RateLimit;
  MODEL_ID: string;
  MODEL_BASE: string;
  DAILY_BUDGET_USD: string;
  TURNSTILE_SITEKEY: string;
  ALLOWED_HOSTS: string;
  /** Canonical public origin of this deployment (Agent Cards, MCP page, claim text). */
  PUBLIC_ORIGIN: string;
  /** Optional extra hosts allowed as an Origin on /mcp (comma-separated); requests without Origin are allowed. */
  MCP_ALLOWED_ORIGINS?: string;
  // Secrets (wrangler secret put); never in the repository or the client bundle.
  MODEL_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  SESSION_SECRET?: string;
  JUDGE_TOKEN?: string;
  /** Owner control (C06): exchanged at POST /api/owner/session for a 1-hour owner session. Not the judge link. */
  OWNER_CONTROL_TOKEN?: string;
  /** The team-controlled demo peer principal's control token (two-owner checks); must differ from OWNER_CONTROL_TOKEN. */
  DEMO_PEER_CONTROL_TOKEN?: string;
  OWNER_ROOT_JWK?: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
}
