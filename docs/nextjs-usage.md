# New API 多实例 Claude、OpenAI 与 Grok 渠道管理

> 首次部署或迁移前先备份 SQLite。`CREDENTIAL_ENCRYPTION_KEY` 用于加密实例密码和新导入的 Anthropic、OpenAI、xAI Key，投入使用后不得更换，否则已保存的凭据无法解密。

本应用基于 Next.js。管理员和普通用户从同一个入口使用账号密码登录。管理员统一维护多个 New API 实例、访问成员和普通用户账号；普通用户只能访问管理员授权的实例。

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

三个 `NEW_API_*` 连接变量必须同时填写或同时不填。未填写时，迁移会按旧记录的 `new_api_base_url` 分组，为每个历史地址创建一个停用的“待配置旧实例”，并保留全部渠道历史；管理员登录后补全连接信息并启用即可。已有实例升级后默认没有访问成员，需要管理员显式添加。

从 schema 1 的旧多用户版本直接升级时，旧普通账号和旧绑定不再使用，需要重新创建。管理员账号和管理员会话保留。使用 SQLite 事务迁移；先停服务再备份，或使用 SQLite 在线备份功能。

```bash
mkdir -p backups
cp data/channel-records.sqlite "backups/channel-records-$(date +%Y%m%d-%H%M%S).sqlite"
```

schema 11 关闭访问 Key 登录并撤销旧访客会话，保留实例、成员、渠道前缀和导入历史。管理员需要为现有使用者创建普通账号，并绑定其原有访问成员。从 schema 9 直接升级时，已有成员前身及其历史记录会迁入对应的默认成员，但旧访问 Key 不再可用。要回滚，先停止服务，再恢复匹配的旧代码和升级前的数据库备份。回滚到旧版会恢复该版本的 Key 登录行为。

schema 8 为实例增加 `channel_models` 列，保存各渠道类型的默认模型；升级时该列为空，实例继续使用内置默认模型，行为不变。

schema 7 移除 Admin Hub 连接协议，删除实例表中的 `connection_protocol` 和 `admin_hub_target_site_id` 两列。升级时，原有 Admin Hub 实例会被自动停用，并撤销其访客 Session，避免按 New API 协议访问 Admin Hub 地址；这些实例的本地渠道历史保留，管理员可以改为 New API 地址后重新启用，或直接删除。需要回滚时，停止新版本服务并恢复升级前的 SQLite 备份；旧版本不能直接使用已经升级的数据库。

## 管理和使用

界面沿用 New API 控制台风格。管理员导航包含“实例管理”“用户管理”“Key 记录”和“账号安全”；普通用户从“我的实例”进入已授权实例，再切换“渠道导入”和“导入记录”。地址栏会记录当前页面，例如 `#/instances/3/records`，刷新后停留在原页面。主题和侧边栏状态保存在当前浏览器。

管理员可以新增、编辑、停用、删除和测试实例。新增实例只需填写实例名称、New API 地址及管理员账号密码；编辑页只提供连接信息和启停状态，实例级高级默认值保留在存储中但不在界面编辑。已有实例的数据不会因为表单简化而改变。渠道类型、Key、模型和各目标的分组在「新建渠道」流程中选择；访问成员仍可设置自己的名称前缀、日期、序号、优先级和权重。删除实例前会弹出确认窗口。

### 新建渠道并推送到多个实例

1. 从左侧进入「新建渠道」，填写渠道类型、Key 和模型。可搜索并勾选该类型的内置模型候选，也可手动输入自定义模型；候选仅供快速选择，不代表供应商完整或实时目录。可每行输入一个 Key；同一批目标共用这份类型、Key 和模型。页面预选该类型的内置模型，不使用任意一台实例的模型作为全局默认值。
2. 点击「下一步：选择实例」，勾选已启用且已授权的 New API 实例。每个实例从自己的可用分组中选一个，不会自动替用户决定分组。
3. 点击「确认推送」。页面依次提交到所选实例，分别显示成功、失败和未确认的数量。每个实例仍按自己的成员或实例配置命名和记录；一台失败不会回滚其他台已经创建的渠道。

请保持推送页面打开；离开页面不会再提交尚未开始的目标，但已经发出的请求可能已经创建渠道。工具不会自动重试；出现未确认结果时，先在目标实例核对，再决定是否重新提交。原有实例工作区仍可单独导入和查看记录。

### 实例访问与记录

在“用户管理”创建或编辑账号时，直接勾选允许访问的实例。也可以从“实例管理 → 管理访问成员 → 绑定用户”选择已有普通账号，再点击“确认绑定”。首次授权时系统自动生成成员名称和渠道前缀，日期、序号、优先级及权重沿用实例默认值。已绑定但停用的成员可在列表中重新启用，不用重复绑定。

一个账号可访问多个实例，每个实例对该账号最多关联一个成员；一个成员不能同时绑定多个账号。已有成员的配置仍可在“编辑成员”中调整。改绑会把该成员的历史记录交给新账号，操作前请核对归属。管理员可以编辑、启停账号和重置密码，停用或重置密码会撤销旧会话；首版不提供自助注册或删除账号。

停用或删除成员会撤销账号在该实例的访问权，不影响其他实例。删除成员后，其记录保留为“未归属成员”，仅管理员可见。“Key 记录”和“导入记录”仍支持搜索、过滤和排序；管理员还可按成员筛选。

管理员登录后可在左侧导航的“账号安全”页输入当前密码和两次新密码。新密码至少 10 个字符；修改成功后当前会话继续有效，该管理员的其他登录会话立即失效，旧密码不能再登录。此操作直接更新 SQLite 中的管理员密码哈希，不修改 `.env`；`BOOTSTRAP_ADMIN_PASSWORD` 仍只负责首次初始化管理员。

实例统一使用 New API 的 `/api/channel/*` 渠道接口，支持 Claude、OpenAI、Grok 和 AWS 四类渠道。工作区会通过管理员接口 `GET /api/group/` 动态读取该实例当前已有分组，导入时只能单选其中一个；Claude、OpenAI、Grok 分别优先默认选择 `anthropic`、`openai`、`xai`，默认分组不存在时自动选择列表第一项。三个渠道类型分别保留当前选择，并提供“刷新分组”按钮；提交导入后服务端会再次确认分组仍存在，避免使用已经删除的分组。Grok 使用官方 xAI Key、New API 类型 `48` 和平台内置的 `https://api.x.ai` 地址，不提供自定义兼容 Base URL。

New API 管理员密码只在新建实例时填写，编辑实例不提供修改入口，保存配置时会自动复用数据库中已加密保存的密码。当前实例地址保持唯一。

“测试连接”除状态和登录外还会执行一次只读渠道查询。只有渠道权限验证通过才会显示成功，因此可以识别“能够登录但无渠道访问权限”这类问题。

工具会根据登录响应自动选择认证方式。旧版 New API 返回用户 ID 和会话 Cookie，后续请求携带 Cookie 和 `New-Api-User`。v1.0.0-rc.45 起登录返回约 15 分钟有效的 Bearer 访问令牌和 `new_api_refresh` 刷新 Cookie；工具在令牌过期前 60 秒调用 `/api/user/auth/refresh` 续期并保存轮换后的刷新 Cookie，请求被拒绝时刷新后重试一次，刷新失败时才用已保存的管理员凭据重新登录。

删除实例前会显示二次确认，并列出即将删除的本地渠道历史数量。确认后会删除本系统中的实例配置、该实例的访问成员和绑定，以及本地渠道历史；不会删除普通账号或上游真实渠道。该本地删除不可撤销，正式环境操作前应先备份 SQLite。

左侧导航的“Key 记录”页可跨实例分页查看已导入渠道，并支持按实例、渠道名称或完整 Anthropic、OpenAI、xAI Key 筛选。“Key 记录”和实例工作区的“导入记录”均默认每页显示 10 条，可在分页区域切换为每页 10、20、50 或 100 条。管理员可以删除单条本地记录，也可以勾选并批量删除当前页记录；删除前会显示数量和二次确认。该操作只删除 SQLite 中的记录、用量历史和加密 Key，不会删除 New API 上游真实渠道。新导入的完整 Key 使用 `CREDENTIAL_ENCRYPTION_KEY` 以 AES-256-GCM 加密后写入 SQLite；管理员可在记录旁按需显示或复制，普通列表接口和访客接口始终仅返回掩码。历史记录如果没有保存密文则无法恢复完整 Key。每条记录可直接进入所属实例工作区。

管理端和实例工作区均提供手动同步按钮；打开“自动同步（30 秒）”开关后，页面仅在浏览器标签页可见时自动同步，默认关闭。自动同步不会重复弹出成功提示，且同一实例不会并发执行重复同步；管理端自动同步只处理已启用且存在本地渠道记录的实例。每个实例的渠道查询最多同时执行 5 个请求，多个实例在管理端按顺序处理，以减少 New API 限流和上游负载。同步发现某条记录的累计用量首次从 `0` 变为大于 `0` 时，页面会显示包含实例、渠道、脱敏 Key 和当前累计金额的轻提示；后续同步不会为同一段持续用量重复提示。同步只更新本地 SQLite 记录，不会修改或删除 New API 上游渠道。

两个记录列表都会分别显示“余额”和“累计用量”。余额直接读取 New API 渠道的 `balance` 字段；累计用量继续根据 `used_quota / quota_per_unit` 换算为美元。余额与累计用量含义不同，余额不计入累计用量统计；历史记录升级后新增余额字段默认为 `$0.00`，下一次同步后会更新。New API 状态接口未返回有效 `quota_per_unit` 时，应用按 New API 标准单位 `500000 quota = 1 USD` 换算。

保存实例、测试连接、管理访问成员、登录、导入、查询和同步等操作会在页面右上角显示轻提示。成功提示会自动消失，错误提示保留更久并支持手动关闭；页面内原有的导入明细、查询摘要和错误信息仍会保留，便于继续核对具体结果。

登录后服务端签发 HttpOnly 会话 Cookie，每次实例操作都核对账号和成员授权。普通用户在实例工作区只能看到绑定成员的导入记录和用量，不能访问管理端或未授权的实例。管理员可以查看该实例的全部记录；管理员导入仍使用实例默认值，不属于成员。已开始处理的单次导入允许完成，权限变更对后续请求生效。

| 项目 | 渠道导入行为 |
| --- | --- |
| 渠道类型 | Claude 使用 New API 类型编号 `14`；OpenAI 使用类型编号 `1`；Grok 使用 xAI 类型编号 `48`；AWS 使用 Amazon Bedrock 类型编号 `33` |
| 模型 | 「新建渠道」由用户按本批选择模型；实例工作区仍使用该实例保留的渠道默认模型。内置候选只作便捷建议，不代表上游完整目录 |
| Key 来源 | Claude 接收 Anthropic Key；OpenAI 仅接收官方 OpenAI Key；Grok 仅接收官方 xAI Key；AWS 每行接收 `AccessKey|SecretAccessKey|Region` 或 `APIKey|Region`；均不提供自定义兼容接口 Base URL |
| AWS 设置 | 按每行凭证的分段数自动识别密钥格式，写入渠道设置 `aws_key_type`（`ak_sk` 或 `api_key`），两种格式可混在同一批；导入页会逐行检查凭证，列出缺少区域、区域无效、分段不对等问题及所在行号，有问题时不会提交；导入时可选 AWS 接口 `aws_api_type`：InvokeModel（默认，旧接口）或 Mantle（Messages API）；默认优先选择 `aws` 分组 |
| 分组 | 从当前实例已有分组中单选；Claude、OpenAI、Grok 分别优先默认选择 `anthropic`、`openai`、`xai` |
| 名称 | 使用成员的名称前缀和日期模式（未设置时沿用实例），各渠道类型共享序号避让；例如 `zhangsan-0714-001` 或 `zhangsan-001`；同一前缀同时只允许一批导入 |
| 优先级和权重 | 成员设置优先，未设置时沿用实例配置，新建渠道时写入 New API；现有实例升级后默认为 `0` 和 `0` |
| 反馈 | 通过 NDJSON 流逐条返回进度和结果 |
| 导入 Key 存储 | 新导入的完整 Key 以 AES-256-GCM 加密保存，同时保存掩码和 SHA-256 指纹；历史未加密记录无法恢复 |

实例编辑页不再提供渠道默认模型编辑。普通实例工作区沿用已有默认值；「新建渠道」在提交前预选内置建议，支持搜索、多选和自定义模型，最终列表只用于当前推送批次。

Grok 内置默认模型列表：

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

Claude、OpenAI 和 Grok 在同一导入面板中并列显示为三个切换按钮，一次只显示当前类型的 Key 输入区；切换类型时，各类型尚未提交的输入内容和所选分组分别保留。导入成功的 Key 会从对应输入内容中移除，失败的 Key 会保留。创建 OpenAI 渠道时使用类型 `1` 和平台内置的官方 OpenAI 地址；创建 Grok 渠道时使用类型 `48` 和平台内置的官方 xAI 地址。用量同步只查询当前实例在 SQLite 中已有的渠道名称并校验渠道 ID，不读取全部渠道，也不会跨实例同步。

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
- 旧渠道被归入“待配置旧实例”：管理员补全该实例的 New API 管理员凭据并启用，再添加访问成员。
- 普通用户忘记密码：管理员在“用户管理”中设置新密码，旧会话立即失效。
- 新增成员提示“该实例已有成员使用这个名称前缀”：同一实例内每个成员的名称前缀必须不同，否则渠道名称会混在一起。
- New API 返回 429：只读请求会安全重试一次；渠道创建不自动重试，避免重复创建。
- 测试连接提示“登录响应中缺少管理员用户 ID”：确认部署版本已支持 Bearer 访问令牌登录；New API v1.0.0-rc.45 及以后的登录响应不再直接返回用户 ID。
- 升级后原 Admin Hub 实例显示为停用：schema 7 已移除 Admin Hub 协议。将实例地址改为 New API 地址后重新启用，或删除该实例。

```bash
npm test
npm run build
docker compose config --quiet
npm audit --audit-level=moderate
```

自动化测试使用内存数据库和模拟 New API，覆盖 Claude、OpenAI 与 Grok 渠道，并验证 schema 7 停用旧 Admin Hub 实例；不会连接真实实例或创建真实渠道。
