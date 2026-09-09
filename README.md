# TruthLens · 真相透镜

基于多路互联网检索、网页正文抓取和 AI 交叉验证的信息核查应用。

## 本地运行

1. 复制 `.env.example` 为 `.env`，填写数据库、Kimi 网关和首次管理员密码。
2. 安装依赖：`npm ci`
3. 开发运行：`npm run dev`

常用质量检查：

```bash
npm run check
npm run lint
npm test
npm run build
```

## 配置与安全

- 生产环境需要 `APP_ID`、`APP_SECRET`、`GUEST_TOKEN_SECRET`、`DATABASE_URL`，并为首次管理员设置至少 12 位的 `ADMIN_PASSWORD`。
- 管理员只会在数据库没有管理员时按 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建；应用不再使用默认管理员密码。
- 检索与正文抓取走 Kimi agent-gw；AI 判定默认也走 agent-gw，若网关凭证无 chat 权限，配置 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 即可切换到任意 OpenAI 兼容平台（DeepSeek、Kimi 开放平台、智谱、通义等），三者需同时设置。
- 不要提交 `.env`、`.agent-gw.json` 或任何 API 密钥。容器部署时通过 `--env-file`、环境变量或平台 Secret 注入它们，镜像不会包含这些文件。

## Vite 模板参考

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
