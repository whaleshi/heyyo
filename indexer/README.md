# 独立 Heyyo 索引器

使用独立 PostgreSQL 数据库及 `heyyo_*` 表，不读写 Ayoo 数据库。合约适配器已经接入用户提供的 frontend 43 Agent Proxy。

## 启动与配置

参考 `.env.example`，把数据库连接与 RPC 写入被忽略的 `indexer/.env.local`。链 ID、Agent 地址、部署 ID、起始块默认取自 `contracts/heyyo/deployment.json`；不允许把适配器指向其他链或普通 Ayoo Factory。

```sh
pnpm indexer:migrate
pnpm indexer:once
pnpm indexer:start
pnpm indexer:api
```

本工作区的本地 PostgreSQL 在 `.data/postgres`，独立监听 127.0.0.1:5433，数据库为 `heyyo_indexer`。安装的 PostgreSQL 16 可用以下命令启停（在项目根目录执行）：

```sh
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$PWD/.data/postgres" -l "$PWD/.data/postgres.log" -o "-h 127.0.0.1 -p 5433 -k $PWD/.data/pgsocket" start
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$PWD/.data/postgres" stop
```

不要再次 initdb 覆盖已有数据。生产可使用现有 compose.yaml 建立独立实例。

## 已接入的数据

`TokenCreated` 从 Agent Proxy 获取，并在事件所在块读取 `sourceLaunches`、Factory record、Launch 的 Factory/creator/token/FeeVault/payment/id，以及 Token transferController 交叉校验。只将注册且一致的代币入库。

其他五类 Agent 事件以 `kind=protocol` 保留原始名称、raw 参数和日志身份：`InitialBuyExecuted`、`CreatorFeeAccrued`、`CreatorFeeClaimed`、`CreatorFeeDistributed`、`TargetLaunchConfigured`。每次目标配置事件均保存，不能当作一次性事件。首买不是完整 24h 成交量，费用事件也不是市场买卖数据。

`market.ts` 使用独立逐币 `market_block` / `market_block_hash`，从创建块分批回补曲线买卖，兼容首买事件早于 Agent TokenCreated。每个批次的行情、成交和游标原子提交。曲线参数取各 Launch 的 `graduationParameters`；使用 bigint 分数计算边际价格，PostgreSQL numeric 存储。成交量按曲线 gross quote / 池子 quote amount 汇总，不重复计入 Agent 首买或扩展路由事件。

`CurveGraduated` 标记毕业（不以储备阈值推断）；`LiquidityMigrated` 核对绑定池子和资产顺序，记录开盘价格；其后 V3 Swap 更新价格和买卖量。USDC 地址及 6 位精度必须匹配才提供美元估值。未毕业储备达到 65% 进入 soon，阶段筛选和排序先于分页。

metadata 通过固定 IPFS 网关读取，限制 64 KB 并禁止重定向，自动补全图片与简介。失败每分钟重试，不影响链上事件提交。

## 一致性

- Advisory lock 保证单部署单扫描者；默认批次 100、轮询 3 秒、确认数 6。
- 当前本地 31337 开发配置确认数为 0，供按交易出块的开发链使用；不是生产推荐值。
- 事件、代币、检查点和游标在同一事务提交，重复 chain/tx/log 不重复入账。
- 扫描前后验证区块哈希、父子关系；重组时停止并标记 halted。需核对和重建受影响数据，不自动忽略重组。
- 数据库失败、RPC 失败或来源校验失败均不推进游标；重试采用退避。

## API

`GET /api/tokens?stage=new&sort=recent&query=&page=1&pageSize=12`

支持 new/soon/graduated、recent/market/volume，搜索最长 64 字符，分页每页最多 50。过滤与排序均在分页前执行。行情缺失的代币排在已知数值后，使用创建顺序作为稳定次排序。

`GET /api/health` 返回 indexedBlock 和 updatedAt。成功空列表为 HTTP 200；缺少配置、未就绪、重组或数据库不可用会返回对应错误，不回退演示数据。

服务默认监听 127.0.0.1:8787。Vite 开发代理 `/api`；生产必须另外配置同域反向代理。

## 创建上传

`POST /api/ipfs/pin-file` 接收 file multipart，`POST /api/ipfs/pin-json` 接收代币 JSON，成功返回 `{cid}`。使用独立 `PINATA_JWT` 服务端变量；修改后重启 API。未配置返回 503，不会回退至 Ayoo 的服务或密钥。代理需保留 Host，使同源 Origin 检查正确；Vite 已配置。生产多实例需在反向代理增加共享限流，当前进程按连接 IP 每分钟最多 10 次上传。

## 钱包收益与领取记录

扫描器在提交链上事件后，通过同一游标区块读取并验证所有已登记代币的收益，原子写入 heyyo_reward_snapshots 与 heyyo_reward_state。新旧快照切换不会暴露部分钱包结果；读取失败会重试，游标与快照不一致时钱包 API 返回 503。即使没有新区块，也会补齐缺少的初始快照。

- GET /api/wallets/:address/rewards：当前部署下该创作者的代币、图片、简介、支付币精度与 raw 收益。
- GET /api/wallets/:address/claims：数据库中该创作者的最新 50 笔已索引领取事件，包含交易 hash、log index、区块、金额和支付币信息。

两个端点只查 PostgreSQL，不向 RPC 透传请求。金额使用十进制字符串，地址/部署过滤均参数化。

## v1.1.0 deployment

Current proxy: `0xe5FC1B60afb89a9136fe7A5c4eE5A03D33c8612b`, start block 21208472. The configured Anvil RPC reports chainId 31337. Zero confirmations remains a development setting. Old deployment index rows were deleted as requested. `BuybackExecuted` is indexed independently from the new `CreatorFeeDistributed`; reward snapshots expose `pendingBuyback` separately from pending allocation and creator claimable balances.
