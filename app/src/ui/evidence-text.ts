import {uiText} from './i18n.ts';
// Wording for two event views in the world panel, kept apart from the panel so it can be tested without a DOM:
// why a pending Task was cancelled (an owner revocation or a reviewer Muse reset), and the signed-envelope facts
// (an envelope anonymized by a key purge is the string "[deleted]", not an object).

/** The feed line of a `task_cancelled` event; `a` is the Muse it happened to, `b` the other side. */
export function taskCancelledText(d: {task?: unknown; reason?: unknown} | null | undefined, a: string, b: string) {
  const why = d?.reason === 'muse_reset' ? uiText`${a} was reset by the operators` : uiText`the owner revoked ${a}'s delegation`;
  return uiText`A pending ${d?.task ?? uiText('Task')} with ${b} was cancelled: ${why}`;
}

/** Evidence rows for `data.envelope`: its fields when it is an object, one "deleted" row when a purge replaced it. */
export function envelopeFacts(env: unknown): [string, unknown][] {
  if (env === undefined || env === null || env === '') return [];
  if (typeof env !== 'object') return [[uiText('Signed envelope'), uiText('deleted (the agent key\'s data was deleted)')]];
  const e = env as Record<string, unknown>;
  return [[uiText('Message id'), e.message_id], [uiText('Signer'), e.signer_kind], [uiText('Delegation ref'), e.delegation_ref], [uiText('Scope'), e.scope + ' · ' + e.scope_hash], [uiText('Content hash'), e.content_hash], [uiText('Owner claimed'), String(e.owner_claimed)]];
}
