# Heyyo 首页索引接入调研

日期：2026-09-16。参考本机 `/Users/shijy/Desktop/work/ayoo/` 的实际代码；本次没有修改 Ayoo、读取数据库凭据、运行迁移或启动索引进程。

## 已确认的数据链路

Ayoo 的 `indexer/src/run.ts` 读取链上事件，`processor.ts` 写入 PostgreSQL；Next.js 的 `app/api/launches/[chainId]/route.ts` 读取索引库，前端通过 `lib/api.ts` 请求列表。

- Factory `LaunchCreated` → `ayoo_tokens`：链、部署、Factory、代币与 Launch 地址、创建者、模式、模板、支付币配置、创建区块时间和 metadata。
- 曲线买卖及迁移 → `ayoo_launch_snapshots`：储备、已售数量、价格、毕业状态和池地址。
- 规范化买卖 → `ayoo_trades`：成交额与成交记录。索引器消除同一笔 Launch 交易的伴随 Pool Swap，不应再把事件表成交额叠加进来。
- `indexer_cursor` 按 `(chain_id, deployment_id)` 保存进度，检查点、确认数、RPC 重试和 advisory lock 保护扫描。IPFS metadata 独立重试，不阻塞主游标。

## 与当前 Heyyo 的差异

当前 Heyyo 首页读取 `state.tokens`，包含示例数据和钱包本地创建记录。正式首页应读取索引 API；本地创建记录不能当作已经上链的公共列表项。

Ayoo `/arc` 对应 Arc 主网 5042，而 Heyyo 钱包当前默认测试网 5042002。确定部署网络后必须同时对齐钱包、索引范围、合约配置与 Ayoo 详情链接。

Arc 曲线支付币为 ERC-20 USDC，地址 `0x3600000000000000000000000000000000000000`，精度 6。钱包原生 USDC 的 18 位精度不能用于曲线储备。当前 Arc 主网前端配置目标为 8,000 USDC；应优先使用对应 deployment/template 的参数，不跨部署套用常量。

价格转换还需注意：索引器整数 `marginal_price` 在低单价下可能损失精度；Ayoo 通过模板曲线供应量、quote reserve 和 token sold 重新计算边际价格。毕业后优先读取外部池价格。未知价格应为空值，不能伪装成零或示例行情。

## 部署方案（已确认）

用户已确认：Heyyo 独立运行索引器和数据库，首页仅展示通过 Heyyo 创建的代币，真实合约后续提供。已在当前项目新增独立 `indexer/`，不连接 Ayoo 数据库，也不使用 Ayoo 公共列表作为数据源。合约适配器在验证 ABI 和来源识别前保持禁用。

首页 API 建议提供每列独立分页、服务端搜索和最新/市值/24h 交易量排序，以及索引更新时间。阶段筛选与排序应在分页之前完成，不能只在当前页做本地筛选。未毕业但储备已达目标不应直接视作已完成迁移。

现有 Ayoo 列表 API 支持 `mode/category/paymentTokenConfigId/query/page/limit`，默认 category=new，limit 上限 50。其 category 语义与 Heyyo 三列并不完全相同；目前也没有列表的 `volume24hRaw`，该字段仅在详情接口使用。Heyyo 的列表 API 需要补齐成交量聚合和匹配三列的筛选规则。

页面接入时应补充首次加载、真实空数据、失败重试、后台刷新失败提示、搜索防抖、取消过期请求和分页。API 失败时不得退回示例数据。

## 必须确定的来源条件

`LaunchCreated` 与当前索引表没有专门的 Heyyo 来源字段。现有字段只有 Factory/部署、创建者、模板、代币地址与 metadata 等，不能仅凭用户从哪个网页发起交易判断来源。

- 如果展示所有 Ayoo Arc Bonding Curve 代币，可按链、mode=1 和支付币筛选。
- 如果只展示 Heyyo 代币，需要确认专用 Factory/入口合约/可核验的创建或分润事件。共用 Factory 时，单独按 Factory 无法区分来源。
- 用户可自行填写的 metadata 标记不能作为分润资格或真实平台归属的唯一凭证。

部署方式已确定；来源规则等待实际合约。期间不将任意 Ayoo 代币自动归入 Heyyo，也不运行未经验证的链上扫描。

## 当前联调限制

公开接口 `https://ayoo.club/api/launches/5042?mode=1&category=new&limit=1&page=1` 返回 HTTP 403、`REGION_RESTRICTED`。没有尝试绕过该限制。本次结论依据本地源代码，未验证线上返回的有效列表数据。
