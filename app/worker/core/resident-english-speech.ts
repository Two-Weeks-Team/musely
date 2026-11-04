/** Bounded deterministic public-speech guard, not a complete language identifier.
 * Known public names/places may use any script. Reject other non-Latin letters and a
 * small set of unmistakable non-English greetings; arbitrary Latin-script languages,
 * transliteration and code-switching still require the post-deploy human audit.
 * No model call, translation, private memory or replacement of personal speech.
 */
export const PUBLIC_SPEECH_NOT_ENGLISH='public_speech_not_english';
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const foreignGreeting=/\b(?:bonjour|bonsoir|salut|merci|hola|gracias|adios|guten\s+(?:tag|morgen|abend)|danke|ciao|grazie|obrigad[oa]|ola|au\s+revoir)\b/iu;
export function nonEnglishResidentSpeech(text:string,publicNames:readonly string[]=[]):boolean {
 let rest=text.normalize('NFC');
 for(const name of [...new Set(publicNames)].filter(x=>x.length>0&&x.length<=100).sort((a,b)=>b.length-a.length)){
  rest=rest.replace(new RegExp('(?<![\\p{L}\\p{N}_])'+escape(name.normalize('NFC'))+'(?![\\p{L}\\p{N}_])','gu'),' ');
 }
 for(const letter of rest.match(/\p{L}/gu)??[])if(!/\p{Script=Latin}/u.test(letter))return true;
 return foreignGreeting.test(rest.normalize('NFD').replace(/\p{M}/gu,''));
}
