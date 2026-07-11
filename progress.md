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
