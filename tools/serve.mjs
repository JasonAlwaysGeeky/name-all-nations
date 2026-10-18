// The local server: the game as static files, never cached, plus the one
// thing a static server cannot do — let the ?guides editor write the view
// boxes straight back into js/views.js. Tune a box on the phone, Save, and the
// file on this machine changes; nothing to copy, nothing to paste.
//
//   npm run serve          (http://localhost:5173, and this machine's LAN address)
//
// The write is deliberately narrow: POST /__views takes a table of boxes,
// and only ever changes the four numbers of a box views.js already has.
// It cannot add a key, touch another file, or run on the live site, which
// is plain GitHub Pages and has no server at all.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const VIEWS = join(ROOT, 'js', 'views.js');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

// Rewrites the numbers of each named box in place, so the file keeps its
// comments, its order and its alignment.
async function saveViews(boxes) {
  let src = await readFile(VIEWS, 'utf8');
  const changed = [];
  for (const [name, box] of Object.entries(boxes)) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) throw new Error(`${name}: not a box`);
    const line = new RegExp(`('${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*)\\[[^\\]]*\\]`);
    if (!line.test(src)) throw new Error(`${name}: not a view in js/views.js`);
    const next = `[${box.map(Math.round).join(', ')}]`;
    src = src.replace(line, (m, head) => { if (!m.endsWith(next)) changed.push(name); return head + next; });
  }
  if (changed.length) await writeFile(VIEWS, src);
  return changed;
}

// --open (start.cmd passes it): once the server is up, open the game in
// Chrome — where voice input works — or the default browser without it.
function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const url = `http://localhost:${PORT}/`;
  if (process.platform !== 'win32') {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const chrome = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(d => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(existsSync);
  if (chrome) spawn(chrome, [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__views') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('too big'); }
      const changed = await saveViews(JSON.parse(body));
      if (changed.length) console.log(`js/views.js: ${changed.join(', ')}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ saved: changed }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith(sep) || path === sep) path = join(path, 'index.html');
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
    res.writeHead(missing ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(missing ? 'Not found' : String(err.message));
  }
}).on('error', (err) => {
  // Already running (the preview pane, another window): that one is serving
  // the same files, so there is nothing to do but say where it is.
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`Already running on http://localhost:${PORT} — that one is serving the game.`);
  openBrowser();
  setTimeout(() => process.exit(0), 500);
}).listen(PORT, () => {
  openBrowser();
  // A phone on the same Wi-Fi reaches the game at this machine's LAN address.
  const lan = Object.values(networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${PORT}`);
  console.log(`Name All Nations on http://localhost:${PORT}`);
  if (lan.length) console.log(`On a phone on this Wi-Fi: ${lan.join('  ')}`);
  console.log('Ctrl+C stops it.');
});
