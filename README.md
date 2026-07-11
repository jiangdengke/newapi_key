# New API Key 管理系统

基于 Next.js 的 New API 多实例 Anthropic Key 管理工具。管理员可以维护多个 New API 实例，为每个实例生成独立访问 Key；使用者通过访问 Key 进入指定实例，批量创建 Claude 渠道、查询本地导入历史并同步渠道状态与用量。

## 主要能力

- 多个 New API 实例统一管理。
- 每个实例使用独立访问 Key，访客会话仅能访问绑定实例。
- 批量导入 Anthropic Key，并按 `claude-MMDD-序号` 创建渠道。
- 固定支持 `claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6`。
- 支持实例级渠道优先级和权重。
- SQLite 保存实例配置、访问会话和脱敏渠道历史。
- 完整 Anthropic Key 不落库，仅保存掩码和 SHA-256 指纹。
- 支持 Docker Compose、Nginx 反向代理和 Certbot HTTPS。

## 环境要求

- Node.js 24 或更高版本，或 Docker 与 Docker Compose。
- 需要访问的 New API 实例及其管理员账号。
- 使用域名部署时，需要将域名解析到部署服务器。

## 配置

复制环境变量模板并生成凭据加密密钥：

```bash
cp .env.example .env
openssl rand -base64 32
```

编辑 `.env`：

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password
CREDENTIAL_ENCRYPTION_KEY=replace-with-output-of-openssl-rand-base64-32
SESSION_COOKIE_SECURE=false
DATABASE_PATH=data/channel-records.sqlite
LOG_LEVEL=info
```

注意：

- `BOOTSTRAP_ADMIN_PASSWORD` 至少 10 个字符，只在数据库中没有管理员时用于初始化账号。
- `CREDENTIAL_ENCRYPTION_KEY` 用于加密 New API 管理员密码，投入使用后不能更换。
- HTTP 访问时使用 `SESSION_COOKIE_SECURE=false`；HTTPS 生效后改为 `true`。
- `.env` 包含敏感信息，不要提交到 Git。

## Docker Compose 部署

启动服务：

```bash
docker compose up -d --build
docker compose ps
```

默认只监听宿主机 `127.0.0.1:4173`。验证服务：

```bash
curl -I http://127.0.0.1:4173/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/api/auth/me
```

首页应正常响应，未登录的 `/api/auth/me` 应返回 `401`。

常用命令：

```bash
docker compose logs -f --tail=200 importer
docker compose restart importer
docker compose down
```

SQLite 保存在 Docker 命名卷的 `/app/data/channel-records.sqlite`。不要执行：

```bash
docker compose down -v
```

该命令会删除 SQLite 数据卷。

如果 New API 运行在同一台宿主机，容器内的实例地址应使用：

```text
http://host.docker.internal:端口
```

不要在容器中使用宿主机的 `127.0.0.1`。

## Nginx HTTP 反向代理

以下配置将 `http://new.lsynb.me` 转发到本机的 `127.0.0.1:4173`：

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name new.lsynb.me;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Connection "";

        proxy_buffering off;
        proxy_cache off;

        proxy_connect_timeout 30s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

将配置保存为 `/etc/nginx/conf.d/newapi-key.conf`，然后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

启用前确认：

1. `new.lsynb.me` 的 A/AAAA 记录已指向部署服务器。
2. 服务器防火墙已放行 TCP 80。
3. 应用正在监听 `127.0.0.1:4173`。
4. HTTP 阶段保持 `SESSION_COOKIE_SECURE=false`。

## 使用 Certbot 启用 HTTPS

Ubuntu 或 Debian 安装 Certbot：

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

确认 HTTP 域名已经可以访问后，申请证书并自动启用 HTTPS 跳转：

```bash
sudo certbot --nginx \
  -d new.lsynb.me \
  --redirect \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email
```

证书生效后，把 `.env` 改为：

```dotenv
SESSION_COOKIE_SECURE=true
```

重新创建容器以加载新的环境变量：

```bash
docker compose up -d --force-recreate
```

验证 HTTPS 和证书自动续期：

```bash
curl -I http://new.lsynb.me
curl -I https://new.lsynb.me
sudo certbot renew --dry-run
systemctl status certbot.timer
```

HTTP 应跳转到 HTTPS，续期演练应成功。

## 本地 Node.js 启动

```bash
npm ci
npm run build
npm start
```

浏览器访问：

```text
http://127.0.0.1:4173
```

开发模式：

```bash
npm run dev
```

## 数据备份

本地 Node.js 部署可在停止服务后备份：

```bash
mkdir -p backups
cp data/channel-records.sqlite "backups/channel-records-$(date +%Y%m%d-%H%M%S).sqlite"
```

Docker Compose 部署应从命名卷复制数据库或使用临时容器导出。任何恢复操作都应在应用停止后进行，避免同时写入 SQLite。

## 验证

```bash
npm test
npm run build
docker compose config --quiet
```

自动化测试使用内存或临时 SQLite，不会连接真实 New API，也不会创建、修改或删除真实渠道。

## 安全边界

- New API 管理员密码使用 AES-256-GCM 加密保存。
- 管理员密码使用 scrypt 哈希保存。
- 实例访问 Key 和 Session Token 仅保存摘要。
- 完整 Anthropic Key 不写入 SQLite。
- 删除实例只删除本系统中的配置、会话和本地历史，不删除 New API 上游渠道。
- 正式公网部署应使用 HTTPS，并设置 `SESSION_COOKIE_SECURE=true`。

更完整的迁移、使用和故障排查说明见 [docs/nextjs-usage.md](docs/nextjs-usage.md)。
