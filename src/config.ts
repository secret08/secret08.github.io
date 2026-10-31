export const SITE = {
  name: '嘿鸭的站',
  author: '嘿鸭',
  url: 'https://666555444.xyz',
  description: '一个存放文章、随笔和常用链接的地方。',
};

/**
 * giscus 评论配置。
 * 到 https://giscus.app 用 GitHub 账号授权后，页面会给出这四项。
 * repoId / categoryId 留空则评论区自动隐藏，不影响构建。
 */
export const GISCUS = {
  repo: '',
  repoId: '',
  category: 'Announcements',
  categoryId: '',
  mapping: 'pathname',
  theme: 'preferred_color_scheme',
  lang: 'zh-CN',
};

export const isGiscusReady = GISCUS.repo !== '' && GISCUS.repoId !== '';

/** 收藏区密文文件路径，由 tools/vault.mjs 生成 */
export const VAULT_FILE = '/vault.enc';
