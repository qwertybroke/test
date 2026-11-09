// Снимки экспортированного GLB в headless Chrome. node tools/shot.mjs <outPrefix> '<json [{name, q}]>'
// Файлы отдаются через перехват запросов: /export/*, /three/*, /tools/*
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
const ROOT = '/tmp/hoplite/workspace/ship';
const out = process.argv[2], shots = JSON.parse(process.argv[3]);
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], protocolTimeout: 600000 });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };
for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    let f = null;
    if (u.pathname.startsWith('/three/')) f = path.join(ROOT, 'node_modules/three', u.pathname.slice(7));
    else f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (f && fs.existsSync(f) && fs.statSync(f).isFile()) req.respond({ status: 200, contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    else req.respond({ status: 404, body: 'nf' });
  });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  const t0 = Date.now();
  await page.goto('http://local/tools/view.html?' + s.q, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, { timeout: 600000, polling: 500 });
  await page.screenshot({ path: `${out}-${s.name}.png` });
  console.log(s.name, (Date.now() - t0) + 'ms', logs.slice(0, 5).join(' | '));
  await page.close();
}
await browser.close();
