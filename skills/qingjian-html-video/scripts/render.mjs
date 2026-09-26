#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] || ''; };
const listOnly = args.includes('--list');
const server = (option('--server') || 'http://127.0.0.1:8787').replace(/\/$/, '');
if (!/^https:\/\//.test(server) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(server)) throw new Error('远程服务必须使用 HTTPS。');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const token = process.env.QINGJIAN_ADMIN_TOKEN || (await readFile(path.join(repo, 'data', 'admin-token'), 'utf8').catch(() => '')).trim();
if (!token) throw new Error('缺少管理员令牌。请设置 QINGJIAN_ADMIN_TOKEN 或本地 data/admin-token。');
async function api(endpoint, init = {}) {
  const response = await fetch(`${server}${endpoint}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `HTTP ${response.status}`); }
  return response;
}
const catalog = await (await api('/api/admin/effects')).json();
if (listOnly) { for (const item of catalog.effects) console.log(`${item.id}\t${item.name}\t${item.duration}s\t${item.enabled ? 'enabled' : 'disabled'}`); process.exit(0); }
const name = option('--effect');
const effect = catalog.effects.find((item) => item.id === name || item.name === name);
if (!effect) throw new Error('请用 --effect 指定有效模板；运行 --list 查看。');
const output = option('--output');
if (!output) throw new Error('请用 --output 指定 MP4 输出文件。');
const values = {};
for (const [flag, key] of [['--title','title'],['--subtitle','subtitle'],['--eyebrow','eyebrow'],['--image-url','imageUrl']]) { const value = option(flag); if (value) values[key] = value; }
const result = await (await api(`/api/admin/effects/${encodeURIComponent(effect.id)}/render`, { method: 'POST', body: JSON.stringify({ values }) })).json();
const id = result.render.id;
const start = Date.now();
let render;
do {
  await new Promise((resolve) => setTimeout(resolve, 1400));
  render = (await (await api(`/api/admin/effects/renders/${encodeURIComponent(id)}`)).json()).render;
  if (Date.now() - start > 200_000) throw new Error('渲染等待超时，请在后台检查任务。');
} while (render.status === 'running' || render.status === 'queued');
if (render.status !== 'succeeded' || !render.downloadUrl) throw new Error(render.error || '渲染失败。');
const destination = path.resolve(output);
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, Buffer.from(await (await api(render.downloadUrl)).arrayBuffer()));
console.log(destination);
