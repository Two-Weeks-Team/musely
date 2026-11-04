// Local static server for browser regressions that matches production transfer: text responses
// (HTML/JS/JSON/CSS) are brotli-compressed like Cloudflare does; GLB/PNG are sent as-is.
// Usage: node scripts/serve-dist.mjs [port=8788] [--api https://musely.net]
// --api forwards /api/* and /.well-known/jwks/* (GET only) to a deployed Worker so the local UI shows real data.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {brotliCompressSync, constants} from 'node:zlib';
import {extname, join, normalize} from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname, port = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 8788);
const apiAt = process.argv.indexOf('--api'), api = apiAt > 0 ? process.argv[apiAt + 1] : null;
const types = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2'};
const cache = new Map();
createServer(async (req, res) => {
  try {
    if (api && /^\/(api\/|\.well-known\/jwks\/)/.test(req.url) && req.method === 'GET') {
      const r = await fetch(api + req.url, {headers: {accept: 'application/json'}});
      res.writeHead(r.status, {'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store'}).end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const judgeEntry=path==='/judge';
    if(judgeEntry){if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD','cache-control':'no-store'}).end();return;}path='/';}
    let file = join(root, path);
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    else if (!extname(file) && !(await stat(file).catch(() => null))) file += '.html';
    const info = await stat(file), key = file + ':' + info.mtimeMs;
    const body = await readFile(file), type = types[extname(file)] ?? 'application/octet-stream';
    const headers = {'content-type': type, 'cache-control': judgeEntry?'no-store':'no-cache'};
    if (/^(text|application\/json)/.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
      if (!cache.has(key)) cache.set(key, brotliCompressSync(body, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}));
      res.writeHead(200, {...headers, 'content-encoding': 'br'}).end(cache.get(key));
    } else res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${port}/`));
