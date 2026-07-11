# Claude 渠道导入工具

> 注意：点击“开始创建渠道”会向目标 New API 实例写入真实渠道。首次使用前请确认 `.env` 中的目标地址和渠道配置。

这个本地工具用于把一个或多个 Anthropic Key 顺序创建为 New API 的 Claude 渠道，并在页面中逐条显示成功或失败结果。

## 启动工具

要求本机安装 Node.js 22 或更高版本。

先复制环境配置模板：

```bash
cp .env.example .env
```

编辑 `.env`，填写目标 New API 的地址和管理员账号：

```dotenv
NEW_API_BASE_URL=http://127.0.0.1:3000
NEW_API_USERNAME=your-admin-username
NEW_API_PASSWORD=your-admin-password
HOST=127.0.0.1
PORT=4173
LOG_LEVEL=info
CHANNEL_GROUP=anthropic
CHANNEL_NAME_PREFIX=claude
CHANNEL_START_NUMBER=1
CHANNEL_CONTINUE_FROM_EXISTING=true
CHANNEL_DATE_MODE=auto
DATABASE_PATH=data/channel-records.sqlite
```

然后在项目根目录运行：

```bash
npm start
```

浏览器访问：

```text
http://127.0.0.1:4173
```

如需使用其他端口，修改 `.env` 中的 `PORT` 后重启工具。

## 查看运行日志

服务将日志以单行 JSON 输出到标准输出和标准错误，不在项目目录中生成日志文件。每条 HTTP 请求会返回 `X-Request-Id`，并在日志中记录同一个 `requestId`，用于关联页面报错和服务端请求。

主要日志事件包括：

- `application_started`、`application_shutdown_started`、`application_stopped`：服务启动和停止。
- `http_request_completed`：请求方法、路径、状态码和耗时。
- `new_api_request_completed`、`new_api_rate_limited`、`new_api_request_failed`：New API 调用结果、429 和网络错误。
- `channel_import_started`、`channel_import_completed`：导入总数、成功数、失败数和耗时。
- `channel_usage_sync_completed`：本地记录数、同步数、缺失数和耗时。

本地运行时直接查看 `npm start` 所在终端。Docker 部署时执行：

```bash
docker compose logs -f --tail=200 importer
```

`.env` 中的 `LOG_LEVEL` 支持 `debug`、`info`、`warn` 和 `error`，默认建议使用 `info`。日志不会记录请求体、管理员密码、完整 Key、Key 指纹、Cookie 或认证请求头。

## Docker Compose 部署

以下方案将应用端口只发布到服务器本机的 `127.0.0.1`，公网访问必须经过 Nginx。不要把 Compose 中的端口绑定改为 `0.0.0.0:4173:4173`，否则访问者可以绕过 Nginx Basic Auth。

### 1. 准备项目和环境配置

服务器需安装 Git、Docker Engine 和 Docker Compose 插件。然后执行：

```bash
git clone git@github.com:jiangdengke/newapi_key.git
cd newapi_key
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少填写：

```dotenv
NEW_API_BASE_URL=https://newapi.internal.example.com
NEW_API_USERNAME=your-admin-username
NEW_API_PASSWORD=your-admin-password
CHANNEL_GROUP=anthropic
CHANNEL_NAME_PREFIX=claude
CHANNEL_START_NUMBER=1
CHANNEL_CONTINUE_FROM_EXISTING=true
CHANNEL_DATE_MODE=auto
LOG_LEVEL=info
```

Compose 会强制容器内使用 `HOST=0.0.0.0`、`PORT=4173` 和 `/app/data/channel-records.sqlite`，无需修改模板中的本地监听配置。SQLite 保存在 Docker 命名卷中，重建容器不会删除记录。

`NEW_API_BASE_URL` 必须从容器内部可访问：

- New API 在远程或内网服务器：填写其可达的 HTTP/HTTPS 地址。
- New API 在同一台 Docker 宿主机并已发布端口：使用 `http://host.docker.internal:3000`，不要使用 `127.0.0.1`；Compose 已配置 Linux 所需的 `host-gateway` 映射。
- New API 与本工具位于同一个 Docker 网络：填写 New API 的服务名和容器端口，例如 `http://new-api:3000`，并先将两个 Compose 项目接入同一个外部网络。

### 2. 构建并启动

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:4173/ >/dev/null
```

应用只绑定宿主机回环地址。Compose 已为容器日志设置单文件 `10m`、最多 `5` 个文件的轮转，防止长期运行占满磁盘。

常用运维命令：

```bash
# 查看日志
docker compose logs -f --tail=200 importer

# 重启
docker compose restart importer

# 更新代码并重建
git pull --ff-only
docker compose up -d --build

# 停止但保留 SQLite 命名卷
docker compose down
```

不要执行 `docker compose down -v`，该命令会删除 SQLite 命名卷和导入历史。

升级前可在应用正常停止、SQLite 已关闭后复制数据库文件：

```bash
mkdir -p backups
docker compose stop importer
docker compose cp importer:/app/data/channel-records.sqlite \
  "backups/channel-records-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose start importer
```

备份文件包含脱敏 Key、不可逆 Key 指纹、渠道 ID 和用量历史，应当按敏感业务数据限制访问。恢复前先停止容器，并保留当前数据库作为额外回滚点。

## Nginx、Basic Auth 与 HTTPS

仓库提供 `deploy/nginx/newapi-key.conf.example`。以下以 Ubuntu/Debian 和域名 `importer.example.com` 为例。

### 1. 准备域名与软件

先将域名的 DNS A/AAAA 记录指向服务器，并确保防火墙只向公网开放 SSH、80 和 443，不开放 4173。安装 Nginx、Basic Auth 工具和 Certbot：

```bash
sudo apt update
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx
```

### 2. 创建访问账号

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-newapi-key importer-admin
sudo chown root:www-data /etc/nginx/.htpasswd-newapi-key
sudo chmod 640 /etc/nginx/.htpasswd-newapi-key
```

命令会交互式要求设置网页访问密码。该密码与 New API 管理员密码应当不同，也不要把 `.htpasswd` 放入仓库。

### 3. 启用反向代理

复制示例配置，并将其中的 `importer.example.com` 替换成真实域名：

```bash
sudo cp deploy/nginx/newapi-key.conf.example /etc/nginx/sites-available/newapi-key
sudo editor /etc/nginx/sites-available/newapi-key
sudo ln -s /etc/nginx/sites-available/newapi-key /etc/nginx/sites-enabled/newapi-key
sudo nginx -t
sudo systemctl reload nginx
```

示例配置关闭代理缓冲，以便批量导入反馈实时返回；同时允许最大 10 MB 请求体，并将上游读取超时设置为 300 秒。

### 4. 启用 HTTPS

```bash
sudo certbot --nginx -d importer.example.com
sudo certbot renew --dry-run
```

Certbot 完成后，访问 `https://importer.example.com`，浏览器应先显示 Basic Auth 登录框，通过后才能进入导入页面。正式使用前同时确认：

1. `http://服务器公网IP:4173` 无法从公网访问。
2. 未输入 Basic Auth 凭据时域名返回 `401 Unauthorized`。
3. HTTPS 证书有效，页面显示的目标 New API 地址正确。

### 多实例部署

每套实例使用独立项目目录、`.env`、Compose 项目名、宿主机回环端口和域名。例如第二套实例可在 `.env` 中增加：

```dotenv
COMPOSE_PROJECT_NAME=newapi-key-instance-2
IMPORTER_HOST_PORT=4174
```

同时把对应 Nginx 配置的 `proxy_pass` 改为 `http://127.0.0.1:4174`。独立的 `COMPOSE_PROJECT_NAME` 可避免不同实例共用容器和 SQLite 命名卷，页面标题下的 New API 地址用于进一步确认目标实例。

## 导入 Claude 渠道

1. 确认 `.env` 中的 New API 连接、渠道命名和分组配置正确，并在修改后重启工具。
2. 在 Key 输入框中每行粘贴一个 Anthropic Key。
3. 点击“开始创建渠道”。
4. 在“执行反馈”区域查看每条渠道的创建结果。

导入成功的 Key 会从输入框移除；失败的 Key 会保留，便于修正配置后重试。

## 渠道配置规则

| 配置 | 规则 |
| --- | --- |
| 渠道类型 | 固定为 Anthropic Claude，New API 类型编号为 `14` |
| 名称 | 默认格式为 `claude-MMDD-序号`，例如 `claude-0711-001` |
| 顺序 | 默认查询现有同前缀渠道，并从最高序号的下一位继续 |
| 分组 | 由 `.env` 中的 `CHANNEL_GROUP` 决定 |
| 模型 | 固定为 `claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6` |
| Key 处理 | 自动忽略空行和重复项，一次最多导入 500 个 |

页面标题下会显示当前连接的 New API 地址，便于区分多套部署实例；页面不提供连接和渠道配置编辑，也不接受浏览器覆盖这些配置。名称前缀、日期模式、起始序号、分组和是否接续现有序号都以 `.env` 为准；修改后必须重启工具。`CHANNEL_DATE_MODE=auto` 表示使用启动当天的 `MMDD`，也可以填写固定四位日期段，例如 `0711`。

导入前只通过 New API 搜索接口查询当前 `名称前缀-日期-`，例如 `claude-0711-` 对应的渠道，再从匹配结果中计算下一个序号；不会为了命名读取全部 Anthropic 渠道。即使 New API 中存在大量其他名称的渠道，也不会影响本次命名查询。

## 已导入渠道与用量

- 工具只记录由本工具成功导入并能绑定 New API 渠道 ID 的渠道。
- 页面下方显示渠道名称、脱敏 Key、状态、累计美元用量、导入时间和最后同步时间，默认每页显示 10 条记录。
- 可在查询框粘贴完整 Key 进行精确查询；查询只匹配该 Key 对应的本地导入记录，不支持模糊匹配。
- 完整 Key 通过 POST 请求发送到本机服务，仅在内存中计算 SHA-256 指纹并与数据库指纹精确比较；完整 Key 不写入数据库、URL、浏览器本地存储或接口响应。
- 使用“上一页”和“下一页”切换记录页；查询或清除查询条件后自动回到第一页。
- 点击“刷新渠道用量”后，工具只按 SQLite 中已导入的渠道名称逐条精确查询 New API，并校验渠道 ID；不会读取全部 Anthropic 渠道。
- 精确命中的渠道会读取 `used_quota`，并按 New API 状态中的 `quota_per_unit` 换算美元用量；未找到或 ID 不一致的记录会标记为“渠道不存在”。
- 工具复用管理员会话并缓存系统状态，不再设置固定刷新冷却；每次点击“刷新渠道用量”都会请求 New API。
- 如果 New API 实际返回 HTTP 429，工具会对只读请求重试一次；仍被限流时，页面会按 New API 的 `Retry-After` 提示等待时间，未返回该响应头时只提示稍后重试。
- 如果已记录的渠道 ID 不再存在，记录会标记为“渠道不存在”，历史记录不会自动删除。
- SQLite 默认保存在 `data/channel-records.sqlite`；可通过 `DATABASE_PATH` 修改路径，修改后需重启工具。
- 数据库不保存完整 Key，只保存用于页面展示的掩码和用于重复检测的 SHA-256 指纹。指纹不可用于恢复完整 Key。

## 凭据与反馈安全

- 管理员密码仅保存在被 Git 忽略的服务端 `.env` 中，不会发送到浏览器；页面只显示用于区分实例的 New API 地址。
- `.env.example` 只提供字段模板，不包含真实管理员密码。
- 渠道 Key 不写入配置文件或浏览器本地存储。
- SQLite 不保存完整渠道 Key，记录接口也不会返回 Key 指纹。
- 服务仅监听 `127.0.0.1`，默认不对局域网开放。
- 后端响应设置 `no-store`，浏览器不应缓存请求结果。
- 页面反馈只显示渠道名称和状态，不显示对应 Key。
- 上游错误中出现的管理员密码或 Key 会先脱敏再返回页面。

## 处理常见问题

### 测试连接失败

依次检查：

1. New API 地址是否包含 `http://` 或 `https://`。
2. New API 服务是否正在运行。
3. `.env` 中的管理员用户名和密码是否正确，并在修改后重启了工具。
4. 管理员账号是否启用了两步验证；当前工具不处理两步验证码。

页面不再提供单独的“测试连接”按钮。提交 Key 时，连接或登录错误会显示在“执行反馈”区域。

### 渠道创建失败

页面会继续处理剩余 Key，并保留失败的 Key。根据失败信息检查管理员权限、渠道 Key 是否有效，以及 New API 版本是否改变了渠道创建接口。

### 用量刷新失败

检查 `.env` 中的连接信息和 New API 服务状态，并确认 New API 版本仍支持渠道名称搜索且返回 `quota_per_unit` 和渠道 `used_quota`。刷新操作只精确查询 SQLite 已记录的渠道并更新本地记录，不会创建或修改 New API 渠道。

### 停止工具

回到运行 `npm start` 的终端并按 `Ctrl+C`。

## 验证本地代码

运行自动化测试：

```bash
npm test
```

测试使用模拟 New API，不会向真实实例创建渠道。
