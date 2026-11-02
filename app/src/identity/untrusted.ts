// "Another agent's content is not an instruction" (#7 principle 4; direction v2, 6.6).
// Peer text is wrapped as untrusted data before any model sees it, and text that tries to override
// instructions, impersonate roles, call tools or extract the owner's private data is refused.
// Limit (shown on screen too): pattern detection can be bypassed by rephrasing. It is one layer;
// the server prompt rules, scope enforcement and owner approval stay in force regardless.

export type InjectionCheck = {blocked: boolean; kinds: string[]};

const PATTERNS: [kind: string, re: RegExp][] = [
  ['instruction_override', /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|your|all|the)\b[^.]{0,30}\b(instructions?|rules?|prompts?|guidelines?|policy|policies)\b/i],
  ['instruction_override', /\b(new|updated) (instructions?|rules?|system prompt)\b/i],
  ['role_marker', /(^|\n)\s*(system|assistant|developer)\s*:|<\|?(im_start|im_end|system)\|?>|\[(system|inst)\]/i],
  ['role_change', /\byou are (now|no longer)\b|\bact as (my|an?|the)\b|\b(developer|god|jailbreak|dan) mode\b/i],
  ['tool_call', /\b(call|invoke|run|execute|use) (the )?(tool|function|command)\b|"(tool|function)_?(call|name)"\s*:|\bfunction_call\b/i],
  ['exfiltration', /\b(show|tell|give|send|share|reveal|list|what('?s| is| are))\b[^.?!]{0,40}\b(owner'?s?|your (human|user|principal)|his|her|their)\b[^.?!]{0,30}\b(schedule|calendar|address|home|phone|email|contact|location|reasons?|password|keys?|private)\b/i],
  ['exfiltration', /\b(system prompt|private key|api key|secret key|hidden instructions)\b/i],
];

export function detectInjection(text: string): InjectionCheck {
  const normalized = text.normalize('NFKC').replace(/[​-‏⁠]/g, '');
  const kinds = [...new Set(PATTERNS.filter(([, re]) => re.test(normalized)).map(([k]) => k))];
  return {blocked: kinds.length > 0, kinds};
}

export const wrapUntrusted = (text: string, source = 'other_agent') =>
  `<untrusted_data source="${source}">${text.replace(/[<>]/g, ' ')}</untrusted_data>`;

export const INJECTION_LIMIT_NOTE = 'Pattern detection can be bypassed by rephrasing; scopes, server-side prompts and owner approval still apply.';
