/**
 * 首页「收藏」分区的全部客户端逻辑：取密文 → WebCrypto 解密 → 就地渲染卡片。
 *
 * 只在浏览器执行，绝不参与构建期渲染 —— 收藏条目不允许进 HTML，
 * 否则会被 CDN 缓存成明文（EdgeOne 对 .html 默认缓存 2 小时）。
 */
import { VAULT_FILE } from '../config';

type VaultItem = { title?: string; url?: string; desc?: string };
type VaultPayload = {
  v?: number;
  kdf?: string;
  iter?: number;
  salt?: string;
  iv?: string;
  ct?: string;
};

const KEY_STORE = 'vault-key'; // 存的是导出的 AES-GCM 原始密钥（base64），不是密码
const TEXT = new TextEncoder();
const DEC = new TextDecoder();

const b64ToU8 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const u8ToB64 = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 1) s += String.fromCharCode(u8[i]);
  return btoa(s);
};

/** 与 BookmarkCard.astro 同逻辑，抽到这里给运行时渲染复用 */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** 解密出来的数据同样不可信：只放行 http(s)，挡住 javascript: 之类 */
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '#');

const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
};

const saveKey = (value: string) => {
  try {
    localStorage.setItem(KEY_STORE, value);
  } catch {}
};

const dropKey = () => {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {}
};

const fetchPayload = async (): Promise<VaultPayload> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res: Response;
  try {
    // ?t= 让 URL 每次都不同：GitHub Pages 没法设响应头，这是唯一可靠的「不吃旧缓存」手段
    res = await fetch(`${VAULT_FILE}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  // 不能用 content-type 判断：.enc 不是注册的 MIME 类型。
  // Astro dev 返回空值、python http.server 返回 application/octet-stream，
  // 任何白名单都会把正常密文误判成「格式不对」。
  // 改成看正文：站点首页 / 404 回退页一定以 '<' 开头，密文一定以 '{' 开头。
  const raw = (await res.text()).replace(/^\uFEFF/, '').trim();
  if (!raw || raw.startsWith('<')) throw new Error('BAD_PAYLOAD');

  let parsed: VaultPayload;
  try {
    parsed = JSON.parse(raw) as VaultPayload;
  } catch {
    throw new Error('BAD_PAYLOAD');
  }
  // 字段自检：宁可报「密文损坏」，也不要把半截 JSON 送进 crypto 换一个看不懂的错
  if (
    !parsed ||
    typeof parsed.ct !== 'string' ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.iter !== 'number'
  ) {
    throw new Error('BAD_PAYLOAD');
  }
  return parsed;
};

const deriveKey = async (password: string, p: VaultPayload) => {
  const base = await crypto.subtle.importKey('raw', TEXT.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToU8(p.salt || ''),
      iterations: typeof p.iter === 'number' ? p.iter : 600000,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
};

const importStoredKey = (raw: string) =>
  crypto.subtle.importKey('raw', b64ToU8(raw), { name: 'AES-GCM' }, true, ['decrypt']);

/** 解出来的是 { items: [...] }，这里直接返回数组 —— 旧版把它当数组用才炸的 */
const decryptWith = async (key: CryptoKey, p: VaultPayload): Promise<VaultItem[]> => {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToU8(p.iv || '') },
    key,
    b64ToU8(p.ct || '')
  );
  const data = JSON.parse(DEC.decode(plain)) as { items?: VaultItem[] };
  if (!data || !Array.isArray(data.items)) throw new Error('BAD_PAYLOAD');
  return data.items;
};

const describeError = (error: unknown) => {
  // 必须最先判断：非安全上下文下 crypto.subtle 不存在，后面全会变成 TypeError
  if (!window.isSecureContext || !window.crypto?.subtle) {
    return '当前地址用不了浏览器加密接口：请用 localhost / 127.0.0.1 或 https 打开。';
  }
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'NOT_FOUND') {
    return '找不到 vault.enc：先在本机跑 node tools/vault.mjs encrypt 再提交。';
  }
  if (code === 'BAD_PAYLOAD') {
    return '/vault.enc 返回的不是 JSON，多半被站点 fallback 成了 HTML 页面。直接访问 /vault.enc 核对内容。';
  }
  if (name === 'OperationError') return '密码不对，或密文已更新（改过密码要重新输一次）。';
  if (name === 'InvalidCharacterError' || name === 'DataError') {
    return '本地保存的解锁钥匙已损坏，已清除，请重新输密码。';
  }
  if (code.startsWith('HTTP_')) return `服务器返回 ${code.slice(5)}，稍后重试。`;
  if (name === 'AbortError') return '请求超时，检查网络后重试。';
  return `解密出错：${code}`;
};

/** 与 BookmarkCard.astro 的 DOM 完全同构，但用 createElement + textContent，不需要任何转义 */
const cardOf = (item: VaultItem) => {
  const title = String(item.title || '未命名');
  const url = safeHref(String(item.url || ''));

  const a = document.createElement('a');
  a.className = 'bm';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const icon = document.createElement('div');
  icon.className = 'bm-icon';
  icon.textContent = title.trim().charAt(0).toUpperCase() || '·';

  const body = document.createElement('div');
  body.className = 'bm-body';

  const heading = document.createElement('p');
  heading.className = 'bm-title';
  heading.textContent = title;
  body.append(heading);

  if (item.desc) {
    const desc = document.createElement('p');
    desc.className = 'bm-desc';
    desc.textContent = String(item.desc);
    body.append(desc);
  }

  const host = document.createElement('span');
  host.className = 'bm-host';
  host.textContent = url === '#' ? title : hostOf(url);
  body.append(host);

  a.append(icon, body);
  return a;
};

export function mountVault() {
  const section = document.getElementById('vault');
  if (!section) return;

  // 告诉预判脚本「逻辑已经跑起来了」，别再用 4s 超时把我藏起来
  document.documentElement.dataset.vaultBoot = '1';

  const lockedWrap = section.querySelector<HTMLElement>('[data-vault-locked]');
  const unlockedWrap = section.querySelector<HTMLElement>('[data-vault-unlocked]');
  const opener = section.querySelector<HTMLButtonElement>('[data-vault-open]');
  const panel = section.querySelector<HTMLFormElement>('[data-vault-panel]');
  const pwd = section.querySelector<HTMLInputElement>('#vault-pwd');
  const submit = section.querySelector<HTMLButtonElement>('[data-vault-submit]');
  const cancel = section.querySelector<HTMLButtonElement>('[data-vault-cancel]');
  const lockButton = section.querySelector<HTMLButtonElement>('[data-vault-lock]');
  const msg = section.querySelector<HTMLElement>('[data-vault-msg]');
  const grid = section.querySelector<HTMLElement>('[data-vault-grid]');
  const counter = section.querySelector<HTMLElement>('[data-vault-count]');
  const heading = section.querySelector<HTMLElement>('#vault-heading');

  if (
    !lockedWrap ||
    !unlockedWrap ||
    !opener ||
    !panel ||
    !pwd ||
    !submit ||
    !cancel ||
    !lockButton ||
    !msg ||
    !grid ||
    !counter ||
    !heading
  ) {
    // 结构不全时别把入口卡永久藏起来（预判脚本可能已打了 pending）
    delete document.documentElement.dataset.vaultReady;
    return;
  }

  let payload: VaultPayload | null = null;
  let busy = false;

  const loadPayload = async () => {
    if (!payload) payload = await fetchPayload();
    return payload;
  };

  const setPanel = (open: boolean) => {
    panel.hidden = !open;
    opener.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const showLocked = () => {
    unlockedWrap.hidden = true;
    lockedWrap.hidden = false;
    setPanel(false);
    pwd.value = '';
    msg.textContent = '';
  };

  const showUnlocked = (items: VaultItem[]) => {
    grid.replaceChildren(...items.map(cardOf));
    counter.textContent = `已解锁 · ${items.length} 条收藏`;
    lockedWrap.hidden = true;
    unlockedWrap.hidden = false;
    pwd.value = '';
    msg.textContent = '';
  };

  const unlockWithKey = async (key: CryptoKey) => {
    const p = await loadPayload();
    showUnlocked(await decryptWith(key, p));
  };

  opener.addEventListener('click', () => {
    const open = panel.hidden;
    setPanel(open);
    if (!open) return;
    pwd.value = ''; // 防止浏览器 / 密码管理器回填
    msg.textContent = '';
    // 手机上不主动弹键盘
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) pwd.focus();
  });

  panel.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!pwd.value) {
      pwd.focus();
      return;
    }
    busy = true;
    msg.textContent = '';
    submit.disabled = true;
    submit.textContent = '解密中…';
    try {
      const p = await loadPayload();
      const key = await deriveKey(pwd.value, p);
      showUnlocked(await decryptWith(key, p));
      try {
        saveKey(u8ToB64(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
      } catch {}
      heading.focus({ preventScroll: true });
    } catch (error) {
      msg.textContent = describeError(error);
      pwd.focus();
      pwd.select();
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = '解锁';
    }
  });

  cancel.addEventListener('click', () => {
    setPanel(false);
    opener.focus();
  });

  pwd.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setPanel(false);
    opener.focus();
  });

  lockButton.addEventListener('click', () => {
    dropKey();
    payload = null;
    grid.replaceChildren();
    showLocked();
    opener.focus();
  });

  // 免密自动展开：只做 AES 解密，不跑 PBKDF2，几十毫秒
  (async () => {
    const raw = readKey();
    if (!raw) return;
    try {
      await unlockWithKey(await importStoredKey(raw));
      if (location.hash === '#vault') section.scrollIntoView({ block: 'start' });
    } catch (error) {
      // 只有「钥匙和密文确实不匹配」才清钥匙；网络 / 404 不该让用户白输一次密码
      const name = error instanceof Error ? error.name : '';
      const code = error instanceof Error ? error.message : '';
      if (name === 'OperationError' || name === 'InvalidCharacterError' || code === 'BAD_PAYLOAD') {
        dropKey();
      }
      // 自动解锁失败不打扰用户，保持锁定态即可
    } finally {
      delete document.documentElement.dataset.vaultReady;
    }
  })();
}
