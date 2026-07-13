/*
  import-shop.mjs — import garments from online-shop product pages into "Style Me".

  WHAT IT DOES
    You give it product URLs (Zara, COS, Uniqlo, wherever). It fetches each page,
    asks the AI to pull out the brand / name / colour / category, grabs the product
    image, and writes a file called  shop-import.json.
    You then open the app -> Settings -> "Import backup (merge)" and pick that file.
    The garments land in your active closet.

  REQUIREMENTS
    - Node.js 18+   (check:  node --version)
    - Your Anthropic API key.

  HOW TO USE
    1) Put the product links in a file called  links.txt  (one URL per line),
       in the same folder as this script. Lines starting with # are ignored.

    2) In a terminal, go to this folder:
         cd "C:\\Users\\...\\Style Me"

    3) Set your key:
         PowerShell:   $env:ANTHROPIC_API_KEY="sk-ant-...your-full-key..."
         cmd:          set ANTHROPIC_API_KEY=sk-ant-...your-full-key...

    4) Run:
         node import-shop.mjs

    5) It writes  shop-import.json  in this folder.
       In the app: Settings -> Backup & restore -> "Import backup (merge)" -> pick it.

  HONEST LIMITS
    - Some shops block scripts (bot protection). Those URLs will be skipped with a
      message — for those, just screenshot the product and add it in the app as a
      normal photo; the AI reads it fine.
    - The product image is embedded, so the file can get big with many items.
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('\n  Missing API key. Set ANTHROPIC_API_KEY first (see notes at the top).\n');
  process.exit(1);
}

if (!existsSync('links.txt')) {
  console.error('\n  No links.txt found. Create it next to this script, one product URL per line.\n');
  process.exit(1);
}

const links = readFileSync('links.txt', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (!links.length) {
  console.error('\n  links.txt is empty.\n');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function askAI(content, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const d = await res.json();
  return (d.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function parseJSON(t) {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[0]);
}

const items = [];

for (const url of links) {
  console.log('\n→ ' + url);

  let html;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    html = await r.text();
  } catch (e) {
    console.log('   skipped (the shop blocked the request: ' + e.message + ')');
    console.log('   tip: screenshot the product page and add it in the app as a photo instead.');
    continue;
  }

  // Keep the informative part of the page: <head> metadata is where product info lives.
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const snippet = (head + html.replace(/<script[\s\S]*?<\/script>/gi, '')).slice(0, 18000);

  let info;
  try {
    const txt = await askAI(
      'This is the HTML of an online-shop product page for a clothing item. Extract the product details. ' +
        'Reply with ONLY a JSON object, no markdown. Keys: brand, subtype (short description, e.g. "white cotton shirt"), ' +
        'color (plain word), colorHex (hex string), category (one of Top, Bottom, Dress, Outerwear, Shoes, Accessory), ' +
        'formality (Casual, Smart or Formal), season (Any, Warm or Cold), image (the absolute URL of the main product image). ' +
        'HTML:\n' + snippet,
      600
    );
    info = parseJSON(txt);
  } catch (e) {
    console.log('   skipped (could not read the page: ' + e.message + ')');
    continue;
  }

  let photo = '';
  if (info.image) {
    try {
      const ir = await fetch(info.image, { headers: { 'user-agent': UA } });
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer());
        const type = ir.headers.get('content-type') || 'image/jpeg';
        photo = 'data:' + type + ';base64,' + buf.toString('base64');
      }
    } catch (_) {}
  }
  if (!photo) {
    console.log('   skipped (no product image could be downloaded)');
    continue;
  }

  const item = {
    id: 'it_' + Date.now() + '_' + Math.floor(Math.random() * 1e5),
    photo,
    orig: photo,
    category: info.category || 'Top',
    brand: info.brand || '',
    subtype: info.subtype || '',
    color: info.color || '',
    colorHex: info.colorHex || '#b8b2a6',
    formality: info.formality || 'Casual',
    season: info.season || 'Any',
    source: url,
  };
  items.push(item);
  console.log('   ✓ ' + (item.brand ? item.brand + ' — ' : '') + (item.subtype || item.category));
}

if (!items.length) {
  console.error('\n  Nothing could be imported. Try the screenshot route instead.\n');
  process.exit(1);
}

const out = {
  app: 'ensemble',
  v: 2,
  date: new Date().toISOString(),
  items,
  saved: [],
};

writeFileSync('shop-import.json', JSON.stringify(out));

console.log('\n  Wrote shop-import.json with ' + items.length + ' item(s).');
console.log('  In the app: Settings -> Backup & restore -> "Import backup (merge)" -> pick this file.\n');
