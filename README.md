# 个人网站

导航页 + 博客 + 说说 + 首页内联加密收藏区，一套 Astro 代码，纯静态输出，零服务器。

- 站点地址：`https://666555444.xyz`
- 技术栈：Astro 7 · 原生 CSS · WebCrypto · giscus
- 部署：GitHub Actions 构建 → GitHub Pages + EdgeOne Pages 双跑

---

# 速查（平时只看这一段）

## 环境

需要 **Node >= 22.23.4**（`node -v` 查）。不够就先切到 homebrew 那个：

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

第一次拿到项目，装依赖（只需一次）：

```bash
npm install
```

## 只想看看站长什么样

双击根目录的 **`看站点.command`** —— 自动构建、起服务、开浏览器。看完把黑色窗口关掉。

## 只改 3 个地方

| 想做什么 | 改哪个 |
| --- | --- |
| 写一篇博客 | 在 `src/content/blog/` 新建 `随便起名.md` |
| 发一条说说 | 在 `src/content/notes/` 新建 `2026-10-30.md` |
| 加一个收藏网址 | 编辑 `src/data/bookmarks.json` |

（字段格式见下面「四个页面怎么改」）

## 命令就那么几条

| 想干什么 | 怎么做 |
| --- | --- |
| 只是看看 | 双击 `看站点.command` |
| 边改边看（保存自动刷新） | `npm run dev`，然后开 localhost:4321 |
| 生成上线用的文件 | `npm run build` |
| 改完收藏后重新加密 | `node tools/vault.mjs encrypt` |
| 发布 | `git add -A && git commit -m "更新" && git push` |

## 这些别动

`src/pages/` `src/components/` `src/layouts/` `src/styles/` `tools/` `.github/` `node_modules/` `dist/`

想改外观或加页面，跟我说，别自己动——这些是牵一发动全身的地方。

> ⚠️ **密文密码**：`public/vault.enc` 的密码只存在你自己脑子里 / 密码管理器里，项目任何文件都不记录。忘了密码别慌——`vault.plain.json`（仅本地，不入库）是唯一后路，用它 `node tools/vault.mjs init --force` 重设即可。

---

# 详细说明

## 目录结构

```
src/
├─ config.ts              站点名、域名、giscus 配置（要改的都在这里）
├─ content/
│  ├─ blog/*.md           博客文章
│  └─ notes/*.md          说说
├─ data/bookmarks.json    公开书签
├─ layouts/Base.astro     页面骨架、SEO、主题切换
├─ components/            Header / BookmarkCard / Giscus
├─ pages/
│  ├─ index.astro         导航首页（搜索 + 分类筛选 + 收藏区）
│  ├─ blog/               列表 + 详情
│  ├─ notes/              说说时间线
│  ├─ rss.xml.ts          RSS
│  └─ 404.astro
├─ lib/vault-client.ts    首页收藏区的解密与渲染逻辑
└─ styles/global.css      全部样式，含响应式和亮暗主题

public/
├─ vault.enc              收藏条目的密文（可以放心提交）
├─ CNAME                  GitHub Pages 自定义域名
└─ favicon.svg

tools/
├─ vault.mjs              加密工具
└─ clean-dist.mjs         构建后清理中间产物 + 收藏链接泄漏自检（自动跑，不用管）

看站点.command             双击预览
.pages.yml                Pages CMS 后台配置
edgeone.json              EdgeOne 缓存 / 重定向配置（必须保留）
.github/workflows/        构建与部署
```

## 三个栏目 + 首页收藏区怎么改

**首页书签** —— 编辑 `src/data/bookmarks.json`，`categories` 是筛选分类，`items` 是条目。加一条就多一张卡片，搜索和分类筛选自动生效。

**博客** —— 在 `src/content/blog/` 新建 `.md`，头部字段：

```yaml
---
title: 标题
date: 2026-10-30
summary: 列表页显示的一句话
tags: ['标签']
draft: false      # true 则不上线
---
```

**说说** —— 在 `src/content/notes/` 新建 `.md`：

```yaml
---
date: 2026-10-30
mood: 清醒        # 可选，显示成小标签
tags: ['想法']
---
```

**收藏区** —— 见下一节。

## 收藏区怎么用

### 原理

收藏条目加密后存成 `public/vault.enc`。这个文件可以公开放在仓库和 CDN 上，因为**没有密码就只是一堆乱码**。

密钥由密码派生，强度完全取决于密码本身——密码够强，离线爆破的成本就远超收益。

访问首页时，HTML 里没有任何收藏数据，源码是纯空壳；底部「晨光」区块平时只有一张入口卡，点一下就地展开密码框，输对后浏览器现场解密、原地铺开卡片（不跳页）。解锁状态记在 localStorage（存的是派生密钥，不存明文密码），**下次打开首页自动展开**；点「重新锁定」清除。

收藏区刻意放在 `#bm-grid` 之外，所以**不参与**首页的分类筛选和搜索。

### 缓存

`vault.enc` 不能被 CDN 缓存，否则改了密码线上还在用旧密文。三层保证：

1. `edgeone.json` 给 `/vault.enc` 设 `Cache-Control: no-store` 等响应头，并用 `caches.cacheTtl: 0` 关掉边缘缓存
2. 前端 `fetch` 用 `cache: 'no-store'`
3. URL 带 `?t=时间戳`，每次都不同 —— GitHub Pages 不支持自定义响应头，这层是它的唯一保障

同时 `tools/clean-dist.mjs` 会在构建后扫一遍 `dist/**/*.html`，用本地 `vault.plain.json` 里的链接做匹配，**一旦收藏条目进了 HTML 就让构建失败**（EdgeOne 对 `.html` 默认缓存 2 小时，那等于明文上 CDN）。CI 上没有明文文件，自动跳过。

### 第一次配置

```bash
node tools/vault.mjs init
```

按提示设密码（至少 10 位），会生成：

- `vault.plain.json` —— 明文清单，**已在 .gitignore 里，不会进仓库**
- `public/vault.enc` —— 密文，这个要提交

### 日常增删

```bash
node tools/vault.mjs edit        # 用 $EDITOR 打开明文清单
node tools/vault.mjs encrypt     # 重新加密，然后 commit
```

或者加一条：

```bash
node tools/vault.mjs add "名字" "https://..." "描述"
node tools/vault.mjs encrypt
```

查看现有条目：`node tools/vault.mjs list`

### 改密码

改密码等于重新加密一遍：

```bash
node tools/vault.mjs init --force           # 覆盖现有密文，输新密码
```

### 几点提醒

- **密码是唯一一道防线**，丢了就打不开（没有找回机制，这恰恰是它安全的原因）。建议顺手记到密码管理器里。
- 换出来的密文提交后，之前解锁过的浏览器会解密失败并自动要求重新输入——这是预期行为，因为 salt 变了。
- 别把 `vault.plain.json` 提交到仓库。`.gitignore` 已经处理，但推之前扫一眼 `git status`。

## 部署

### 方案 A：GitHub Pages（最简单）

1. 推到 GitHub 公开仓库
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. 推送 `main` 分支，workflow 自动构建并发布
4. 自定义域名：`public/CNAME` 已写好 `666555444.xyz`，在 Pages 设置里勾上 Enforce HTTPS

### 方案 B：Cloudflare Pages

1. Workers & Pages → Create → Pages → 连接到 Git 仓库
2. 构建命令 `npm run build`，输出目录 `dist`
3. 自定义域名绑 `666555444.xyz`

或者在 Actions 里部署（需要配 secrets）：仓库 Settings → Variables 设 `ENABLE_CLOUDFLARE=true`、`CF_PAGES_PROJECT`；Secrets 设 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。

### 方案 C：EdgeOne Pages（国内快，域名需备案）

1. EdgeOne 控制台 → Pages → 从 Git 仓库导入
2. 构建命令 `npm run build`，输出目录 `dist`
3. 加速域名填已备案的 `666555444.xyz`

> **必须保留仓库根目录的 `edgeone.json`**。它做两件要紧的事：给 `/vault.enc` 设 `no-store` 并关掉边缘缓存（否则改了密码线上还在用旧密文），以及把旧的 `/vault/` 301 到 `/#vault`。删了它，收藏区就会出现「密码明明对却解不开」。
>
> GitHub Pages 那边没有自定义响应头的能力，靠前端 `?t=时间戳` 兜底，功能不受影响。

> EdgeOne 的中国大陆节点要求域名完成 ICP 备案。备案号在域名所在服务商处申请，一般 7–20 个工作日。

### DNS 建议

主域建议**不开橙色云（不代理）**，直接 CNAME 到托管平台分配的域名。原因是站点本身已经在 CDN 上，多一层代理只增加故障点，而且 Cloudflare 的 Access 功能你的场景用不到（收藏走的是加密，不需要网关鉴权）。

## 评论（giscus）

1. 仓库 Settings → General → Features 勾上 **Discussions**
2. 装 [giscus app](https://github.com/apps/giscus) 并授权该仓库
3. 去 [giscus.app](https://giscus.app) 填仓库名，拿到 `repoId` 和 `categoryId`
4. 填进 `src/config.ts` 的 `GISCUS`

填好之前评论区自动隐藏，不影响构建。

**「评论沉淀进正文」的流程**：Discussions 里挂着的问答，定期挑有价值的摘进文章末尾（加个 `## 读者问答` 小节），commit 之后就永久固化在正文里了。这是数字花园（digital garden）的标准做法——评论区只是原料，正文才是成品。

## 在线编辑（Pages CMS）

1. 打开 [app.pagescms.org](https://app.pagescms.org)，用 GitHub 账号登录
2. 授权仓库，它会读 `.pages.yml` 自动生成后台
3. 改完保存 → 自动 commit → 平台自动构建

`.pages.yml` 里定义了三块：博客文章、说说、公开书签。字段和 `src/content.config.ts` 里的 schema 是一一对应的，**改了一边记得同步另一边**，否则构建会因为 schema 不匹配而失败。

## 常见问题

**Q：首页收藏区提示「密码不对，或密文已更新」？**
A：先用 `node tools/vault.mjs decrypt --password 你的密码` 验证密文本身。能解开说明问题在浏览器侧，按顺序排查：① 浏览器自动填了旧密码 —— 把输入框全选删干净再输；② 密文被缓存了 —— 硬刷新或等几分钟；③ 改过密码 —— 本地存的钥匙已失效，重新输一次即可。

**Q：`npm run build` 报 Node 版本不支持？**
A：Astro 7 要求 Node >= 22.23.4。先 `export PATH="/opt/homebrew/bin:$PATH"` 再跑。

**Q：`dist/` 里为什么没有一堆 `.mjs` 文件？**
A：那些是构建中间产物，Astro 构建结束会自动删，`tools/clean-dist.mjs` 再兜底扫一遍。上线用的就是纯 html + css + 密文。

**Q：想加需要登录才能看的内容，不用密码？**
A：静态站做不了真登录。要么走加密（当前方案），要么在 Cloudflare 上单独开一个 Worker 做鉴权——但那需要域名走 Cloudflare 代理。当前方案在「不想开橙云」的前提下是最优解。

**Q：文章里的图片放哪？**
A：放 `public/images/`，正文里写 `/images/xxx.webp`。Pages CMS 配了 media，后台上传会自动进这个目录。建议先压成 webp，手机流量友好。

## 定过的规矩

- 样式只写在 `src/styles/global.css`，不引 UI 框架，保证首屏没有额外 JS
- 所有可配置项集中在 `src/config.ts`，不散落在页面里
- 收藏内容一律走 `vault.enc`，**绝不**在页面源码里留明文
- `vault.plain.json` 永不入库
- 评论区的价值在于被整理进正文，而不是堆积在页面底部
