import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://666555444.xyz',
  output: 'static',
  build: {
    format: 'directory',
  },
  devToolbar: { enabled: false },
  // v7 默认改成 'jsx' 会吃掉内联元素间的空格，显式保持旧行为，避免文字粘连
  compressHTML: true,
});
