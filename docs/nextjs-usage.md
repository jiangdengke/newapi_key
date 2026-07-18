# New API 多实例 Claude、OpenAI 与 Grok 渠道管理

> 首次部署或迁移前先备份 SQLite。`CREDENTIAL_ENCRYPTION_KEY` 用于加密实例密码和新导入的 Anthropic、OpenAI、xAI Key，投入使用后不得更换，否则已保存的凭据无法解密。

本应用基于 Next.js。系统只保留管理员账号；管理员统一维护多个标准 New API 或 Admin Hub 实例，并为每个实例生成独立访问 Key。使用者无需账号，只需在入口页面提交访问 Key，即可进入对应实例。

## 本地启动

要求 Node.js 24 或更高版本。

```bash
npm ci
cp .env.example .env
openssl rand -base64 32
```

将生成值写入 `.env` 的 `CREDENTIAL_ENCRYPTION_KEY`，并配置初始化管理员：

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password
CREDENTIAL_ENCRYPTION_KEY=replace-with-the-generated-value
SESSION_COOKIE_SECURE=false
DATABASE_PATH=data/channel-records.sqlite
LOG_LEVEL=info
```

```bash
npm run build
npm start
```

`npm run build` 会同时把浏览器所需的 CSS 和 JavaScript 复制到 standalone 目录。浏览器访问 `http://127.0.0.1:4173`。管理员首次写入数据库后，可以从生产环境删除 `BOOTSTRAP_ADMIN_PASSWORD`；只要系统中已有管理员，后续启动不会重复创建。

相对 `DATABASE_PATH` 始终以项目根目录解析，即默认数据库固定为 `data/channel-records.sqlite`。standalone 服务切换工作目录时不会把数据库写入 `.next`，因此重复执行 `npm run build` 和 `npm start` 不会清空实例配置。不要把正式数据库路径配置到 `.next/`、`dist/` 或其他构建输出目录。

## 迁移旧版数据

迁移旧版单实例 SQLite 时，保留原有连接和渠道配置：

```dotenv
NEW_API_BASE_URL=http://127.0.0.1:3000
NEW_API_USERNAME=your-new-api-administrator
NEW_API_PASSWORD=your-new-api-password
NEW_API_INSTANCE_NAME=初始 New API
CHANNEL_GROUP=anthropic
CHANNEL_NAME_PREFIX=claude
CHANNEL_START_NUMBER=1
CHANNEL_CONTINUE_FROM_EXISTING=true
CHANNEL_PRIORITY=0
CHANNEL_WEIGHT=0
CHANNEL_DATE_MODE=auto
```

`CHANNEL_DATE_MODE` 或管理端实例的“日期模式”支持三种写法：`auto` 使用当天 `MMDD`，4 位数字使用固定日期段，留空则不包含日期。名称分别形如 `claude-0714-001`、`claude-0711-001` 和 `claude-001`；启用接续序号时只接续相同名称格式的现有渠道。

三个 `NEW_API_*` 连接变量必须同时填写或同时不填。未填写时，迁移会按旧记录的 `new_api_base_url` 分组，为每个历史地址创建一个停用的“待配置旧实例”，并保留全部渠道历史；管理员登录后补全连接信息并启用即可。已有实例升级后默认没有访问 Key，需要管理员显式生成。

从旧多用户版本升级时，普通用户、普通用户 Session 和用户实例绑定会被删除，管理员账号和管理员 Session 保留。迁移使用 SQLite 事务执行；启动前必须先备份数据库。

```bash
mkdir -p backups
cp data/channel-records.sqlite "backups/channel-records-$(date +%Y%m%d-%H%M%S).sqlite"
```

schema 6 为实例增加连接协议和 Admin Hub 目标站点 ID。升级时，已有实例会自动保留为 `new-api` 协议，目标站点为空，不会改变原有渠道连接方式。需要回滚时，停止新版本服务并恢复升级前的 SQLite 备份；旧版本不能直接使用已经升级并写入新配置的数据库。

## 管理和使用

管理员可以新增、编辑、停用、删除和测试实例，也可以为每个实例生成、重新生成或停用访问 Key。编辑操作在当前页面弹窗中完成，不会跳转到页面顶部。实例配置中的渠道优先级和渠道权重会应用到该实例后续新建的每个渠道；优先级允许负整数，权重必须是非负整数，默认值均为 `0`。完整访问 Key 只在生成响应中显示一次，SQLite 仅保存 SHA-256 摘要、掩码和状态。

管理员登录后可通过页面右上角“修改密码”输入当前密码和两次新密码。新密码至少 10 个字符；修改成功后当前会话继续有效，该管理员的其他登录会话立即失效，旧密码不能再登录。此操作直接更新 SQLite 中的管理员密码哈希，不修改 `.env`；`BOOTSTRAP_ADMIN_PASSWORD` 仍只负责首次初始化管理员。

实例支持以下连接协议：

- `标准 New API`：继续使用 `/api/channel/*` 渠道接口，已有实例和环境变量初始化实例默认使用该协议。
- `Admin Hub`：使用管理员账号登录后取得 Session Cookie，再通过 `/api/admin-hub/channels` 管理供应商渠道，不依赖登录响应中的访问令牌。填写服务地址和账号凭据后点击“加载站点”，系统会实时读取该账号当前可见的站点并生成下拉选项；保存时只持久化所选站点 ID，渠道搜索、创建和同步只作用于该站点。

标准 New API 支持 Claude、OpenAI 和 Grok 三类渠道。工作区会通过管理员接口 `GET /api/group/` 动态读取该实例当前已有分组，导入时只能单选其中一个；Claude、OpenAI、Grok 分别优先默认选择 `anthropic`、`openai`、`xai`，默认分组不存在时自动选择列表第一项。三个渠道类型分别保留当前选择，并提供“刷新分组”按钮；提交导入后服务端会再次确认分组仍存在，避免使用已经删除的分组。Grok 使用官方 xAI Key、New API 类型 `48` 和平台内置的 `https://api.x.ai` 地址，不提供自定义兼容 Base URL。Admin Hub 继续只支持 Claude 和 OpenAI，并保持原有固定分组；Grok 切换按钮不会在 Admin Hub 实例工作区显示，服务端也会拒绝手工构造的 Grok 导入请求。

Deepnix 开放平台配置示例为服务地址 `https://open.deepnix.ai`、协议 `Admin Hub`。加载可见站点后从下拉框选择 `AGT站（ID 13）`；站点列表不写死在应用中，会随当前账号权限动态更新。New API 或 Admin Hub 管理员密码只在新建实例时填写，编辑实例不提供修改入口，加载站点和保存配置时会自动复用数据库中已加密保存的密码。创建渠道时只选择并发布到所选站点，不会发布到账号可见的其他站点；同步通过 Admin Hub 的批量状态和累计用量接口更新本地记录。当前实例地址仍保持唯一，同一个 Admin Hub 地址不能同时建立多个分别指向不同站点的实例。

“测试连接”除状态和登录外还会执行一次只读渠道查询。只有目标站点渠道权限验证通过才会显示成功，因此可以识别“能够登录但无标准渠道访问令牌”这类协议不匹配问题。

删除实例前会显示二次确认，并列出即将删除的本地渠道历史数量。确认后只删除本系统中的实例配置、实例访问 Key、该实例访客 Session 和本地渠道历史；应用不会连接 New API，也不会删除已经在上游创建的真实渠道。该本地删除不可撤销，正式环境操作前应先备份 SQLite。

管理端顶部的“全部 Key 记录”可跨实例分页查看已导入渠道，并支持按实例、渠道名称或完整 Anthropic、OpenAI、xAI Key 筛选。管理端记录和实例内“已导入渠道”均默认每页显示 10 条，可在分页区域切换为每页 10、20、50 或 100 条。管理员可以删除单条本地记录，也可以勾选并批量删除当前页记录；删除前会显示数量和二次确认。该操作只删除 SQLite 中的记录、用量历史和加密 Key，不会删除 New API 上游真实渠道。新导入的完整 Key 使用 `CREDENTIAL_ENCRYPTION_KEY` 以 AES-256-GCM 加密后写入 SQLite；管理员可在记录旁按需显示或复制，普通列表接口和访客接口始终仅返回掩码。历史记录如果没有保存密文则无法恢复完整 Key。每条记录可直接进入所属实例工作区。

管理端和实例工作区均提供手动同步按钮；勾选“自动同步（30 秒）”后，页面仅在浏览器标签页可见时自动同步，默认关闭。自动同步不会重复弹出成功提示，且同一实例不会并发执行重复同步；管理端自动同步只处理已启用且存在本地渠道记录的实例。每个实例的渠道查询最多同时执行 5 个请求，多个实例在管理端按顺序处理，以减少 New API 限流和上游负载。同步发现某条记录的累计用量首次从 `0` 变为大于 `0` 时，页面会显示包含实例、渠道、脱敏 Key 和当前累计金额的轻提示；后续同步不会为同一段持续用量重复提示。同步只更新本地 SQLite 记录，不会修改或删除 New API 上游渠道。

两个记录列表都会分别显示“余额”和“累计用量”。余额直接读取 New API 渠道的 `balance` 字段；累计用量继续根据 `used_quota / quota_per_unit` 换算为美元。Admin Hub 响应如果没有可用的顶层累计用量，则汇总当前模板的 `sites[].used_quota` 站点明细，避免上游站点已经产生消费而本地仍显示 `$0.00`。余额与累计用量含义不同，余额不计入累计用量统计；历史记录升级后新增余额字段默认为 `$0.00`，下一次同步后会更新。New API 状态接口未返回有效 `quota_per_unit` 时，应用按 New API 标准单位 `500000 quota = 1 USD` 换算。

保存实例、测试连接、生成或停用访问 Key、登录、导入、查询和同步等操作会在页面右上角显示轻提示。成功提示会自动消失，错误提示保留更久并支持手动关闭；页面内原有的导入明细、查询摘要和错误信息仍会保留，便于继续核对具体结果。

使用者在默认入口提交访问 Key 后，服务端签发绑定单个实例的 HttpOnly Session Cookie。使用者可以在标准 New API 实例工作区分别导入 Anthropic Key、官方 OpenAI Key 和官方 xAI Key；Admin Hub 实例继续提供 Claude 与 OpenAI。使用者可以查看和精确查询历史、同步状态与用量，但不能访问管理端或其他实例。重新生成或停用访问 Key 会立即撤销该实例的全部访客 Session；已经开始处理的单次导入允许完成，撤销从后续请求起生效。

| 项目 | 渠道导入行为 |
| --- | --- |
| 渠道类型 | Claude 使用 New API 类型编号 `14`；OpenAI 使用类型编号 `1`；Grok 使用 xAI 类型编号 `48` |
| 模型 | Claude 固定为 `claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6`；OpenAI 固定为 `gpt-5.6-sol`；Grok 固定为下方列出的 10 个模型 |
| Key 来源 | Claude 接收 Anthropic Key；OpenAI 仅接收官方 OpenAI Key；Grok 仅接收官方 xAI Key；均不提供自定义兼容接口 Base URL |
| 分组 | 标准 New API 从当前实例已有分组中单选；Claude、OpenAI、Grok 分别优先默认选择 `anthropic`、`openai`、`xai`；Admin Hub 继续使用原有固定分组 |
| 名称 | 三类渠道都使用实例配置的名称前缀和日期模式，并共享序号避让；例如 `channel-0714-001` 或 `channel-001` |
| 优先级和权重 | 由实例配置决定，新建渠道时写入 New API；现有实例升级后默认为 `0` 和 `0` |
| 反馈 | 通过 NDJSON 流逐条返回进度和结果 |
| 导入 Key 存储 | 新导入的完整 Key 以 AES-256-GCM 加密保存，同时保存掩码和 SHA-256 指纹；历史未加密记录无法恢复 |
| 实例访问 Key 存储 | 仅保存掩码和 SHA-256 摘要，完整值只显示一次 |

Grok 固定模型列表：

```text
grok-4.20-0309-non-reasoning
grok-4.20-0309-reasoning
grok-4.20-multi-agent-0309
grok-4.3
grok-4.5
grok-build-0.1
grok-imagine-image
grok-imagine-image-quality
grok-imagine-video
grok-imagine-video-1.5
```

Claude、OpenAI 和 Grok 在标准 New API 的同一导入面板中并列显示为三个切换按钮，一次只显示当前类型的 Key 输入区；切换类型时，各类型尚未提交的输入内容和所选分组分别保留。Admin Hub 仍显示 Claude 和 OpenAI 两个按钮。导入成功的 Key 会从对应输入内容中移除，失败的 Key 会保留。标准 New API 创建 OpenAI 渠道时使用类型 `1` 和平台内置的官方 OpenAI 地址；创建 Grok 渠道时使用类型 `48` 和平台内置的官方 xAI 地址。Admin Hub 的 OpenAI 渠道使用 `platform_channel_type=openai`、`model_series=openai.gpt` 并发布到实例选定站点。用量同步只查询当前实例在 SQLite 中已有的渠道名称并校验渠道 ID，不读取全部渠道，也不会跨实例同步。

## Docker Compose 部署

```bash
docker compose up -d --build
docker compose ps
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/api/auth/me
```

最后一条命令应返回 `401`。Compose 默认只向宿主机 `127.0.0.1:4173` 发布端口，SQLite 保存到 `/app/data/channel-records.sqlite` 的命名卷，日志单文件最多 10 MB、保留 5 个文件。

New API 在同一宿主机时，容器内应使用 `http://host.docker.internal:端口`，不能使用 `127.0.0.1`。浏览器通过外部 HTTPS 入口访问时，将 `SESSION_COOKIE_SECURE=true`；TLS、域名和外部反向代理不属于本应用配置范围。

```bash
docker compose logs -f --tail=200 importer
docker compose restart importer
docker compose down
```

不要执行 `docker compose down -v`，否则会删除 SQLite 命名卷。本应用按单进程、单容器使用 SQLite，不支持多个副本同时挂载同一个数据库文件。

## 日志和验证

日志以“时间、级别、中文事件、`key=value` 字段”的单行格式写入标准输出和标准错误，耗时会自动显示为毫秒或秒。API 响应包含 `X-Request-Id`，页面错误会显示同一请求 ID，日志中的 `request` 字段可用于关联请求。日志不会主动记录请求体、完整 Key、Key 指纹、Cookie、认证头或明文密码。

```text
2026-07-13 02:15:24 INFO  导入完成 instance=3 total=10 success=8 failure=2 duration=1.6s
2026-07-13 02:15:25 INFO  用量同步完成 instance=3 synced=8 missing=1 duration=420ms
2026-07-13 02:15:26 WARN  New API 请求限流 operation=search_channels status=429
```

- 本地验证后仍回到入口页：确认本地 HTTP 使用 `SESSION_COOKIE_SECURE=false`。
- 旧渠道被归入“待配置旧实例”：管理员补全该实例的 New API 管理员凭据并启用，再生成访问 Key。
- 访问 Key 丢失：管理员只能重新生成；旧 Key 和现有访客 Session 会立即失效。
- New API 返回 429：只读请求会安全重试一次；渠道创建不自动重试，避免重复创建。
- Admin Hub 测试返回非 JSON 的 HTTP 301：确认部署版本已使用带尾斜杠的 `/api/admin-hub/channels/` 规范查询路径；Deepnix 会将不带尾斜杠的渠道列表请求重定向为该路径。
- Admin Hub 创建返回空响应的 HTTP 307：确认渠道创建同样使用带尾斜杠的 `/api/admin-hub/channels/`；Deepnix 会使用 307 将不带尾斜杠的 POST 重定向到规范路径。
- Admin Hub 创建返回 `site_group_overrides of type []string`：站点分组覆盖必须使用“站点 ID → 分组数组”的结构，例如 AGT 站的 Claude 渠道发送 `{ "13": ["anthropic"] }`，OpenAI 渠道发送 `{ "13": ["openai"] }`，不能发送单个分组字符串。

```bash
npm test
npm run build
docker compose config --quiet
npm audit --audit-level=moderate
```

自动化测试使用内存数据库以及模拟的标准 New API、Admin Hub，覆盖 Claude、OpenAI 与 Grok 渠道，并验证 Admin Hub 拒绝 Grok 导入；不会连接真实实例或创建真实渠道。
