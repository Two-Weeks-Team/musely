// The single shared world Durable Object. In this step it owns the budget and quota ledger;
// the heartbeat, commit point and run log join it in later steps (direction v2, 8.7).
import {DurableObject} from 'cloudflare:workers';
import {Ledger, type ReserveRequest, type Outcome, type Tier} from './core/ledger.ts';
import type {Env} from './env.ts';

export class WorldDO extends DurableObject<Env> {
  private ledger: Ledger;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new Ledger(ctx.storage.sql, {dailyCapUsd: Number(env.DAILY_BUDGET_USD) || 20});
    ctx.blockConcurrencyWhile(async () => this.ledger.init());
  }
  reserve(r: ReserveRequest) { return this.ledger.reserve(r); }
  settle(id: string, costUsd: number, outcome: Outcome) { return this.ledger.settle(id, costUsd, outcome); }
  status() { this.ledger.prune(); return this.ledger.status(); }
  quota(session: string, tier: Tier) { return this.ledger.quotaFor(session, tier); }
}
