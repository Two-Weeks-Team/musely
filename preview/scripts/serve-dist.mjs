// Local static server for browser regressions that matches production transfer: text responses
// (HTML/JS/JSON/CSS) are brotli-compressed like Cloudflare does; GLB/PNG are sent as-is.
// Usage: node scripts/serve-dist.mjs [port=8788]
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {brotliCompressSync, constants} from 'node:zlib';
import {extname, join, normalize} from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname, port = Number(process.argv[2] ?? 8788);
const types = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.ktx2': 'image/ktx2'};
const cache = new Map();
createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const info = await stat(file), key = file + ':' + info.mtimeMs;
    const body = await readFile(file), type = types[extname(file)] ?? 'application/octet-stream';
    const headers = {'content-type': type, 'cache-control': 'no-cache'};
    if (/^(text|application\/json)/.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
      if (!cache.has(key)) cache.set(key, brotliCompressSync(body, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}));
      res.writeHead(200, {...headers, 'content-encoding': 'br'}).end(cache.get(key));
    } else res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${port}/`));
