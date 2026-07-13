## 2026-07-11 - Task: 搭建 Claude Key 顺序导入 New API 渠道的本地页面

### What was done

- 创建本地 Claude 渠道导入页面，支持配置 New API 地址和管理员账号、批量输入 Key、预览顺序名称及实时查看逐条结果。
- 通过 New API 管理接口建立管理员会话，并以 Anthropic Claude 类型逐条创建渠道；固定使用三个指定 Claude Opus 模型和 `anthropic` 默认分组。
- 实现现有序号接续、空行与重复 Key 过滤、成功与失败统计、失败 Key 保留重试，以及管理员密码和渠道 Key 脱敏。
- 增加本地启动及操作文档，并提供不写入真实 New API 的模拟端到端测试。

### Testing

- `npm test`：通过；共 5 项测试，覆盖 Key 去重、日期校验、顺序命名、敏感信息脱敏，以及模拟管理员登录与渠道创建完整流程。
- `node --check "server.js" && node --check "lib/new-api-client.js" && node --check "lib/validation.js" && node --check "public/app.js" && node --check "test/server.test.js" && node --check "test/validation.test.js"`：通过。
- 编辑器诊断：已检查本轮 JavaScript、页面及测试文件，未发现诊断错误。
- `GET http://127.0.0.1:3000/api/status`：本机 New API 可访问，识别版本为 `v1.0.0-rc.20`；未使用真实渠道 Key 执行写入测试。

### Notes

- `package.json`：定义无第三方依赖的 Node.js 启动与测试命令。
- `.gitignore`：排除环境配置、依赖目录和本机临时文件。
- `server.js`：提供本地页面服务、连接测试和流式导入接口。
- `lib/new-api-client.js`：封装 New API 状态、登录、渠道查询和创建请求。
- `lib/validation.js`：实现输入校验、Key 去重、顺序命名和敏感信息脱敏。
- `public/index.html`：提供连接、渠道配置、Key 提交和执行反馈界面。
- `public/app.js`：实现页面校验、命名预览、连接测试和流式结果处理。
- `public/styles.css`：提供桌面与移动端页面样式。
- `test/validation.test.js`：验证输入、命名和脱敏规则。
- `test/server.test.js`：使用模拟 New API 验证完整导入协议和安全反馈。
- `docs/usage.md`：说明启动、导入、安全规则、常见问题和验证方法。
- `progress.md`：记录本轮实现、验证证据和回滚方式。
- 回滚点：本任务开始前项目目录为空。确认不再需要本工具后，可在项目根目录执行 `rm -rf package.json .gitignore server.js lib public test docs progress.md` 完整回滚。

## 2026-07-11 - Task: 将 New API 管理员连接信息迁移到服务端环境配置

### What was done

- 将 New API 地址、管理员用户名和管理员密码统一迁移到服务端 `.env`，启动时完成校验并供连接测试与渠道创建复用。
- 页面移除管理员密码输入，只展示服务端返回的目标地址和用户名；浏览器请求不再发送管理员连接信息。
- 增加不含真实凭据的环境配置模板，并扩展自动化验证，确保浏览器伪造的管理员密码不会覆盖服务端配置，且配置接口不会返回密码。
- 同步更新启动、配置、安全说明和常见问题文档。

### Testing

- `npm test`：通过；共 5 项测试，包含服务端连接配置、配置接口密码隔离、浏览器伪造凭据忽略、顺序创建及反馈脱敏验证。
- `node --check "server.js" && node --check "lib/validation.js" && node --check "public/app.js" && node --check "test/server.test.js" && node --check "test/validation.test.js"`：通过。
- 编辑器诊断：已检查本轮后端、前端和测试文件，未发现诊断错误。

### Notes

- `.env`：保存本机 New API 地址、管理员账号密码和导入工具端口；已由 `.gitignore` 排除。
- `.env.example`：提供可复制的环境配置模板，不包含真实凭据。
- `server.js`：启动时加载并校验环境配置，接口只使用服务端管理员凭据。
- `lib/validation.js`：将渠道导入参数与管理员连接参数分离校验。
- `public/index.html`：移除管理员密码输入，改为展示服务端目标配置。
- `public/app.js`：加载非敏感服务端配置，连接测试和导入请求不再携带管理员凭据。
- `test/server.test.js`：验证服务端配置优先级及密码不下发。
- `test/validation.test.js`：适配渠道参数与连接参数分离后的校验边界。
- `docs/usage.md`：增加 `.env` 配置和重启说明。
- `progress.md`：追加本轮环境配置迁移记录。
- 回滚方式：删除 `.env` 和 `.env.example`，并将上述后端、页面、测试及文档文件恢复到上一轮记录对应版本；回滚后管理员连接信息需重新由页面提交。

## 2026-07-11 - Task: 增加 SQLite 渠道记录与累计用量同步

### What was done

- 为通过本工具导入的渠道建立 SQLite 历史记录，保存 New API 渠道 ID、渠道名称、状态、导入与同步时间、累计配额及换算后的美元用量。
- 完整渠道 Key 不写入数据库；本地仅保存至少隐藏四个原始字符的显示掩码，以及用于重复导入检测的 SHA-256 指纹。
- 增加历史记录读取和用量同步接口；同步时按渠道 ID 读取 New API 的状态与 `used_quota`，结合 `quota_per_unit` 换算累计美元用量，并标记已不存在的渠道。
- 将渠道分组、名称前缀、起始序号、是否接续现有序号、日期模式和数据库路径设为 `.env` 默认配置，同时保留页面临时修改能力。
- 在导入反馈下方增加历史记录表和“刷新渠道用量”操作，并补充 SQLite、重复 Key、配置默认值和用量同步验证。

### Testing

- `npm test`：通过；共 8 项测试，覆盖 SQLite Key 脱敏与指纹去重、渠道 ID 绑定、美元换算、状态同步、渠道缺失、环境默认值，以及模拟完整导入流程。
- `node --check server.js && node --check lib/new-api-client.js && node --check lib/record-store.js && node --check lib/validation.js && node --check public/app.js && node --check test/server.test.js && node --check test/record-store.test.js && node --check test/validation.test.js`：通过。
- SQLite 只读结构检查：通过；`channel_records` 共 14 个字段，未设置原始 Key 字段；测试数据库字节检查确认不包含测试用完整 Key。
- 本地运行验证：`/api/config`、`/api/records` 和 `/api/records/sync` 均返回成功；当前正式数据库为 0 条记录，因此同步结果为 0 条、缺失 0 条。
- 真实 New API 验证仅执行状态、登录和渠道读取；未调用渠道创建接口，未写入或修改真实 New API 渠道。

### Notes

- `.env`：增加本机渠道默认值和 SQLite 数据库路径；继续由 `.gitignore` 排除。
- `.env.example`：增加不含真实凭据的渠道默认值和数据库路径模板。
- `.gitignore`：排除本地 `data/` 数据目录。
- `server.js`：接入 SQLite 记录、配置默认值、历史列表和用量同步接口。
- `lib/new-api-client.js`：增加完整 Anthropic 渠道读取和按名称查询新建渠道能力。
- `lib/record-store.js`：定义 SQLite 数据结构、Key 掩码与指纹、导入记录和用量同步逻辑。
- `lib/validation.js`：增加环境渠道默认值校验和日期模式处理。
- `public/index.html`：增加已导入渠道历史记录区域和用量刷新按钮。
- `public/app.js`：加载环境默认值，渲染历史记录并触发用量同步。
- `public/styles.css`：增加历史表格、状态和移动端展示样式。
- `test/server.test.js`：扩展模拟 New API，验证记录接口、重复导入拦截和用量同步。
- `test/record-store.test.js`：验证数据库不保存完整 Key、美元换算、状态同步和渠道缺失处理。
- `test/validation.test.js`：验证固定与自动日期模式及环境布尔值校验。
- `docs/usage.md`：补充环境默认值、SQLite 数据、安全边界和用量同步说明。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 将 New API 管理员连接信息迁移到服务端环境配置`。由于目录不是 Git 仓库，代码回滚需恢复该记录对应版本；本地 SQLite 数据可在停止服务后执行 `rm -f data/channel-records.sqlite data/channel-records.sqlite-shm data/channel-records.sqlite-wal` 清除。

## 2026-07-11 - Task: 精简页面并强制使用服务端渠道配置

### What was done

- 删除页面中的 New API 连接和渠道配置区域，仅保留 Key 提交、执行反馈和已导入渠道记录。
- 前端导入请求只提交 Key；渠道分组、名称前缀、日期、起始序号和接续规则全部由服务端 `.env` 决定。
- 后端忽略浏览器请求中伪造的渠道参数，确保隐藏配置无法被手工请求覆盖。
- 清理被删除界面对应的前端脚本和样式，并同步更新操作文档。

### Testing

- `npm test`：通过；覆盖页面不再包含连接与渠道配置控件，以及浏览器伪造渠道参数时仍使用服务端默认值。
- `node --check server.js && node --check public/app.js && node --check test/server.test.js`：通过。
- 编辑器诊断：已检查本轮后端、页面、样式和测试文件，未发现诊断错误。

### Notes

- `server.js`：导入接口只从请求体读取 Key，渠道参数固定使用服务端环境配置。
- `public/index.html`：删除连接与渠道配置区域，更新提交确认文案。
- `public/app.js`：删除连接测试、配置加载和名称预览逻辑，导入请求只发送 Key。
- `public/styles.css`：删除已移除控件对应的样式。
- `test/server.test.js`：验证页面控件已隐藏，并验证请求体不能覆盖服务端渠道配置。
- `docs/usage.md`：更新为仅通过 `.env` 管理连接与渠道配置的操作流程。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 增加 SQLite 渠道记录与累计用量同步`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 修复用量同步触发 New API HTTP 429

### What was done

- 在服务进程内复用 New API 管理员会话，并将系统状态缓存 5 分钟，减少重复登录和状态请求。
- 导入或同步后设置 30 秒用量同步冷却；冷却期内直接返回 SQLite 最新记录，不再请求 New API。
- 只读状态、渠道列表和渠道查询在 HTTP 429 时按 `Retry-After` 最多重试一次；渠道创建请求不自动重试，避免重复创建。
- 页面在冷却期内明确显示本地记录和剩余等待秒数。

### Testing

- `npm test`：通过；共 8 项测试，新增覆盖首次渠道列表返回 429 后自动恢复、管理员会话复用和同步冷却。
- `node --check server.js && node --check lib/new-api-client.js && node --check public/app.js && node --check test/server.test.js`：通过。
- 真实只读同步验证：第一次同步成功更新 1 条记录；紧接着第二次同步返回 `skipped: true` 和 30 秒等待时间，未再次访问 New API。

### Notes

- `lib/new-api-client.js`：增加安全只读请求的 429 有限重试和友好错误提示。
- `server.js`：增加会话复用、状态缓存和同步冷却。
- `public/app.js`：增加同步冷却提示。
- `test/server.test.js`：增加限流恢复、会话复用和冷却验证。
- `docs/usage.md`：补充刷新限流保护说明。
- 回滚点：上一条 `2026-07-11 - Task: 精简页面并强制使用服务端渠道配置`。

## 2026-07-11 - Task: 精简 Key 提交区域提示与操作

### What was done

- 删除页面顶部的英文标识、功能说明和管理员凭据提示，只保留页面标题。
- 删除 Key 提交区域的编号、配置说明、内存提示和确认复选框，仅保留 Key 输入、有效数量和创建按钮。
- 清理确认复选框对应的前端逻辑和无用样式，提交操作改为点击按钮后直接执行。

### Testing

- `npm test`：通过；共 8 项测试，包含页面不再输出确认复选框和冗余提示的断言。
- `node --check public/app.js && node --check test/server.test.js`：通过。
- 编辑器诊断：已检查本轮页面、脚本、样式和测试文件，未发现诊断错误。
- 残留引用检查：未发现确认复选框、顶部安全提示、区块说明或内存提示相关引用。

### Notes

- `public/index.html`：删除冗余提示和确认复选框，精简 Key 提交结构。
- `public/app.js`：删除确认复选框查询及提交后重置逻辑。
- `public/styles.css`：删除已移除提示和复选框对应样式，创建按钮右对齐。
- `test/server.test.js`：增加精简页面元素不存在的验证。
- `docs/usage.md`：删除导入步骤中的确认复选框操作。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 修复用量同步触发 New API HTTP 429`。

## 2026-07-11 - Task: 增加已导入渠道分页与完整 Key 精确查询

### What was done

- 已导入渠道默认按每页 10 条展示，并增加上一页、下一页和页码状态。
- 增加完整 Key 精确查询：浏览器通过 POST 将 Key 提交到本机服务，服务端仅在内存中计算 SHA-256 指纹并与 SQLite 记录精确匹配。
- 查询结果只返回原有脱敏记录，不返回完整 Key 或 Key 指纹；错误 Key 返回空结果，查询与清除操作都会回到第一页。
- 增加分页参数校验、页码归一化及接口与存储层回归测试。

### Testing

- `npm test`：通过；覆盖 SQLite 多页查询、超出范围页码归一化、完整 Key 精确命中、错误 Key 空结果、响应不包含完整 Key，以及分页接口参数校验。
- `node --check "server.js" && node --check "lib/record-store.js" && node --check "public/app.js" && node --check "test/server.test.js" && node --check "test/record-store.test.js"`：通过。
- 编辑器诊断：已检查本轮后端、前端、页面、样式和测试文件，未发现诊断错误。
- 未启动本地服务，未访问或修改真实 New API 数据。

### Notes

- `server.js`：增加分页与完整 Key 精确查询接口，并校验页码、每页数量和查询 Key 长度。
- `lib/record-store.js`：增加按 SHA-256 指纹筛选的分页查询和累计用量汇总。
- `public/index.html`：增加完整 Key 查询框、清除操作和分页按钮。
- `public/app.js`：增加查询条件、分页状态、翻页操作及当前结果刷新逻辑。
- `public/styles.css`：增加查询区和分页区的桌面与移动端样式。
- `test/server.test.js`：验证页面控件、分页接口、精确查询、安全响应和非法分页参数。
- `test/record-store.test.js`：验证 SQLite 分页、页码归一化、精确指纹匹配和空结果。
- `docs/usage.md`：补充分页操作、精确查询流程和完整 Key 安全边界。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 精简 Key 提交区域提示与操作`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 删除用量同步固定 30 秒冷却

### What was done

- 删除导入和用量同步后的固定 30 秒冷却，每次点击“刷新渠道用量”都会直接请求 New API。
- 保留管理员会话复用、系统状态缓存、同步请求期间按钮禁用，以及只读请求遇到 HTTP 429 后重试一次的行为。
- New API 重试后仍返回 429 时，按其 `Retry-After` 响应提示等待时间；未返回有效等待时间时只提示稍后重试，不再伪造固定 30 秒。
- 更新页面同步反馈、回归测试和使用说明。

### Testing

- `npm test`：通过；共 3 项测试，覆盖导入后立即同步、连续同步不被本工具跳过、管理员会话和系统状态复用、429 自动重试，以及最终 429 按 `Retry-After` 返回提示。
- `node --check "server.js" && node --check "lib/new-api-client.js" && node --check "public/app.js" && node --check "test/server.test.js"`：通过。
- 编辑器诊断：已检查本轮后端、New API 客户端、页面脚本和测试文件，未发现诊断错误。
- 未启动正式服务，未访问或修改真实 New API 数据；自动化测试仅使用临时模拟服务。

### Notes

- `server.js`：删除同步冷却常量、状态、判断和响应字段，每次同步直接读取 New API 渠道。
- `lib/new-api-client.js`：最终收到 429 时依据 `Retry-After` 生成等待提示，不再固定提示 30 秒。
- `public/app.js`：删除冷却跳过响应对应的页面提示分支。
- `test/server.test.js`：改为验证立即同步、连续同步和真实 429 提示。
- `docs/usage.md`：更新刷新行为和 429 处理说明。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 增加已导入渠道分页与完整 Key 精确查询`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 使用渠道名称前缀加速导入命名查询

### What was done

- 导入命名前不再读取全部 Anthropic 渠道，改为通过 New API 搜索接口仅查询当前 `名称前缀-日期-` 对应的渠道。
- 搜索结果在本地再次按名称前缀和 Anthropic 类型严格过滤，再计算当前最大序号，保持原有接续命名和重名规避行为。
- 页面等待提示改为“正在登录并查询同前缀渠道”，避免误导为全量读取。
- 扩展模拟接口和回归测试，验证 New API 总渠道数超过 10000 时，导入仍不调用全量渠道列表并能正常生成名称。

### Testing

- `node --test test/*.test.js`：通过；共 3 项测试，包含总渠道数模拟为 10001 时只调用 `claude-0711-` 前缀搜索、继续生成 `claude-0711-107` 和 `claude-0711-108`，以及既有 SQLite、分页、精确 Key 查询、同步和 429 行为。
- `node --test "test/server.test.js"`：通过；服务端导入集成测试单独执行成功。
- `node --check "server.js" && node --check "lib/new-api-client.js" && node --check "public/app.js" && node --check "test/server.test.js"`：通过。
- 编辑器诊断：已检查本轮后端、New API 客户端、页面脚本和测试文件，未发现诊断错误。
- 未启动正式服务，未访问或修改真实 New API 数据；自动化测试仅使用临时模拟服务。

### Notes

- `lib/new-api-client.js`：增加按名称前缀分页搜索 Anthropic 渠道名称的方法。
- `server.js`：导入命名改为只读取当前前缀对应的渠道名称。
- `public/app.js`：更新导入准备阶段的页面提示。
- `test/server.test.js`：模拟大量无关渠道并验证导入不再调用全量渠道列表。
- `docs/usage.md`：说明前缀搜索命名规则及大量无关渠道不再影响导入。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 删除用量同步固定 30 秒冷却`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 按本地导入记录精确同步渠道用量

### What was done

- 用量同步不再分页读取全部 Anthropic 渠道，改为以 SQLite 已导入记录为清单，按渠道名称逐条精确查询 New API。
- 每个查询结果必须同时匹配记录中的渠道名称和渠道 ID 才会更新状态与用量；未找到或 ID 不一致时沿用现有规则标记为“渠道不存在”。
- 本地没有导入记录时直接返回空同步结果，不登录也不请求 New API。
- 保留管理员会话复用、系统状态缓存和只读请求遇到 HTTP 429 后重试一次的行为。

### Testing

- `node --test test/*.test.js`：通过；共 3 项测试，覆盖单条记录精确同步、连续同步、全量渠道列表不被调用、渠道缺失标记、搜索接口 429 提示，以及既有导入、分页和 Key 安全行为。
- `node --check "server.js" && node --check "lib/new-api-client.js" && node --check "test/server.test.js"`：通过。
- 编辑器诊断：已检查本轮后端、New API 客户端和服务端测试文件，未发现诊断错误。
- 未启动正式服务，未访问或修改真实 New API 数据；自动化测试仅使用临时模拟服务。

### Notes

- `lib/new-api-client.js`：拆分可返回空结果的渠道名称精确搜索方法，创建后查询继续保留必须命中的校验。
- `server.js`：同步时只查询 SQLite 已记录渠道，并校验 New API 渠道 ID。
- `test/server.test.js`：验证同步不再调用全量列表、精确更新用量、缺失标记和搜索接口限流。
- `docs/usage.md`：更新用量同步范围、渠道 ID 校验和缺失记录规则。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 使用渠道名称前缀加速导入命名查询`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 在页面显示当前连接的 New API 地址

### What was done

- 在页面标题下显示当前服务端 `.env` 配置的 New API 地址，便于部署多套导入服务后快速识别当前实例。
- 页面通过现有非敏感配置接口读取目标地址，不增加连接编辑入口，也不显示管理员密码。
- 地址以普通文本展示，不生成可点击链接，避免远程部署时浏览器误打开地址中的本地回环主机。
- 增加页面结构、样式和回归断言，并更新使用及安全说明。

### Testing

- `node --test test/*.test.js`：通过；共 3 项测试，包含页面目标地址标识、配置接口不返回管理员密码，以及既有导入、同步、分页和 Key 安全行为。
- `node --check "public/app.js" && node --check "test/server.test.js"`：通过。
- 编辑器诊断：已检查本轮页面、脚本、样式和服务端测试文件，未发现诊断错误。
- 未启动正式服务，未访问或修改真实 New API 数据；自动化测试仅使用临时模拟服务。

### Notes

- `public/index.html`：在页面标题下增加当前 New API 地址展示区域。
- `public/app.js`：页面初始化时读取非敏感配置并显示目标地址。
- `public/styles.css`：增加目标地址文本样式和长地址换行规则。
- `test/server.test.js`：验证页面包含当前 New API 标识，现有配置安全断言继续通过。
- `docs/usage.md`：说明多实例识别用途和连接配置安全边界。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：上一条 `2026-07-11 - Task: 按本地导入记录精确同步渠道用量`；由于目录不是 Git 仓库，需将上述文件恢复到该记录对应版本。

## 2026-07-11 - Task: 增加部署日志与 Docker、Nginx 部署支持

### What was done

- 增加单行 JSON 结构化日志，覆盖服务启停、HTTP 请求、New API 请求与限流、渠道导入汇总和用量同步汇总，并为每个 HTTP 请求返回可关联日志的请求 ID。
- 日志统一输出到标准输出和标准错误，不记录请求体、管理员密码、完整 Key、Key 指纹、Cookie 或认证请求头；增加敏感字段和 Key、Cookie 形态文本的日志脱敏。
- 增加可配置监听地址和优雅停机处理；本地默认继续监听 `127.0.0.1`，Docker 容器内由 Compose 设置为 `0.0.0.0`。
- 增加 Node.js Docker 镜像、Compose 服务、SQLite 命名卷和 Docker 日志轮转；宿主机端口仅绑定 `127.0.0.1`，防止绕过 Nginx 认证直接访问。
- 增加 Nginx Basic Auth 反向代理示例，并补充 HTTPS、部署、升级、日志查看、数据库备份和多实例隔离说明。

### Testing

- `node --test "test/logger.test.js" && node --test "test/validation.test.js" && node --test "test/record-store.test.js" && node --test "test/server.test.js"`：通过；共 10 项测试，覆盖日志结构和脱敏、请求 ID、导入和同步日志事件，以及既有导入、分页、用量同步和配置校验行为。
- `node --check "server.js" && node --check "lib/logger.js" && node --check "lib/new-api-client.js" && node --check "test/logger.test.js" && node --check "test/server.test.js"`：通过。
- `docker compose config --quiet`：通过；Compose 配置可解析，应用端口只发布到宿主机 `127.0.0.1`。
- `git diff --check`：通过；未发现空白错误。
- 编辑器诊断：已检查本轮 JavaScript 文件，未发现诊断错误。
- `docker build -t newapi-key-importer:test .`：未完成；Dockerfile 已进入基础镜像解析阶段，但访问 Docker Hub 认证服务时网络超时，未能拉取 `node:24-alpine`。部署前需在可访问 Docker Hub 的服务器重新执行镜像构建，不能将本次结果视为镜像已构建通过。
- 未启动正式服务，未访问或修改真实 New API 数据。

### Notes

- `.env.example`：增加本地监听地址和日志级别配置，并修正渠道配置仍可在页面编辑的过期说明。
- `.gitignore`：排除包含 SQLite 运维备份的 `backups/` 目录，避免敏感业务记录被误提交。
- `.dockerignore`：排除环境凭据、本地数据、测试和开发文档，缩小镜像构建上下文。
- `Dockerfile`：使用非 root Node.js 用户运行应用，并准备持久化数据目录。
- `docker-compose.yml`：增加本地回环端口发布、SQLite 命名卷、宿主机访问映射、优雅停止和日志轮转。
- `deploy/nginx/newapi-key.conf.example`：增加 Basic Auth、反向代理、批量请求大小和流式反馈配置示例。
- `lib/logger.js`：增加结构化日志级别、JSON 输出和敏感信息递归脱敏。
- `lib/new-api-client.js`：记录不含 URL 查询参数、请求体和认证头的 New API 操作结果、429 和网络错误。
- `server.js`：增加请求 ID、HTTP/导入/同步日志、可配置监听地址和信号优雅停机。
- `test/logger.test.js`：验证敏感字段、Key 形态文本和 Cookie 形态文本不会写入日志。
- `test/server.test.js`：验证请求 ID、业务日志事件和真实导入流程日志不包含测试密码、Key 或 Session Cookie。
- `docs/usage.md`：增加日志说明、Docker Compose、Nginx Basic Auth、HTTPS、备份和多实例部署步骤。
- `progress.md`：追加本轮实现、验证证据、文件清单与回滚点。
- 回滚点：提交 `c61e0a5`。在确认工作区没有需要保留的后续改动后，可执行 `git restore --source=c61e0a5 -- .env.example docs/usage.md lib/new-api-client.js server.js test/server.test.js progress.md && rm -rf .dockerignore Dockerfile docker-compose.yml deploy/nginx lib/logger.js test/logger.test.js` 回滚本轮文件。

## 2026-07-11 - Task: 迁移为 Next.js 多用户多实例管理系统

### What was done

- 将原生 Node.js HTTP 服务和静态页面迁移为 Next.js App Router 全栈应用，增加登录页、管理端和实例工作区。
- 增加系统管理员与普通用户模型；普通用户固定绑定一个 New API 实例，服务端在每个实例接口上校验用户角色和实例归属。
- 增加多 New API 实例管理、连接测试、启停控制、普通用户创建、实例改绑、密码重置和会话失效处理。
- 使用 SQLite 保存系统用户、Session、实例配置和用户实例绑定；Session 仅保存随机令牌的 SHA-256 摘要，用户密码使用 scrypt 哈希。
- 使用 AES-256-GCM 和环境主密钥加密 New API 管理员密码；完整渠道 Key 仍不写入 SQLite。
- 增加旧版 SQLite 事务迁移：把原 `.env` 连接创建为初始实例，并将旧渠道记录按 New API 地址归属到该实例。
- 保留逐 Key NDJSON 流式反馈、顺序命名、重复 Key 检测、完整 Key 精确查询、历史分页和按本地记录同步用量。
- 增加每实例独立的 New API 会话、状态缓存和导入锁，避免实例间共享管理员 Cookie 或并发命名状态。
- 将 Dockerfile 改为 Next.js standalone 多阶段构建，Compose 继续使用单容器和 SQLite 持久卷。
- 删除旧 `server.js`、`public/`、旧存储层和 Nginx 示例；外部 TLS 与反向代理不再属于应用实现范围。
- 增加 `docs/nextjs-usage.md`，说明初始化管理员、加密密钥、旧数据迁移、本地启动和容器部署。
- 通过 npm override 将 Next.js 间接依赖 PostCSS 从有已知中危问题的 `8.4.31` 覆盖为 `8.5.16`。

### Testing

- `npm test`：通过；共 13 项测试，覆盖密码和凭据加密、旧数据库迁移、角色与实例授权、停用用户会话失效、停用实例访问、登录限流和 NDJSON 流式导入安全反馈。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功，全部页面和 Route Handler 完成编译与页面数据收集。
- standalone 冒烟测试：使用临时内存 SQLite 和临时管理员启动 `.next/standalone/server.js`，登录成功且 Session Cookie 可访问 `/api/auth/me`；测试后已停止进程。
- `docker compose config --quiet`：通过。
- `git diff --check`：通过。
- `npm audit --audit-level=moderate`：通过，报告 0 个漏洞。
- `npm ls next postcss`：确认 Next.js 16.2.10 使用覆盖后的 PostCSS 8.5.16。
- `docker build -t newapi-key-importer:next-test .`：未完成；访问 Docker Hub 认证端点获取 `node:24-alpine` 令牌时网络超时。Dockerfile 尚需在可访问 Docker Hub 的环境完成镜像构建验证。
- 未访问真实 New API，也未创建或修改真实渠道。

### Notes

- 首次启动必须配置 `BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_PASSWORD` 和 `CREDENTIAL_ENCRYPTION_KEY`。
- 本地 HTTP 使用 `SESSION_COOKIE_SECURE=false`；浏览器通过 HTTPS 访问时应设为 `true`。
- `CREDENTIAL_ENCRYPTION_KEY` 投入使用后必须稳定保存，更换密钥会导致 SQLite 中已加密的 New API 密码无法解密。
- 本应用按单进程、单容器方式使用 SQLite，不支持多个应用副本同时挂载同一个数据库文件。
- 回滚点：提交 `da5e11f`。本轮尚未提交；回滚前应先备份迁移后的 SQLite，因为旧版服务无法识别新增的用户、实例和会话数据结构。

## 2026-07-11 - Task: 将环境配置模板注释改为中文

### What was done

- 将环境配置模板中的英文说明全部翻译为中文，保持变量名、示例值和配置行为不变。

### Testing

- 英文注释残留检查：通过；`.env.example` 中所有以 `#` 开头的说明均为中文。
- `git diff --check`：通过；未发现空白错误。

### Notes

- `.env.example`：将初始化管理员、加密密钥、Session Cookie、渠道默认值、SQLite 路径和日志级别说明改为中文。
- `progress.md`：追加本轮修改、验证证据和回滚方式。
- 回滚方式：将 `.env.example` 的中文注释替换回本轮修改前的英文注释；变量和示例值无需调整。

## 2026-07-11 - Task: 将 New API 环境变量改为可选迁移配置

### What was done

- 将 New API 连接和渠道默认值从环境配置模板的默认有效项移到旧版迁移区域，并默认注释。
- 明确新部署应在系统管理端维护多个 New API 实例，只有迁移旧版单实例数据时才需要临时启用这些变量。

### Testing

- 配置模板检查：通过；默认有效配置中不再包含 `NEW_API_*` 或 `CHANNEL_*`，旧版迁移示例仍完整保留。
- `git diff --check`：通过；未发现空白错误。

### Notes

- `.env.example`：调整配置顺序和默认启用状态，避免新部署误绑定一个固定 New API。
- `progress.md`：追加本轮修改、验证证据和回滚方式。
- 回滚方式：将模板底部的 `NEW_API_*` 和 `CHANNEL_*` 示例取消注释并移回文件开头。

## 2026-07-11 - Task: 改为管理员与实例访问 Key 鉴权

### What was done

- 移除普通用户账号、普通用户 Session 和用户实例绑定模型，系统仅保留管理员账号登录。
- 为每个 New API 实例增加独立访问 Key；完整值仅在生成时显示一次，SQLite 只保存 SHA-256 摘要、掩码、状态和版本。
- 增加访客入口和实例绑定 Session；访客可导入 Anthropic Key、查看与精确查询历史、同步状态和用量，但不能访问管理端或其他实例。
- 重新生成或停用访问 Key 时，在同一事务中撤销该实例全部访客 Session；停用实例也会撤销访客 Session。
- 将 SQLite 升级到版本 2；旧多用户数据迁移时删除普通用户相关数据，保留管理员和渠道历史。无法直接归属的旧渠道按历史 New API 地址创建停用占位实例，不再要求固定环境变量才能启动。
- 管理端增加访问 Key 生成、重新生成、一次性显示、复制和停用操作；默认入口改为访问 Key 验证，管理员登录作为独立入口。
- 修正 Next.js standalone 的本地启动命令，并同步更新环境模板和使用文档。

### Testing

- `npm test`：通过；共 14 项测试，覆盖 v1 到 v2 数据迁移、旧用户清理、管理员 Session 保留、访问 Key 不明文落库、Key 重生成与停用撤销会话、访客跨实例隔离、管理端拒绝、访问 Key 登录和 NDJSON 导入。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功，页面与全部 Route Handler 完成编译。
- standalone 冒烟测试：使用临时内存 SQLite 在 `127.0.0.1:4184` 启动 `.next/standalone/server.js`，未登录访问 `/api/auth/me` 返回 `401`；测试进程已停止。
- `npm audit --audit-level=moderate`：通过，报告 0 个漏洞。
- `docker compose config --quiet`：通过。
- `git diff --check`：通过，未发现空白错误。
- 编辑器诊断：已检查本轮应用、组件、数据层和测试文件，未发现诊断错误。
- 未访问真实 New API，也未创建或修改真实渠道。

### Notes

- `lib/application-store.js`：新增 v2 SQLite 数据层、管理员与访客 Session、访问 Key 生命周期和旧数据占位实例迁移。
- `lib/security.js`：增加高熵实例访问 Key 的生成、摘要和掩码工具，并支持解密空的占位实例密码。
- `lib/auth.js`：将鉴权主体改为管理员或实例访客，并在服务端执行实例边界校验。
- `lib/admin-validation.js`：增加实例访问 Key 输入校验，移除普通用户管理输入校验。
- `lib/runtime-context.js`：切换到新数据层并增加访问 Key 登录失败计数。
- `lib/client-api.js`：允许登录请求抑制全局会话过期事件，避免无效凭据被误判为已有会话失效。
- `app/api/access/login/route.js`：增加访问 Key 登录、失败限流和实例绑定 Session 签发。
- `app/api/admin/instances/[instanceId]/access-key/route.js`：增加管理员生成、重新生成和停用实例访问 Key 的接口。
- `app/api/auth/login/route.js`：改为仅认证管理员并返回统一身份主体。
- `app/api/auth/me/route.js`：返回管理员或访客身份主体。
- `app/api/instances/route.js`：按身份主体返回可访问实例，并隐藏连接凭据和访问 Key 信息。
- `app/api/instances/[instanceId]/config/route.js`：对访客隐藏管理员用户名和访问 Key 元数据。
- `app/api/admin/users/route.js`、`app/api/admin/users/[userId]/route.js`：删除普通用户管理接口。
- `components/access-gateway.js`：新增默认实例访问 Key 入口和管理员登录切换。
- `components/application-client.js`：按管理员或访客身份进入管理端或唯一实例工作区。
- `components/login-view.js`：改为管理员专用登录页。
- `components/admin-dashboard.js`：移除普通用户管理，增加实例访问 Key 管理和一次性完整值展示。
- `app/globals.css`：增加访问 Key 展示样式并删除普通用户界面的孤儿样式。
- `test/application-store.test.js`：验证 v2 迁移、敏感值落盘和访问 Key 撤销语义。
- `test/authorization.test.js`：验证访客实例隔离、管理端拒绝和访问 Key 登录。
- `test/instance-route.test.js`：改为使用访客 Session 验证真实导入流程。
- `test/security.test.js`：增加访问 Key 格式、随机性、摘要和掩码验证。
- `test/system-store.test.js`：删除旧普通用户数据层测试，由 `test/application-store.test.js` 替代。
- `package.json`：将生产启动命令改为 Next.js standalone server。
- `.env.example`：将初始化管理员说明调整为仅在系统无管理员时生效。
- `docs/nextjs-usage.md`：更新管理员、访客访问 Key、迁移和撤销行为说明。
- `progress.md`：追加本轮实现、验证证据和回滚点。
- 回滚点：本轮实施前的“Next.js 管理员加普通用户绑定实例”工作区状态。回滚前必须先恢复迁移前的 SQLite 备份；仅回退代码无法恢复已删除的普通用户、Session 和绑定数据。由于该基线尚未形成独立提交，不应使用整仓 `git restore`，应按上述文件清单反向恢复。

## 2026-07-11 - Task: 修复 standalone 页面静态资源未加载

### What was done

- 修复本地 `npm start` 启动 standalone 服务时没有携带 `.next/static` 的问题，避免页面只有初始加载文字且 React 无法继续执行。
- 构建完成后自动把浏览器所需的 CSS 和 JavaScript 复制到 standalone 输出目录。
- Docker 镜像改为直接复制已完整准备的 standalone 输出，避免重复维护静态资源复制步骤。
- 更新本地构建与启动说明，明确 `npm run build` 会准备完整 standalone 目录。

### Testing

- `npm run build`：通过；Next.js 生产构建成功，构建后脚本已生成 `.next/standalone/.next/static`。
- `npm test`：通过；共 14 项测试。
- 页面静态资源冒烟测试：使用临时内存 SQLite 在 `127.0.0.1:4185` 启动 standalone 服务；首页返回 HTTP 200，首页引用的 CSS 和全部 JavaScript 文件均返回 HTTP 200；测试进程已停止。
- 未访问真实 New API，也未创建或修改真实渠道。

### Notes

- `prepare-standalone.js`：将 `.next/static` 复制到 standalone 服务实际读取的目录。
- `package.json`：在生产构建完成后执行 standalone 静态资源准备脚本。
- `Dockerfile`：移除重复的静态资源复制步骤，直接使用完整 standalone 输出。
- `docs/nextjs-usage.md`：补充构建过程会准备 CSS 和 JavaScript 静态资源的说明。
- `progress.md`：追加本轮修复、验证证据和回滚方式。
- 回滚方式：将 `package.json` 的构建命令恢复为仅执行 `next build`，删除 `prepare-standalone.js`，并恢复 Dockerfile 中单独复制 `.next/static` 的步骤；但本地 `npm start` 将重新出现静态资源 404，不建议回滚。

## 2026-07-11 - Task: 增加管理员跨实例 Key 记录总览

### What was done

- 在管理端顶部增加“全部 Key 记录”总览，集中显示所有 New API 实例已导入的 Anthropic Key 渠道记录。
- 支持按 New API 实例、渠道名称和完整 Anthropic Key 筛选，列表使用服务端分页，避免实例或记录增加后一次加载全部数据。
- 记录列表展示所属实例、渠道名称与 ID、Key 掩码、状态、累计用量、导入时间和最后同步时间，并可直接进入所属实例工作区。
- 新增管理员专用查询接口；访客无法调用，完整 Anthropic Key 仅在请求内用于计算指纹，不会写入数据库或出现在响应中。

### Testing

- `node --test "test/authorization.test.js"`：通过；覆盖管理员跨实例查询、实例/渠道/完整 Key 组合筛选、响应不包含完整 Key，以及访客访问总览接口返回 403。
- `npm test`：通过；共 15 项测试。
- `npm run build`：通过；Next.js 生产构建成功，`/api/admin/records/query` 已加入 Route Handler 清单。
- `git diff --check`：通过，未发现空白错误。
- 编辑器诊断：已检查数据层、管理员查询接口、管理端组件、样式和授权测试，未发现诊断错误。
- 未访问真实 New API，也未创建或修改真实渠道。

### Notes

- `lib/application-store.js`：增加管理员跨实例渠道记录分页、实例筛选、渠道名称匹配和完整 Key 指纹精确查询。
- `app/api/admin/records/query/route.js`：新增管理员专用 Key 总览查询接口与请求参数校验。
- `components/admin-records-overview.js`：新增管理端 Key 记录筛选、分页、脱敏展示和实例跳转组件。
- `components/admin-dashboard.js`：在管理端顶部接入跨实例 Key 记录总览。
- `app/globals.css`：增加总览筛选区、记录表和移动端布局样式。
- `test/authorization.test.js`：新增管理员跨实例记录查询与访客拒绝访问测试。
- `docs/nextjs-usage.md`：说明管理员 Key 总览的使用方式和完整 Key 安全边界。
- `progress.md`：追加本轮实现、验证证据和回滚方式。
- 回滚方式：删除管理员记录查询接口和总览组件，并移除管理端接入、对应样式与授权测试；数据结构未变更，现有渠道记录不受影响。

## 2026-07-11 - Task: 增加全局轻提示反馈

### What was done

- 增加固定在页面右上角的全局轻提示，区分成功、信息和错误状态，支持自动消失及手动关闭，并适配移动端和减少动画偏好。
- 为实例保存与连接测试、访问 Key 生成复制与停用、管理员和访客登录、会话失效、管理数据读取、跨实例记录查询、渠道导入、历史查询及用量同步补充即时反馈。
- 保留页面内原有的详细状态、导入进度和查询摘要；轻提示只负责让当前操作结果立即可见，未对被动加载成功和正常翻页增加干扰提示。

### Testing

- `npm test`：通过；共 15 项测试。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功，提示组件和全部接入页面完成编译。
- `git diff --check`：通过，未发现空白错误。
- 编辑器诊断：已检查本轮修改文件，未发现诊断错误。
- 未访问真实 New API，也未创建或修改真实渠道。

### Notes

- `lib/toast.js`：新增浏览器端全局提示事件发送工具。
- `components/toast-viewport.js`：新增提示队列、自动关闭和手动关闭界面。
- `app/layout.js`：在应用根布局挂载全局提示容器。
- `app/globals.css`：增加提示状态、固定定位、移动端和减少动画样式。
- `components/admin-dashboard.js`：为实例管理、连接测试和访问 Key 操作增加提示。
- `components/admin-records-overview.js`：为跨实例 Key 记录读取失败增加提示。
- `components/access-gateway.js`、`components/login-view.js`：为访客访问 Key 和管理员登录失败增加提示。
- `components/application-client.js`：为认证成功、退出和会话失效增加提示。
- `components/instance-workspace.js`：为导入、历史查询、条件清除和用量同步增加提示。
- `docs/nextjs-usage.md`：补充轻提示的显示范围和保留页面详细反馈的说明。
- `progress.md`：追加本轮实现、验证证据和回滚方式。
- 回滚方式：删除 `lib/toast.js` 和 `components/toast-viewport.js`，移除根布局挂载、提示样式及各组件中的 `showToast` 调用；该回滚不涉及 SQLite 数据结构或已有渠道记录。

## 2026-07-11 - Task: 支持自定义渠道优先级和权重

### What was done

- 在管理员新增和编辑 New API 实例时增加渠道优先级、渠道权重配置，并在实例卡片中展示当前值。
- 将两个配置作为实例级渠道默认值持久化到 SQLite；schema 升级到 v3，现有实例和旧数据占位实例自动迁移为优先级 `0`、权重 `0`。
- 渠道导入时把实例配置的 `priority` 和 `weight` 写入 New API 渠道创建请求；访客提交导入时不能覆盖管理员配置。
- 优先级允许 JavaScript 安全整数范围内的负数或非负数，权重只允许非负安全整数，浏览器和服务端均执行输入约束。
- 旧版单实例环境迁移配置增加可选的 `CHANNEL_PRIORITY` 和 `CHANNEL_WEIGHT`。

### Testing

- `npm test`：通过；共 16 项测试，覆盖默认值、负优先级、非负权重、非法输入、SQLite v1 到 v3 迁移，以及非零配置进入 New API 创建 payload。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功，管理员表单、实例 API 和导入链路完成编译。
- 自动化测试只使用内存或临时 SQLite 和模拟 New API；未访问真实 New API，也未创建或修改真实渠道。

### Notes

- `lib/validation.js`：增加优先级和权重的默认值、整数范围校验及导入参数归一化。
- `lib/admin-validation.js`：将管理员实例输入中的优先级和权重纳入服务端校验。
- `lib/application-store.js`：增加 `channel_priority`、`channel_weight` 字段、v3 自动迁移、实例映射和保存更新逻辑。
- `lib/runtime-context.js`：支持旧版初始实例环境变量并将配置加载到实例运行时。
- `lib/instance-service.js`、`lib/new-api-client.js`：将实例默认值传入 New API 渠道创建 payload。
- `app/api/instances/[instanceId]/config/route.js`：在实例渠道默认配置中返回优先级和权重。
- `components/admin-dashboard.js`：增加配置输入、编辑回填、提交转换和实例卡片展示。
- `.env.example`、`docs/nextjs-usage.md`：补充默认值、输入规则和迁移配置说明。
- `test/validation.test.js`、`test/application-store.test.js`、`test/instance-route.test.js`：增加校验、迁移和创建 payload 回归覆盖。
- 回滚方式：移除上述字段和调用链，并把 `CURRENT_SCHEMA_VERSION` 恢复为 `2`。SQLite 已添加的列可保留不用；如必须物理删除列，应先备份数据库并通过新表迁移，不应直接对生产数据库执行破坏性操作。

## 2026-07-11 - Task: 修复 standalone 重建后实例配置消失

### What was done

- 定位到 standalone `server.js` 会把进程工作目录切换到 `.next/standalone`，导致相对 `DATABASE_PATH` 被错误解析到构建输出目录；后续 `npm run build` 重建 `.next` 时数据库随之丢失。
- 将相对数据库路径固定解析到应用项目根目录，并在本地生产启动脚本中显式传递项目根路径；绝对路径和 `:memory:` 保持原有行为。
- 停止旧服务并备份根目录旧数据库，重新构建后完成旧数据自动迁移；最终服务继续使用 `data/channel-records.sqlite`。
- 增加路径解析回归测试，并更新文档，明确正式数据库不得放在 `.next` 等构建目录。

### Testing

- `npm test`：通过；共 17 项测试，新增覆盖 standalone 环境下相对数据库路径固定解析到项目根目录。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功。
- 持久化完整验证：根目录数据库迁移后为 schema v3、包含 2 个实例；停止服务并再次执行 `npm run build` 后实例数仍为 2；重新启动后仍为 2。
- 服务健康检查：`GET /api/auth/me` 返回预期的 HTTP 401。
- 构建输出检查：新的 `.next/standalone/data` 不再生成业务数据库。
- `git diff --check`：通过；编辑器诊断未发现错误。
- 未连接真实 New API，也未创建或修改真实渠道。

### Notes

- `lib/runtime-context.js`：增加数据库路径解析函数，将相对路径绑定到应用根目录。
- `package.json`：本地 `npm start` 显式传递 `APPLICATION_ROOT_PATH`。
- `test/runtime-context.test.js`：验证相对路径、绝对路径和内存数据库路径规则。
- `docs/nextjs-usage.md`：补充 standalone 数据持久化和构建目录限制说明。
- `backups/channel-records-before-path-fix-20260711.sqlite`：保存修复前的根目录旧数据库备份。
- `progress.md`：追加本轮根因、验证证据和回滚方式。
- 回滚方式：恢复 `lib/runtime-context.js` 和 `package.json` 的旧路径行为并删除对应测试；这会重新导致本地 standalone 把 SQLite 写入 `.next`，不建议回滚。数据库回滚可在停止服务后使用本轮备份恢复，但会丢弃修复后产生的数据，执行前必须再次确认。

## 2026-07-11 - Task: 使用弹窗编辑并支持安全删除实例

### What was done

- 将实例编辑从页面顶部复用表单改为当前页面弹窗，移除自动滚动到顶部的行为；新增实例表单继续保持独立，编辑时管理员密码留空仍表示保留原密码。
- 在每个实例卡片增加删除入口和二次确认弹窗，明确展示即将删除的本地渠道历史数量，并提示不会连接 New API 或删除上游真实渠道。
- 删除操作使用 SQLite 事务，仅清除本地实例配置、实例访问 Key、访客 Session 和该实例渠道历史；其他实例、管理员账号及 New API 上游渠道不受影响。
- 删除成功后刷新实例列表和管理员跨实例 Key 总览，并清除浏览器内仅本次显示的对应完整访问 Key。
- 为管理员删除接口增加同源与管理员权限保护，并在实例列表响应中提供本地渠道记录数量供确认界面展示。

### Testing

- `npm test`：通过；共 18 项测试，覆盖本地渠道记录计数、实例事务删除、访客 Session 失效、其他实例保留、匿名和访客拒绝删除、管理员删除成功及重复删除返回 404。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功，实例编辑弹窗、删除确认界面和 `DELETE /api/admin/instances/[instanceId]` 完成编译。
- 编辑器诊断：已检查本轮相关组件、样式、数据层、接口和测试，未发现诊断错误。
- 自动化测试只使用内存或临时 SQLite；未访问真实 New API，也未创建、修改或删除真实渠道。

### Notes

- `components/admin-dashboard.js`：拆分新增和编辑表单状态，增加编辑弹窗、删除确认弹窗、删除反馈与列表刷新。
- `components/admin-records-overview.js`：支持删除实例后重置筛选并重新读取跨实例记录。
- `app/globals.css`：增加危险操作按钮、弹窗遮罩、弹窗布局和移动端可用的滚动约束。
- `lib/application-store.js`：实例列表增加本地渠道记录计数，并增加事务化本地实例删除。
- `app/api/admin/instances/[instanceId]/route.js`：增加管理员专用 DELETE Route Handler；该接口不创建 New API 客户端，也不发起上游请求。
- `test/application-store.test.js`、`test/authorization.test.js`：增加数据清理、Session 撤销和删除授权回归覆盖。
- `docs/nextjs-usage.md`：说明弹窗编辑、本地删除范围、上游渠道安全边界和备份要求。
- 回滚方式：移除实例 DELETE Route Handler、数据层删除方法、列表记录计数、管理端删除按钮与弹窗及对应测试；数据结构未变化，不需要执行 SQLite schema 回滚。已经删除的本地数据无法通过代码回滚恢复，只能使用操作前备份恢复。

## 2026-07-11 - Task: 移除管理端重复成功提示

### What was done

- 移除管理端操作成功后显示在页面内容区的绿色提示，创建、编辑、删除、连接测试和访问 Key 操作统一只使用右上角轻提示反馈。
- 保留页面内错误信息，操作失败时仍可持续查看具体原因和请求信息。
- 清理不再使用的成功消息状态及赋值逻辑。

### Testing

- `npm run build`：通过；Next.js 生产构建成功。
- 编辑器诊断：已检查 `components/admin-dashboard.js`，未发现诊断错误。
- 本轮仅调整管理端反馈展示，未访问 New API，也未修改 SQLite 数据。

### Notes

- `components/admin-dashboard.js`：删除重复的页面内成功提示和对应状态，保留轻提示及页面内错误反馈。
- `progress.md`：追加本轮界面精简和验证记录。
- 回滚方式：恢复 `message` 状态、各成功操作的 `setMessage` 调用以及页面中的 `notice-message` 渲染。

## 2026-07-11 - Task: 移除管理端顶部标题栏

### What was done

- 移除管理页顶部的“系统管理”标题和手动刷新按钮，页面直接从跨实例 Key 记录总览开始展示。
- 保留页面首次进入时自动加载，以及创建、编辑、删除和访问 Key 操作后的自动刷新，不影响数据更新。
- 清理标题栏对应的专用样式，并保持管理页顶部间距紧凑。

### Testing

- `npm run build`：通过；Next.js 生产构建成功。
- 编辑器诊断：已检查管理端组件和全局样式，未发现诊断错误。
- 残留引用检查：未发现管理端标题栏、刷新按钮或对应专用样式引用。
- 本轮仅调整界面结构，未访问 New API，也未修改 SQLite 数据。

### Notes

- `components/admin-dashboard.js`：删除管理页标题和手动刷新栏。
- `app/globals.css`：删除不再使用的管理页标题栏样式，保留紧凑页面顶部间距。
- `progress.md`：追加本轮界面精简和验证记录。
- 回滚方式：在管理页顶部恢复标题栏和调用 `loadManagementData` 的刷新按钮，并恢复 `admin-title-row` 样式。

## 2026-07-12 - Task: 增加项目 README

### What was done

- 在仓库根目录增加项目 README，集中说明多实例管理、访问 Key、渠道导入和 SQLite 数据存储。
- 增加 Docker Compose 启动、健康检查、日志、数据卷保护和同宿主机 New API 连接说明。
- README 保持为通用项目说明，不包含个人域名、反向代理、证书申请或特定服务器部署信息。

### Testing

- `npm test`：通过；共 18 项测试。
- `npm run build`：通过；Next.js 16.2.10 生产构建成功。
- `docker compose config --quiet`：通过；README 中的默认监听端口与当前 Compose 配置一致。
- `git diff --check`：通过，未发现空白错误。
- 本轮只增加文档和进度记录，未访问 New API，也未修改 SQLite 数据。

### Notes

- `README.md`：新增项目介绍、环境配置和 Docker Compose 使用说明。
- `progress.md`：追加本轮文档交付和验证记录。
- 回滚方式：删除根目录 `README.md`，并删除本轮 `progress.md` 追加内容；该回滚不影响应用代码、Docker 数据卷或 SQLite 数据。

## 2026-07-11 - Task: 支持管理员查看和复制导入 Key

### What was done

- 为本地渠道记录增加可迁移的 `encrypted_key` 字段，新导入的 Anthropic Key 使用现有 `CREDENTIAL_ENCRYPTION_KEY` 以 AES-256-GCM 加密保存。
- 增加管理员专用 Key 读取接口；列表和访客接口仍只返回掩码，历史未保存密文的记录明确标记为不可恢复。
- 在跨实例 Key 总览中增加按需显示、复制和隐藏操作，并补充匿名、访客、管理员、缺失记录和历史记录场景的回归覆盖。

### Testing

- `npm test`：通过；共 19 项测试，覆盖 schema 迁移、密文存储、管理员解密读取、匿名和访客拒绝访问、历史记录返回 409 以及列表脱敏。
- `npm run build`：通过；Next.js 生产构建成功，管理员 Key 读取 Route Handler 完成编译。
- 编辑器诊断：已检查本轮数据层、接口、管理端组件、样式和测试，未发现诊断错误。
- 未访问真实 New API，也未在日志中记录完整 Anthropic Key。

### Notes

- `lib/application-store.js`：将 schema 版本升级到 4，迁移并保存加密 Key，增加管理员专用解密查询和列表可用性标记。
- `app/api/admin/records/[recordId]/key/route.js`：增加仅管理员可调用的完整 Key 读取接口，不记录明文并返回 `no-store` 响应。
- `components/admin-records-overview.js`：增加紧凑的显示、复制和隐藏操作，历史不可恢复记录不提供复制操作。
- `app/globals.css`：增加 Key 操作区和紧凑按钮样式。
- `test/application-store.test.js`、`test/authorization.test.js`：增加迁移、密文、解密读取和授权回归覆盖。
- `docs/nextjs-usage.md`：说明完整 Key 的加密保存、管理员按需读取、历史记录限制和加密密钥不可更换要求。
- `progress.md`：追加本轮实现与验证记录。
- 回滚方式：恢复 schema 版本 3、移除 `encrypted_key` 写入和管理员读取接口及前端操作；已有 schema 4 数据需要从变更前 SQLite 备份恢复，不能通过降级代码安全还原。

## 2026-07-13 - Task: 支持调整渠道记录每页数量

### What was done

- 管理端“全部 Key 记录”和实例内“已导入渠道”统一默认每页显示 10 条。
- 两处分页区域均增加每页数量选择，支持 10、20、50 和 100 条；切换后自动回到第 1 页并保留当前筛选条件。
- 查询、清除、导入后刷新和用量同步继续沿用当前选择的每页数量。

### Testing

- `npm test`：通过；共 19 项测试，现有分页、查询、授权和导入回归均通过。
- `npm run build`：通过；Next.js 生产构建成功，两处分页选择控件完成编译。
- 编辑器诊断：已检查两个记录列表组件和全局样式，未发现诊断错误。
- 本轮仅调整本地列表分页交互，未访问真实 New API，也未修改 SQLite 数据结构或数据。

### Notes

- `components/admin-records-overview.js`：管理端列表增加每页数量选项，并在查询和清除筛选时保留当前数量。
- `components/instance-workspace.js`：实例内列表增加每页数量选项，并在查询、清除和刷新时保留当前数量。
- `app/globals.css`：增加分页数量选择控件的紧凑布局样式。
- `docs/nextjs-usage.md`：说明两个列表的默认每页数量和可选范围。
- `progress.md`：追加本轮实现与验证记录。
- 回滚方式：移除两个组件中的每页数量选项和切换处理，恢复所有查询固定使用 `pageSize: 10`，并删除对应样式与文档说明；无需回滚数据库。

## 2026-07-13 - Task: 支持管理员单条和批量删除 Key 记录

### What was done

- 管理端 Key 记录表增加单条删除、当前页勾选、全选当前页和批量删除操作。
- 删除前显示二次确认和待删除数量；删除成功后清理对应的已解密页面状态并按当前筛选、页码和每页数量刷新列表。
- 新增管理员专用本地记录删除接口，每次最多删除 100 条；只删除 SQLite 记录，不连接 New API，也不删除上游真实渠道。

### Testing

- `npm test`：通过；共 20 项测试，覆盖匿名和访客拒绝删除、空选择校验、管理员批量删除、未选记录保留、实例配置保留及重复删除返回 404。
- `npm run build`：通过；Next.js 生产构建成功，`DELETE /api/admin/records` 和管理端删除界面完成编译。
- 编辑器诊断：已检查数据层、删除接口、管理端组件、样式和授权测试，未发现诊断错误。
- 自动化测试只使用内存 SQLite；未访问真实 New API，也未创建、修改或删除上游渠道。

### Notes

- `lib/application-store.js`：增加按记录 ID 批量删除本地渠道记录的方法。
- `app/api/admin/records/route.js`：增加管理员专用批量删除接口，限制数量并记录非敏感删除统计。
- `components/admin-records-overview.js`：增加当前页选择、单条删除、批量删除、二次确认和删除后刷新。
- `app/globals.css`：增加选择列、批量操作栏、行操作和移动端布局样式。
- `test/authorization.test.js`：增加本地记录删除授权、输入校验和数据范围回归测试。
- `docs/nextjs-usage.md`：说明记录删除范围、当前页批量选择和上游渠道保留边界。
- `progress.md`：追加本轮实现与验证记录。
- 回滚方式：移除管理员记录删除 Route Handler、数据层删除方法、表格选择和删除界面及对应测试与文档。本轮未修改数据库结构；已删除的本地记录只能从操作前 SQLite 备份恢复。

## 2026-07-13 - Task: 优化日志为中文业务单行格式

### What was done

- 将默认日志从单行 JSON 改为“时间、级别、中文事件、`key=value` 字段”的单行格式，便于直接使用 `docker compose logs` 查看。
- 保留日志级别过滤、请求 ID 关联和敏感信息脱敏；耗时自动显示为毫秒或秒，错误消息不再输出完整 Error 对象结构。
- 登录、导入、同步、限流和渠道创建失败事件使用更直观的中文标签；成功的 New API 底层请求降为 `debug`，减少默认 `info` 日志噪声。

### Testing

- `npm test`：通过；共 22 项测试，覆盖业务日志格式、耗时格式化、登录/限流/渠道失败日志示例和敏感信息脱敏。
- `node --test test/logger.test.js`：通过；3 项日志专项测试全部通过。
- 编辑器诊断：已检查日志模块、New API 客户端、登录和实例服务、测试及文档，未发现诊断错误。
- 未访问真实 New API，也未修改 SQLite 数据结构或数据。

### Notes

- `lib/logger.js`：增加中文事件标签、字段别名、时间格式、耗时格式和单行可读日志输出。
- `lib/new-api-client.js`：将成功请求降为 debug，并在限流日志中显示重试等待时间。
- `app/api/auth/login/route.js`：记录登录用户名和耗时，不记录密码。
- `lib/instance-service.js`：记录单个渠道创建失败，并精简导入和同步汇总字段。
- `.env.example`、`README.md`、`docs/nextjs-usage.md`：更新日志配置和输出示例说明。
- `test/logger.test.js`：改为验证中文单行日志、字段别名、耗时和脱敏行为。
- `progress.md`：追加本轮实现与验证记录。
- 回滚方式：恢复 `lib/logger.js` 的 JSON 序列化输出、还原底层请求日志级别和实例服务日志字段，并恢复相关文档及日志测试；本轮未修改数据库结构。

## 2026-07-13 - Task: 同时显示渠道余额与累计用量

### What was done

- 为本地渠道记录增加余额字段，导入和同步时保存 New API 返回的 `balance`，并通过现有查询接口返回余额及累计用量汇总。
- 实例工作区和管理端记录总览分别显示渠道余额与累计用量，避免将余额误认为累计消耗。
- 将 SQLite schema 升级到版本 5；既有记录的余额默认从 `$0.00` 开始，下一次同步后更新。

### Testing

- `npm test`：通过；22 项测试全部通过，覆盖 schema 迁移、授权、导入、记录查询和删除回归。
- `npm run build`：通过；Next.js 生产构建成功，两个记录列表和全部 Route Handler 完成编译。
- 定向内存 SQLite 验证：导入余额 `$12.50` 后同步为 `$10.25`，累计用量同步为 `$1.50`，单条记录和汇总结果一致。
- `ReadLints`：已检查应用存储、两个记录列表组件和应用存储测试，未发现诊断错误。
- 未访问真实 New API；本轮只修改本地数据库结构、同步存储和展示逻辑。

### Notes

- `lib/application-store.js`：新增 `balance_usd` 字段、schema 5 迁移、余额读写和余额汇总。
- `components/instance-workspace.js`：实例记录列表和摘要同时显示余额与累计用量。
- `components/admin-records-overview.js`：管理员记录列表和摘要同时显示余额与累计用量。
- `test/application-store.test.js`：更新 schema 迁移版本断言。
- `docs/nextjs-usage.md`：说明余额与累计用量的来源、含义和旧记录升级行为。
- 回滚方式：先停止服务并备份 SQLite，再恢复上述代码和文档；数据库如需回到 schema 4，应从本轮变更前的 SQLite 备份恢复，不能直接删除 `balance_usd` 列。

## 2026-07-13 - Task: 修复 New API 累计用量换算为零

### What was done

- 兼容 `/api/status` 将 `quota_per_unit` 放在响应顶层或 `data` 内的两种返回结构，确保 `used_quota` 能按正确单位换算。
- 当上游累计配额非零但换算单位无效时改为明确报错，不再静默保存为 `$0.00`。

### Testing

- `npm test`：通过；22 项测试全部通过。
- `npm run build`：通过；Next.js 生产构建成功。
- `ReadLints`：检查 New API 客户端和应用存储，无诊断错误。

### Notes

- `lib/new-api-client.js`：合并 New API 状态响应顶层与 `data` 字段。
- `lib/application-store.js`：阻止非零 `used_quota` 在无效换算单位下被静默归零。
- `progress.md`：记录本轮修复和验证结果。
- 回滚方式：恢复上述两个代码文件到提交 `97d3d51` 对应版本；本轮未修改数据库结构。

## 2026-07-13 - Task: 兼容状态接口缺少配额换算单位

### What was done

- New API 状态接口返回有效 `quota_per_unit` 时继续使用上游值；字段缺失或无效时，按 New API 标准单位 `500000 quota = 1 USD` 换算。
- 导入和用量同步统一使用同一换算单位解析逻辑，恢复生产环境非零 `used_quota` 的美元显示。

### Testing

- `npm test`：通过；22 项测试全部通过。
- `npm run build`：通过；Next.js 生产构建成功。
- 缺失字段回归：模拟 `/api/status` 不返回 `quota_per_unit`，渠道 `used_quota=250000`，本地记录正确保存 `usedUsd=0.5`。
- `ReadLints`：检查服务层、客户端、存储层和路由测试，无诊断错误。

### Notes

- `lib/instance-service.js`：统一解析换算单位并增加 New API 标准值 fallback。
- `test/instance-route.test.js`：覆盖状态接口缺少换算单位时的导入用量换算。
- `docs/nextjs-usage.md`：说明换算单位缺失时的处理规则。
- `progress.md`：记录本轮修复和验证结果。
- 回滚方式：恢复上述代码、测试和文档到提交 `d3220ec` 对应版本；本轮未修改数据库结构。

## 2026-07-11 - Task: 管理端和使用端增加手动及自动同步

### What was done

- 在管理端增加“同步全部实例”按钮，并只处理已启用且存在本地渠道记录的实例；单个实例失败不会阻断其他实例的同步汇总。
- 在管理端和实例工作区增加默认关闭的 30 秒自动同步开关，仅在浏览器标签页可见时运行，并避免同一实例出现重叠同步。
- 将单实例渠道查询改为最多 5 个请求并发，管理端跨实例同步保持顺序执行；自动同步保留当前筛选、分页和选择状态，后台运行不重复弹出成功提示。
- 增加管理端同步路由授权回归测试和单实例同步并发上限、重复请求合并测试。

### Testing

- `npm test`：通过；24 项测试全部通过。
- `npm run build`：通过；Next.js 生产构建成功，管理端同步路由和两个记录页面完成编译。
- 定向同步验证：确认单实例最多 5 个渠道搜索同时执行，重叠同步请求共享一次实际同步；管理端路由对匿名和访客分别返回 `401`、`403`，并跳过停用实例及无本地记录实例。
- `ReadLints`：检查本轮修改的组件、服务、路由、样式、测试和文档，未发现新增诊断错误。
- 未访问真实 New API，也未修改 SQLite 数据结构或正式数据库数据。

### Notes

- `lib/instance-service.js`：增加单实例同步的五路并发和重叠请求合并。
- `app/api/admin/records/route.js`：增加管理员同步全部实例的 POST 接口。
- `components/instance-workspace.js`：增加手动同步、30 秒可见页自动同步和后台静默反馈。
- `components/admin-records-overview.js`：增加管理员同步全部实例、自动同步和筛选选择状态保留。
- `app/globals.css`：增加同步控件及移动端布局样式。
- `test/admin-sync-route.test.js`：验证管理员同步路由的授权和实例筛选行为。
- `test/synchronization.test.js`：验证五路并发上限和重叠同步请求合并。
- `docs/nextjs-usage.md`：补充手动同步、自动同步、可见页限制和并发策略。
- `progress.md`：追加本轮实现、验证证据和回滚点。
- 回滚方式：从本轮开始前的工作区备份恢复上述文件；本轮未修改 SQLite schema 或正式数据，若无文件备份则按 Notes 文件清单逐项撤销本轮新增接口、组件控件、并发逻辑、测试和文档内容。
