// Keep the page's no-referrer policy for resources, but send a usable same-origin Origin on WebKit API writes.
export function apiRequestInit<T extends RequestInit>(init:T):T&{referrerPolicy:'same-origin'};
export function apiRequestInit(init?:RequestInit):RequestInit;
export function apiRequestInit(init?:RequestInit):RequestInit{return {...init,referrerPolicy:'same-origin'};}
export const apiFetch:typeof fetch=(input,init)=>fetch(input,apiRequestInit(init));
/** Injected transports receive the same policy as the native fetch path. */
export const apiFetcher=(transport:typeof fetch=apiFetch):typeof fetch=>(input,init)=>transport(input,apiRequestInit(init));
