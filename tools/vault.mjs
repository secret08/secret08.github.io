#!/usr/bin/env node
/**
 * 收藏加密工具
 *
 * 用法：
 *   node tools/vault.mjs init          首次初始化（设密码 + 生成示例条目 + 加密）
 *   node tools/vault.mjs edit          用 $EDITOR 编辑明文清单（vault.plain.json）
 *   node tools/vault.mjs encrypt       把 vault.plain.json 加密成 public/vault.enc
 *   node tools/vault.mjs decrypt       把 public/vault.enc 解密回 vault.plain.json
 *   node tools/vault.mjs add 标题 URL 描述   追加一条
 *   node tools/vault.mjs list          查看明文条目
 *
 * 密码来源（按优先级）：--password 参数 > 环境变量 VAULT_PASSWORD > 交互输入
 * 明文文件 vault.plain.json 已在 .gitignore 中，不会进入仓库。
 */
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAIN = path.join(ROOT, 'vault.plain.json');
const CIPHER = path.join(ROOT, 'public', 'vault.enc');

const ITER = 600000;
const KDF = 'PBKDF2-SHA256';
const VERSION = 1;

const SAMPLE = {
  items: [
    {
      title: '示例 · 内网面板',
      url: 'https://example.com/panel',
      desc: '改成你自己不想公开的链接',
    },
    { title: '示例 · 备用邮箱', url: 'https://mail.example.com', desc: '' },
  ],
};

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const ok = (message) => console.log(`✓ ${message}`);

function readPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(buf);
    };
    // 注意：必须逐字符处理。粘贴密码时终端会把「整串 + 回车」作为一个 chunk 送进来，
    // 只要整串不等于单个换行符就会被整个拼进密码里，导致密文用的密码和用户以为的不一致。
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          finish();
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          buf = buf.slice(0, -1);
        } else if (ch >= ' ') {
          buf += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function getPassword(flagValue, confirm = false) {
  if (flagValue) return flagValue;
  if (process.env.VAULT_PASSWORD) return process.env.VAULT_PASSWORD;

  const first = await readPassword('密码：');
  if (!first) die('密码不能为空');

  if (confirm) {
    const second = await readPassword('再输一次：');
    if (first !== second) die('两次输入不一致');
    if (first.length < 10) die('请用至少 10 位的密码 —— 这是唯一一道防线');
  }
  return first;
}

const b64 = (buf) => buf.toString('base64');

function encrypt(plainObject, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, ITER, 32, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plainObject), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    v: VERSION,
    kdf: KDF,
    iter: ITER,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(Buffer.concat([body, tag])),
  };
}

function decrypt(payload, password) {
  if (payload.v !== VERSION) die(`密文版本不支持：${payload.v}`);
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const combined = Buffer.from(payload.ct, 'base64');

  const tag = combined.subarray(combined.length - 16);
  const body = combined.subarray(0, combined.length - 16);
  const key = pbkdf2Sync(password, salt, payload.iter, 32, 'sha256');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function readPlain() {
  if (!existsSync(PLAIN)) {
    die('找不到 vault.plain.json，先跑 node tools/vault.mjs init 或 decrypt');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(PLAIN, 'utf8'));
  } catch {
    die('vault.plain.json 不是合法 JSON');
  }
  if (!Array.isArray(parsed.items)) parsed.items = [];
  return parsed;
}

function writeCipher(plain) {
  const result = encrypt(plain, globalThis.__password);
  writeFileSync(CIPHER, JSON.stringify(result, null, 2), 'utf8');
  ok(`已写入 public/vault.enc（${plain.items.length} 条，${Math.round(JSON.stringify(result).length / 1024)} KB）`);
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const command = process.argv[2] || 'help';
const flagPassword = argValue('--password');

switch (command) {
  case 'init': {
    if (existsSync(CIPHER) && !process.argv.includes('--force')) {
      die('public/vault.enc 已存在。要重建请加 --force（会覆盖现有密文）');
    }
    globalThis.__password = await getPassword(flagPassword, true);
    if (!existsSync(PLAIN)) {
      writeFileSync(PLAIN, JSON.stringify(SAMPLE, null, 2), 'utf8');
      ok('已生成 vault.plain.json（含示例条目，记得改）');
    }
    writeCipher(readPlain());
    console.log('\n下一步：把 npm run vault encrypt 的产物提交到仓库即可。');
    break;
  }

  case 'encrypt': {
    globalThis.__password = await getPassword(flagPassword, false);
    writeCipher(readPlain());
    break;
  }

  case 'decrypt': {
    if (!existsSync(CIPHER)) die('public/vault.enc 不存在');
    const password = await getPassword(flagPassword, false);
    const payload = JSON.parse(readFileSync(CIPHER, 'utf8'));
    let plain;
    try {
      plain = decrypt(payload, password);
    } catch {
      die('密码不对，或密文已损坏');
    }
    writeFileSync(PLAIN, JSON.stringify(plain, null, 2), 'utf8');
    ok(`已解密到 vault.plain.json（${plain.items.length} 条）`);
    break;
  }

  case 'edit': {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    if (!existsSync(PLAIN)) die('找不到 vault.plain.json，先跑 decrypt');
    const child = spawn(editor, [PLAIN], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) ok('明文已保存，记得跑 encrypt 重新加密');
    });
    break;
  }

  case 'add': {
    const [, , , title, url, desc] = process.argv;
    if (!title || !url) die('用法：node tools/vault.mjs add 标题 URL [描述]');
    const plain = readPlain();
    plain.items.push({ title, url, desc: desc || '' });
    writeFileSync(PLAIN, JSON.stringify(plain, null, 2), 'utf8');
    ok(`已追加：${title}（共 ${plain.items.length} 条，记得跑 encrypt）`);
    break;
  }

  case 'list': {
    const plain = readPlain();
    if (plain.items.length === 0) {
      console.log('（空）');
    } else {
      plain.items.forEach((item, i) => {
        console.log(`${i + 1}. ${item.title}  ${item.url}${item.desc ? `  — ${item.desc}` : ''}`);
      });
    }
    break;
  }

  default:
    console.log(`收藏加密工具

  node tools/vault.mjs init        首次初始化
  node tools/vault.mjs edit        编辑明文清单
  node tools/vault.mjs encrypt     重新加密
  node tools/vault.mjs decrypt     解密回明文
  node tools/vault.mjs add 标题 URL [描述]
  node tools/vault.mjs list        查看条目

  可选：--password 你的密码（或设 VAULT_PASSWORD 环境变量）
`);
}
