# TruthLens · 真相透镜

**从一段信息出发，追溯证据，理解结论。**

真相透镜是一个基于互联网检索、网页正文抓取与 AI 交叉验证的信息核查应用。输入待核查的说法，即可查看核心主张、证据来源、来源立场、综合结论与分析依据。

项目包含 React 前端、Node.js 后端和 MySQL 数据层，支持本地运行与独立部署。

[功能概览](#功能概览) · [快速开始](#快速开始) · [环境配置](#环境配置) · [生产部署](#生产部署) · [常见问题](#常见问题)

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 两种核查模式 | 快速核查使用精简检索；深度核查增加主张拆解、更多检索与正文补充。 |
| 可追溯的证据 | 展示来源链接、支持／反对／中立立场、来源可靠性及分析要点。 |
| 分级结论 | 支持属实、基本属实、部分属实、基本失实、失实、无法判定六类结论。 |
| 账号与历史 | 支持注册、登录和历史查询；普通用户查看自己的记录，管理员可查看全部或指定用户的记录。 |
| 自带模型密钥 | 登录后可配置 DeepSeek、Kimi 开放平台、智谱 GLM 或通义千问的 API Key。 |
| 管理后台 | 查看用户与核查统计、用户列表，并管理普通用户账号。 |
| 界面主题 | 提供赤、墨、磷、蓝、示、纸六套主题，以及核查进度与页面过渡动画。 |

### 核查流程

```mermaid
flowchart TD
    A[输入待核查信息] --> B[生成检索词与核心主张]
    B --> C[多路搜索与来源去重]
    C --> D[来源评估与证据整理]
    D --> E[AI 综合判定]
    E --> F[展示结论、评分、来源与分析]
    F --> G[保存核查记录]
```

快速模式使用模板生成检索词，跳过正文补充；深度模式使用模型拆解主张，并抓取部分来源正文。输入长度为 **4–2000 个字符**，默认使用深度模式。

结果中的「置信度」与「信息可靠度评分」是应用对当次证据的综合估计，不等同于事实正确率；证据不足时会给出「无法判定」。

### 默认使用额度

| 身份 | 核查额度 |
| --- | --- |
| 未注册游客 | 免费 1 次，结合游客身份与可获取的访问 IP 计数。 |
| 普通注册用户 | 每日免费 5 次，按 UTC+8 的自然日重置。 |
| 已配置有效自带 Key 的用户 | 不受平台每日次数限制，模型调用使用自己的供应商额度。 |
| 管理员 | 不受平台每日次数限制。 |

额度常量与模型平台预设见 [`contracts/types.ts`](contracts/types.ts)。自带 Key 只替换模型调用通道，搜索和网页抓取仍依赖站点配置的 AgentGW。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 7、React Router |
| 界面 | Tailwind CSS、Radix UI、Framer Motion |
| 接口 | Hono、tRPC 11、TanStack Query、Zod |
| 数据库 | MySQL、Drizzle ORM / Drizzle Kit |
| 外部能力 | Kimi AgentGW 搜索与抓取、兼容 Chat Completions 的模型接口 |

完整依赖与命令见 [`package.json`](package.json)，锁定版本见 [`package-lock.json`](package-lock.json)。

## 快速开始

### 1. 准备运行环境

- Node.js **22.12 或更新版本**及 npm。锁定依赖中的 Vite 也接受 Node.js `^20.19.0`。
- 可连接的 MySQL 服务，以及提前创建好的数据库，例如 `truthlens`。
- 可用的 AgentGW 地址与凭证，至少支持 `/v1/search` 和 `/v1/fetch`。
- 模型调用权限：使用 AgentGW 的聊天接口，或配置独立的 `LLM_*` 通道。

### 2. 获取源码并安装依赖

```bash
git clone https://github.com/player4086/truthlens.git
cd truthlens
npm ci
```

私有仓库需要先完成 GitHub 登录，并拥有仓库访问权限。

### 3. 配置环境变量

将 [`.env.example`](.env.example) 复制为项目根目录的 `.env`。

Linux / macOS：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

填写数据库连接、应用密钥与网关凭证。示例中的 `your-*`、`replace-with-*` 和示例域名都需要替换为实际配置；需要管理员账号时，还应设置 `ADMIN_PASSWORD`。

可用下面的命令生成随机密钥，分别用于 `APP_SECRET` 和 `GUEST_TOKEN_SECRET`，两者使用不同的生成结果：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 4. 初始化数据库表

确认 `DATABASE_URL` 指向已创建的数据库，然后执行：

```bash
npm run db:push
```

这一步将 [`db/schema.ts`](db/schema.ts) 中的用户、会话、核查记录等表结构同步到数据库。初次运行必须完成建表；对已有数据库操作前，应先检查结构变更并备份数据。

### 5. 启动开发服务

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。前端页面和 `/api/trpc` 接口由同一个开发服务提供，端口被占用时以终端实际输出为准。

## 环境配置

### 应用与数据库

| 变量 | 用途与要求 |
| --- | --- |
| `APP_ID` | 应用标识，生产环境启动时必填。 |
| `APP_SECRET` | 生产环境必填；用于派生用户自带 API Key 的加密密钥，也可作为游客签名密钥的后备值。 |
| `GUEST_TOKEN_SECRET` | 游客身份签名及 IP 摘要密钥，建议独立设置。未填时回退到 `APP_SECRET`；两者都未设置时使用进程内随机值。 |
| `DATABASE_URL` | MySQL 连接地址，例如 `mysql://user:password@host:3306/truthlens`。账号、历史和配额功能需要可用的数据库。 |

请保存好 `APP_SECRET`。更换它之后，数据库中已保存的用户模型密钥将无法按原方式解密，需要用户重新设置。

### 外部服务与管理员

| 变量 | 用途与要求 |
| --- | --- |
| `KIMI_API_KEY`、`KIMI_BASE_URL` | AgentGW 凭证与根地址，成对设置；也可以使用下面说明的凭证文件。 |
| `KIMI_CHAT_ID` | 可选，仅在网关要求会话标识时填写。 |
| `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` | 可选的站点默认模型通道，三个变量需要同时填写；配置不完整时回退到 AgentGW。 |
| `ADMIN_USERNAME` | 首次管理员的用户名，默认 `admin`。 |
| `ADMIN_PASSWORD` | 首次管理员的密码，至少 12 个字符；未设置时跳过自动创建管理员。 |
| `PORT` | 生产服务端口，默认 `3000`；开发端口由 `vite.config.ts` 配置。 |
| `NODE_ENV` | 生产运行时设为 `production`，启用后端监听与前端静态文件服务。 |

**模型通道优先级：用户自带 Key → 站点 `LLM_*` 配置 → AgentGW。**

`LLM_BASE_URL` 填服务根地址或版本路径，不要附带 `/chat/completions`；客户端会补齐该路径。外部模型需要支持项目所用的 Chat Completions 请求与 JSON 对象输出。

`KIMI_BASE_URL` 必须对应本项目使用的 AgentGW 服务。仅提供普通模型聊天接口的地址，无法替代搜索和抓取接口。

未同时设置 `KIMI_API_KEY` 与 `KIMI_BASE_URL` 时，程序依次尝试以下凭证文件：

1. `~/.kimi/agent-gw.json`
2. `/mnt/agents/.agent-gw.json`
3. 项目运行目录下的 `.agent-gw.json`

凭证文件使用 `api_key`、`base_url` 字段，以及可选的 `kimi_chat_id` 字段。解析逻辑见 [`api/services/agentgw.ts`](api/services/agentgw.ts)。

首次访问认证相关接口时，程序会检查数据库是否已有管理员，并按环境变量进行初始化。修改 `ADMIN_PASSWORD` **不会重置已有管理员密码**。

## 页面与目录

| 路径 | 页面 |
| --- | --- |
| `/` | 核查工作台 |
| `/history` | 历史记录 |
| `/auth` | 登录与注册 |
| `/settings` | 自带模型 API Key 设置 |
| `/admin` | 管理后台，需要管理员权限 |

```text
truthlens/
├── src/                  # React 前端
│   ├── pages/            # 核查、历史、认证、设置和管理页面
│   ├── components/       # 业务组件、动画与基础 UI
│   ├── providers/        # tRPC 与查询客户端
│   └── lib/              # 认证状态、主题与工具函数
├── api/                  # Hono / tRPC 后端
│   ├── verify.ts         # 核查任务、配额与历史
│   ├── auth.ts           # 认证、管理员初始化与模型密钥
│   ├── admin.ts          # 后台管理接口
│   └── services/         # 搜索、抓取与模型客户端
├── db/                   # 数据库结构与迁移目录
├── contracts/            # 前后端共享类型、额度与模型预设
├── public/               # 站点图标等静态资源
├── .env.example          # 环境变量模板
└── Dockerfile            # 现有平台的容器构建配置
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务。 |
| `npm run check` | 检查前端、后端及相关配置的 TypeScript 类型。 |
| `npm run lint` | 执行 ESLint 检查。 |
| `npm run format` | 使用 Prettier 格式化项目文件，会修改文件。 |
| `npm test` | 运行 Vitest；当前仓库配置了测试工具，但尚未包含匹配的测试用例。 |
| `npm run build` | 构建前端到 `dist/public/`，打包后端到 `dist/boot.js`。 |
| `npm start` | 以生产模式运行后端，适用于支持该脚本语法的 shell。 |
| `npm run preview` | 预览前端构建产物，不代替完整的后端服务。 |
| `npm run db:push` | 直接同步数据库表结构。 |
| `npm run db:generate` | 生成数据库迁移文件。 |
| `npm run db:migrate` | 执行已有迁移文件。 |

迁移目录当前只有占位文件，且 `.gitignore` 忽略 `db/migrations/*.sql`。若采用迁移式部署，需要先生成、审查并纳入版本管理，不能将空迁移目录视为已完成建表。

## 生产部署

### Node.js 服务

完成环境配置和数据库初始化后，在项目根目录执行：

```bash
npm ci
npm run build
npm start
```

Windows PowerShell 下，最后一步改为：

```powershell
$env:NODE_ENV = "production"
node dist/boot.js
```

生产服务默认监听 `3000` 端口，并同时提供前端页面与 API。运行时请保持项目根目录为工作目录，确保 `dist/public/` 可访问；对外服务还需配置域名、HTTPS 和服务进程管理。

### Docker 配置说明

当前 [`Dockerfile`](Dockerfile) 保留了原平台的密钥复制步骤，会将 `.env` 和 `.agent-gw.json` 写入镜像；当前 [`.dockerignore`](.dockerignore) 也未排除这两个文件。仓库不包含实际密钥文件，直接构建会因缺少对应的 `COPY` 源文件而失败。

迁移到自己的容器环境前，需要移除这些密钥复制指令，并在 `.dockerignore` 中排除 `.env`、`.agent-gw.json`；随后改为在运行时通过环境变量、`--env-file` 或 Secret 挂载注入。不要把包含真实密钥的镜像当作可公开分发的构建产物。

### 运行边界

- 完整应用依赖 Node.js 后端、MySQL 和外部 API；仅发布前端静态文件无法提供核查、账号与历史功能。
- 进行中的任务状态保存在当前进程内存中，按 30 分钟保留窗口定期清理；服务重启不会恢复未完成任务。扩展多实例前，需要处理任务状态和配额的一致性。
- 已完成的结果写入 MySQL。数据库写入失败时，本次结果仍可能显示，但不会形成可查询的持久历史记录。

## 常见问题

| 问题 | 排查方向 |
| --- | --- |
| 页面能打开，但核查失败 | 检查 AgentGW 凭证、搜索／抓取权限、模型通道与服务端网络连接。 |
| 提示 AgentGW 凭证不可用 | 确认 `KIMI_API_KEY` 和 `KIMI_BASE_URL` 同时设置，或凭证文件位于支持的路径且字段完整。 |
| 搜索正常，模型调用失败 | 检查网关聊天权限；若使用独立模型通道，确认三个 `LLM_*` 变量齐全、模型可用且支持 JSON 输出。 |
| 登录、历史记录或建表报错 | 检查 MySQL 是否可达、数据库是否已创建、账号权限和 `DATABASE_URL`，确认已完成建表。 |
| 管理员账号没有创建 | 检查 `ADMIN_PASSWORD` 是否至少 12 位、用户名是否合法，以及数据库是否已有管理员。 |
| 修改配置后没有生效 | 网关和模型配置会被缓存，修改环境变量或凭证文件后需重启服务。 |
| `npm test` 提示未找到测试 | 当前仓库没有匹配 `api/**/*.test.ts` 或 `api/**/*.spec.ts` 的文件，需补充用例后运行。 |

请勿将实际 `.env`、网关凭证、数据库密码或 API Key 提交到仓库；可共享的配置模板为 [`.env.example`](.env.example)。
