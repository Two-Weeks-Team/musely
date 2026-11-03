/** Lossless transport for the two existing critical GLBs. Raw URLs/decoded bytes stay unchanged. */
type Encoding = 'br' | 'gzip' | 'identity';
const PATHS = new Set(['/character-kit/runtime/base/lod2.glb', '/character-kit/runtime/base/clips.glb']);
export function selectEncoding(header: string | null): {encoding: Encoding | null; identity: boolean} {
  if (!header?.trim()) return {encoding: 'identity', identity: true};
  const weights = new Map<string, number>();
  for (const item of header.split(',')) {
    const match = /^\s*([!#$%&'*+.^_`|~0-9a-z-]+)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(item);
    if (!match || weights.has(match[1].toLowerCase())) return {encoding: null, identity: false};
    weights.set(match[1].toLowerCase(), Number(match[2] ?? 1));
  }
  const identity = (weights.get('identity') ?? (weights.get('*') === 0 ? 0 : 1)) > 0;
  const candidates: [Encoding, number][] = [['br', weights.get('br') ?? weights.get('*') ?? 0], ['gzip', weights.get('gzip') ?? weights.get('*') ?? 0], ['identity', weights.get('identity') ?? 0]];
  candidates.sort((a, b) => b[1] - a[1]);
  return {encoding: candidates[0][1] > 0 ? candidates[0][0] : identity ? 'identity' : null, identity};
}
function varied(response: Response, encoding?: 'br' | 'gzip'): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get('vary');
  if (vary !== '*' && !vary?.split(',').some(v => v.trim().toLowerCase() === 'accept-encoding')) headers.set('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  if (encoding && (response.status === 200 || response.status === 304)) {
    headers.set('content-encoding', encoding);
    headers.set('content-type', 'model/gltf-binary');
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers, encodeBody: 'manual'});
}
const notAcceptable = () => new Response(null, {status: 406, headers: {vary: 'Accept-Encoding', 'cache-control': 'no-store'}});
export async function serveCriticalAsset(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const url = new URL(request.url);
  if (!PATHS.has(url.pathname) || /[?#]/.test(request.url) || !['GET', 'HEAD'].includes(request.method)) return assets.fetch(request);
  // The edge normalizes Accept-Encoding. Its documented original client value retains q=0/identity.
  const original = request.cf?.clientAcceptEncoding;
  const selected = selectEncoding(typeof original === 'string' ? original : request.headers.get('accept-encoding'));
  if (!selected.encoding) return notAcceptable();
  // Byte ranges and If-Range retain the existing raw representation/ETag semantics.
  if (request.headers.has('range') || request.headers.has('if-range')) return selected.identity ? varied(await assets.fetch(request)) : notAcceptable();
  if (selected.encoding === 'identity') return varied(await assets.fetch(request));
  url.pathname += selected.encoding === 'br' ? '.br' : '.gz';
  const response = await assets.fetch(new Request(url, request));
  if (response.status !== 404) return varied(response, selected.encoding);
  await response.body?.cancel();
  return selected.identity ? varied(await assets.fetch(request)) : notAcceptable();
}
