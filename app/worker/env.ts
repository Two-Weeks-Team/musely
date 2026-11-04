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
  /** Default absent/off. Server-only experimental installation; never set by a browser. */
  WORLD_LIFE_MODE?: string;
  JUDGE_MUSE_MODE?: string;
  /** Public judge entry schedule (UTC ISO timestamp); the judge flag must also be enabled. */
  JUDGE_OPEN_UNTIL?: string;
  /** Public in-game AOI only; absent/off disables derived local notices. */
  LOCAL_PERCEPTION_MODE?: string;
  /** Public label only; absent/off retains the legacy world and private routes. */
  SOCIAL_STATUS_MODE?: string;
  /** Confirmed resident persona tendencies only; absent/off retains legacy behavior. */
  RESIDENT_VALUES_MODE?: string;
  /** Private resident continuity; requires confirmed values, actions and split budgets. */
  RESIDENT_REFLECTION_MODE?: string;
  /** Action-completion scheduling is opt-in and requires the protected model ledger. */
  RESIDENT_ACTIONS_MODE?: string;
  RESIDENT_ACTION_MAX_CONCURRENT?: string;
  RESIDENT_CALL_JITTER_MS?:string;
  RESIDENT_FALLBACK_MODE?:string;
  /** Trusted model-budget policy. No browser or Muse can modify these limits. */
  RESIDENT_BUDGET_MODE?: string;
  RESIDENT_MODEL_ENABLED?: string;
  RESIDENT_DAILY_BUDGET_USD?: string;
  INTERACTIVE_DAILY_BUDGET_USD?: string;
  RESIDENT_HOURLY_BUDGET_USD?: string;
  MODEL_PERIOD_BUDGET_USD?: string;
  MODEL_BUDGET_START_AT?: string;
  MODEL_BUDGET_END_AT?: string;
  /** Optional extra hosts allowed as an Origin on /mcp (comma-separated); requests without Origin are allowed. */
  MCP_ALLOWED_ORIGINS?: string;
  // Secrets (wrangler secret put); never in the repository or the client bundle.
  MODEL_API_KEY?: string;
  MODEL_API_KEY_FALLBACK?: string;
  TURNSTILE_SECRET?: string;
  SESSION_SECRET?: string;
  JUDGE_TOKEN?: string;
  /** Owner control (C06): exchanged at POST /api/owner/session for a 1-hour owner session. Not the judge link. */
  OWNER_CONTROL_TOKEN?: string;
  /** The team-controlled demo peer principal's control token (two-owner checks); must differ from OWNER_CONTROL_TOKEN. */
  DEMO_PEER_CONTROL_TOKEN?: string;
  /** The connector directory reviewer principal's control token (G-08); unset disables only the reviewer. Must differ from the others. */
  REVIEWER_CONTROL_TOKEN?: string;
  OWNER_ROOT_JWK?: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
}
