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
- 支持 Docker Compose 部署。

## 环境要求

- Node.js 24 或更高版本，或 Docker 与 Docker Compose。
- 需要访问的 New API 实例及其管理员账号。

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
