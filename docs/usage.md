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
PORT=4173
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
