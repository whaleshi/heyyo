# Heyyo 前端验收 — 2026-09-16

本次变更：统一 pnpm，使用 Reown AppKit + Ethers v6 替换模拟钱包连接。以下为本次实际检查结果，替代旧版详情和买卖页面的验收记录。

## 自动检查

- `pnpm install --frozen-lockfile`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：14 项通过（10 项原模型测试，4 项钱包会话回归测试）。
- `pnpm build`：通过。钱包 SDK 独立分包；依赖中存在大于 500 kB 的分包，构建输出体积提示和上游 PURE 注解提示。

钱包回归测试通过注入模拟会话验证业务状态层：

- 浏览器旧连接标记不能使钱包变为已连接。
- A/B 钱包切换、断开、重连和刷新不会串用本地代币和领取记录。
- 同一钱包不同大小写使用同一存储键。
- 取消/失败的连接与断开请求不伪造成功状态。
- 未配置 Project ID 时连接不可用，不改变账户状态。
- 非目标网络阻止创建和领取。
- 连续领取只结算一次，且不影响其他账户。
- 存储写入失败时保留本次会话内的数据。

## 浏览器冒烟检查

在未配置 Reown Project ID 的开发环境验证：

- 首页正常加载，显示连接钱包入口。
- 点击连接显示“Wallet connection is not available yet.”，保持未连接。
- 切换中文后页面标题和钱包入口同步更新。
- 我的收益页显示未连接状态，连接按钮显示“钱包连接暂未开放。”。

## 待真实配置验证

用户选择先完成代码接入，尚未提供 Reown Project ID。因此尚未完成真实浏览器钱包、WalletConnect 扫码、真实账户切换/恢复会话和钱包网络切换的端到端验证。配置步骤见 README。

钱包默认 Arc Testnet（5042002）。发币、行情、收益领取仍是本地原型，未接业务合约或后端。本次没有发送链上交易。

## 独立索引服务与首页接入（后续变更）

用户确认独立索引器、独立数据库，仅展示通过 Heyyo 创建的代币；实际合约后续提供。

- `pnpm install --frozen-lockfile`：通过，前端与 `@heyyo/indexer` 为 pnpm workspace。
- `pnpm typecheck`、`pnpm indexer:typecheck`：通过。
- `pnpm test`：25 项全部通过；新增 7 项索引/SQL/API 测试和 4 项异步客户端测试。
- 临时 PGlite PostgreSQL 引擎验证建表、来源校验、事务回滚、日志去重、6 位 USDC 换算、服务端阶段/搜索/排序/分页和毕业条件；未连接任何真实数据库。
- 扫描测试验证确认区块范围、游标原子提交以及重组检测；实际合约适配层仍保持禁用。
- 前端测试验证旧搜索请求取消、乱序响应抑制、失败重试、刷新失败保留已获取数据、响应协议校验。
- `pnpm build`：通过，保留此前钱包 SDK 体积提示。
- 浏览器访问 `http://localhost:5174/`，通过 Vite 代理请求独立 `127.0.0.1:8787` API；API 返回 HTTP 503 / CONTRACT_NOT_CONFIGURED，首页展示“Heyyo 代币列表即将开放”。未显示示例币；顶部缺少真实数据的统计显示 `—`。
- `pnpm indexer:once` 在合约未配置时按设计拒绝运行，不进行链上扫描或数据库写入。

本次交付的是可验证的独立索引基础框架、数据库结构、只读列表 API 和首页接入；尚未启用真实链上索引，也未部署实际 PostgreSQL。真实 ABI、来源识别、metadata 获取重试及迁移后池事件适配须在收到合约后完成，见 `indexer/README.md`。

## Reown Project ID 配置验证

用户已提供 Project ID，已写入项目 `.env.local` 的 `VITE_REOWN_PROJECT_ID`，保留在本地忽略文件中。

- 本地页面成功初始化 AppKit，点击“连接钱包”可打开 Reown `Connect Wallet` 弹窗，显示 WalletConnect、Coinbase 和钱包搜索入口。
- Escape 可关闭弹窗。
- 带本地 Project ID 的生产构建通过。
- 本次只验证初始化和钱包选择弹窗，没有连接实际账户、签名或发送交易；真实会话及网络切换仍待钱包实测。

## 2026-09-17 — frontend 42 合约接入（当前状态）

此前“本地原型/ABI 待提供”的记录为历史状态。本次在 Heyyo 项目集成 frontend 42；没有修改 Ayoo 项目。

- 校验用户提供的 RPC：chainId 31337，Proxy 0xfeDDCFCf739c3899C1DEbC5aD44E45de809A847c，Factory 绑定正确。
- 查到 Proxy 成功部署回执，实际区块为 21186584；采用该区块而非导出包另一条目的 21186583。
- 公开读取校验模板 2、DEX 1、支付配置 1 均可用；支付币 USDC decimals=6，模板 quoteDecimals=6。
- 对六参数 createCurveLaunch 做 `eth_call` 只读模拟成功，没有广播交易，返回地址仅为模拟结果，不作为已创建代币显示。
- 独立本地 PostgreSQL 16 已创建并运行于 127.0.0.1:5433，heyyo_indexer 数据保存在被忽略的 .data/postgres。
- 独立扫描器成功处理部署块；GET /api/tokens 返回 HTTP 200、items=[]、indexedBlock=21186584，/api/health 正常。
- 30 项自动测试通过：包括绑定校验、未登记记录、支付精度、错误来源事件、回执失败/取消、未知行情 null、协议日志去重及原有索引事务/重组测试。
- 前端与索引器 TypeScript 检查通过，生产构建通过（钱包 SDK 仍有分包体积提示）。
- 浏览器验证默认英文、首页真实空列表、创建页读取 USDC 配置，以及确认页显示首买金额与最低输出。

未连接真实钱包或执行发币、首买、领取交易。当前 RPC 尚无 Agent source token、targetConfigured=false，因此个人收益和非空索引列表无法在该链验证。行情/毕业状态需要完整 Curve/Pool 包；metadata 上传服务未配置，创建使用已发布的 JSON URI，图片仅预览。详见 README。

## 2026-09-17 — 创建上传与零值占位

参考 Ayoo 的选图即上传、创建时 pin metadata 流程，在 Heyyo 独立 API 增加 Pinata 上传。用户明确选择独立配置，未读取或复制 Ayoo PINATA_JWT。

- 移除手填 metadata URL；图片上传完成后才允许进入确认。选择/删除图片会取消旧上传，旧响应不能覆盖新 CID；失败可重试。
- metadata 根据最新表单生成，上传失败不调用创建合约；同一份 metadata 在交易重试时复用 CID。
- 服务端校验图片签名/类型/2 MB 大小，metadata 字段及链接、同源请求、请求体大小和限流。上游错误不暴露凭据。
- 33 项测试通过；前端和索引器类型检查、生产构建通过。
- 通过 Vite 代理验证 POST 上传接口返回 503 / Upload service is not configured，说明路由与 Origin 转发正常。真实 Pinata 上传待用户在 indexer/.env.local 填入独立 PINATA_JWT 后验证。
- 无数据的市值、涨幅、成交量、进度、收益和数量占位改为 0；API 中未知行情仍保留 null，不篡改索引数据。

## 2026-09-17 — 代币图标补全

索引器新增受限 IPFS metadata 读取与失败重试，已补全太阳（SUN）的图片和简介。浏览器实际图片加载成功，naturalWidth=225。索引器类型检查及 35 项测试通过，已重启工作进程。

## 2026-09-17 — 收益页改用独立索引 API

我的代币、领取记录和顶部汇总均从 Heyyo 钱包 API 读取；浏览器列表读取不再调用 sourceLaunchIds、逐币 readSource 或 eth_getLogs。索引器在游标区块保存 raw 收益快照，快照与游标一致后才对 API 发布，接口按部署和创作者地址查询。图片沿用 metadata 入库结果。领取交易前的链上校验及钱包签名保留。

- 38 项测试通过，前端/索引器类型检查及生产构建通过。
- /api/wallets/:address/rewards 实测 HTTP 200，indexedBlock=21186585，当前钱包 1 个代币且带图片。
- /api/wallets/:address/claims 实测 HTTP 200，当前钱包无领取记录。
- API 与扫描器已重启。未发送领取或其他链上交易。

## 2026-09-17 — 首页行情及加载稳定性

- 补齐独立曲线交易/毕业/V3 Swap 索引与逐币历史回补，保留登记和收益游标。来源、池子资产、日志去重、区块哈希和失败回滚均校验。
- 42 项测试通过；新增覆盖创建同块首买、买卖量、阶段切换、毕业前后独立交易、迁移开盘价/Swap、市值、两种 token 顺序的精度、错误池和重组拒绝、返回列表缓存。前后端类型检查及生产构建通过。
- 真实 API 返回 SUN 市值 2500、涨跌 0、成交量 0、进度 0；对应曲线起始价为 0.0000025 USDC，行情游标已追至 21186587。未广播交易。
- 重启独立 API 和索引器，数据库迁移成功。浏览器确认图片和 $2.5K 市值；刷新后 1 张卡片、0 个骨架，首页主容器动画 none；经过后台轮询列表 Y 坐标始终 536。
- 首页移除占位 Updating 行，用 5 分钟有效的同查询缓存维持返回/刷新时内容，随即后台校验；真实新查询首次仍展示骨架，不借用其他搜索结果。
- 平台顶部回购/奖励汇总不在本次代币行情范围内，仍待单独接入。

## 2026-09-17 — frontend 43 ABI / v1.1.0

- Verified configured RPC chainId 5042, proxy version 1.1.0, Factory binding and successful deployment receipt at 21208472. New source registry is empty at deployment block.
- Updated current ABI, deployment, wallet network and script configuration; indexed BuybackExecuted and the revised CreatorFeeDistributed signature. Added pendingBuyback to reward snapshots/API/display, without affecting claim eligibility.
- User requested old data removal: deleted old chain 31337 deployment tokens, events, market/reward snapshots and cursors. No Ayoo database was touched.
- Guide section 1.1 has a stale v1.0.0 snapshot warning; runtime version and supplied deployment JSON both verify v1.1.0. See contract provenance.
