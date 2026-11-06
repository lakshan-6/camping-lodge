import fs from 'node:fs';
import crypto from 'node:crypto';
const path = new URL('../.env', import.meta.url);
let text = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
for (const key of ['AUTH_SECRET', 'SETUP_KEY', 'PAST_ORDER_DELETE_KEY']) {
  const pattern = new RegExp('^' + key + '=(.*)$', 'm');
  const current = text.match(pattern)?.[1]?.trim();
  const validLength = key === 'PAST_ORDER_DELETE_KEY'
    ? current && current.length >= 12 && current.length <= 128
    : current && current.length >= 64;
  if (validLength && !current.startsWith('replace-')) continue;
  const line = key + '=' + crypto.randomBytes(32).toString('hex');
  text = pattern.test(text) ? text.replace(pattern, line) : text + '\n' + line + '\n';
}
fs.writeFileSync(path, text);
console.log('Authentication keys configured in server/.env. Keep this file private.');
