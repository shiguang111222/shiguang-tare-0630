# 《词匣》云服务器部署指南

## 一、项目结构

```
词匣/
├── api/          # 后端（Express + Socket.IO）
├── shared/       # 前后端共享类型
├── src/          # 前端源码（React + Vite）
├── dist/         # 前端构建产物（构建后生成）
├── public/       # 静态资源
├── .env.example  # 环境变量示例
├── package.json
└── DEPLOY.md     # 本文件
```

## 二、环境要求

- Node.js >= 18
- npm 或 pnpm / yarn
- 服务器已开放对应端口（默认 3001）

## 三、部署步骤

### 1. 上传文件

将整个项目目录上传到云服务器，推荐方式：
- **scp**: `scp -r ./ 用户名@服务器IP:/opt/cixia/`
- **宝塔面板 / FileZilla**: 直接上传整个文件夹
- **Git**: 推送到 Git 仓库，服务器上 clone

### 2. 安装依赖

```bash
cd /opt/cixia
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的配置
vim .env
```

### 4. 构建前端

```bash
npm run build
```

构建完成后，`dist/` 目录会生成前端静态文件。

### 5. 启动服务

```bash
npm start
```

服务启动后，访问 `http://服务器IP:3001` 即可进入游戏。

## 四、后台运行（推荐）

使用 PM2 守护进程：

```bash
npm install -g pm2
pm2 start npm --name "cixia" -- start
pm2 save
pm2 startup   # 开机自启
```

查看日志：

```bash
pm2 logs cixia
pm2 status
```

## 五、环境变量说明

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `PORT` | 服务端口 | 否 | 3001 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于 AI 故事生成 | 否 | 无（不填则使用本地兜底模板） |

## 六、域名与反向代理（可选）

如果要使用域名 + HTTPS，推荐用 Nginx 反代：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

WebSocket 必须配置 `Upgrade` 和 `Connection` 头，否则 Socket.IO 会降级为 polling 或直接连不上。

## 七、更新上线

```bash
cd /opt/cixia
git pull          # 或重新上传文件
npm install       # 如果依赖有变化
npm run build     # 重新构建前端
pm2 restart cixia # 重启服务
```
