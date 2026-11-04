// Fixed diagnostic vocabulary only. Never retain provider messages, request URLs or identity data.
export const PERSONAL_AUTH_REASONS = ['token_exchange_http_4xx','token_exchange_http_5xx','token_exchange_failed','me_fetch_failed','session_store_failed','session_sign_failed','state_invalid','auth_code_invalid','provider_declined'] as const;
export type PersonalAuthReason = typeof PERSONAL_AUTH_REASONS[number];
export type PersonalAuthFailure = {reason: PersonalAuthReason; metaCode?: number; metaSubcode?: number};
export const isPersonalAuthReason = (v: unknown): v is PersonalAuthReason => typeof v === 'string' && (PERSONAL_AUTH_REASONS as readonly string[]).includes(v);
const numericCode = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
export function personalAuthFailure(reason: PersonalAuthReason, code?: unknown, subcode?: unknown): PersonalAuthFailure {
  return {reason: isPersonalAuthReason(reason) ? reason : 'token_exchange_failed', ...(numericCode(code) ? {metaCode: code} : {}), ...(numericCode(subcode) ? {metaSubcode: subcode} : {})};
}
