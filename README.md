# kane's Portfolio

个人技术作品集，展示 AI Native 实践、架构设计与后端项目经验。

## 技术栈

- **框架**: [Docusaurus](https://docusaurus.io/) - 现代化静态网站生成器
- **语言**: TypeScript
- **主题**: 支持中英文双语 (zh-CN / en)

## 内容结构

- `/docs/ai-native` - AI Native 相关实践
- `/docs/architecture` - 架构设计（高并发、分布式锁、幂等性等）
- `/docs/projects` - 项目经验（订单系统等）
- `/blog` - 技术博客

## 快速开始

### 安装依赖

```bash
yarn install
```

### 本地开发

```bash
yarn start
```

启动后访问 http://localhost:3000，修改文件会自动热更新。

### 构建部署

```bash
yarn build
```

生成静态文件到 `build` 目录，可部署到任意静态托管服务。

### 部署到 Vercel（推荐）

本项目已部署到 Vercel，访问地址：[www.kane.cab](https://www.kane.cab)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录并部署
vercel login
vercel --prod
```

或使用 Git 集成自动部署：
1. 在 [Vercel Dashboard](https://vercel.com/dashboard) 导入项目
2. 选择 `lishuji/ai-native-portfolio` 仓库
3. 框架预设选择 **Docusaurus**
4. 点击 Deploy，每次 push 到 main 分支会自动重新部署

### 部署到 GitHub Pages

```bash
# SSH 方式
USE_SSH=true yarn deploy

# 或使用 GitHub Token
GIT_USER=<Your GitHub username> yarn deploy
```

## 项目结构

```
├── blog/              # 博客文章 (Markdown)
├── docs/             # 文档页面
├── src/               # React 组件和样式
├── static/            # 静态资源
├── docusaurus.config.ts  # 站点配置
└── sidebars.ts        # 侧边栏配置
```

## 许可证

[MIT](./LICENSE)
