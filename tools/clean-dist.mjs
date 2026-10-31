import { readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DIST = resolve('dist');
let n = 0;

await rm(join(DIST, '.prerender'), { recursive: true, force: true })
  .then(() => n++)
  .catch(() => {});

for (const name of await readdir(DIST).catch(() => [])) {
  if (name.endsWith('.mjs')) {
    await rm(join(DIST, name), { force: true });
    n++;
  }
}

console.log(`[clean] 清掉 ${n} 项构建中间产物`);

/**
 * 收藏条目防泄漏自检。
 *
 * 背景：EdgeOne 对 .html 默认缓存 2 小时，收藏链接一旦在构建期进了 HTML，
 * 就等于明文上了 CDN。收藏数据只允许在浏览器里运行时解密。
 * CI 上没有 vault.plain.json（已 gitignore），ENOENT 时自动跳过。
 */
async function walkHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_astro') continue;
      out.push(...(await walkHtml(full)));
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

try {
  const plain = JSON.parse(await readFile(resolve('vault.plain.json'), 'utf8'));
  const needles = (plain.items ?? []).map((it) => String(it?.url ?? '').trim()).filter(Boolean);
  const files = await walkHtml(DIST);
  const hits = [];

  for (const file of files) {
    const body = await readFile(file, 'utf8');
    needles.forEach((needle, i) => {
      if (body.includes(needle)) hits.push(`${file} ← 第 ${i + 1} 条收藏链接`);
    });
  }

  if (hits.length) {
    console.error('[guard] 收藏条目出现在构建产物里（会被 CDN 缓存成明文）:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log(`[guard] 扫了 ${files.length} 个 HTML，没有收藏链接泄漏`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
