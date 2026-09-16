# Heyyo.club

React 18 + TypeScript + Vite，使用 pnpm、RainbowKit、Wagmi 和 Ethers v6。页面每次加载默认英文，可在当前会话切换中文。

## 当前合约接入

使用 `contracts/heyyo/deployment.json` 与 `abis/`，原始资料来自用户提供的 `frontend 43`，完整说明保存在 `contracts/heyyo/FRONTEND_INTEGRATION.md`。

- 网络：31337，RPC 地址配置在被忽略的 `.env.local` 和 `indexer/.env.local`。
- Agent Proxy：`0xfeDDCFCf739c3899C1DEbC5aD44E45de809A847c`。
- Factory：`0xED31e7ec603651803784196003903aCa05550552`。
- Proxy 部署回执已核验，起始区块 21186584。
- 当前 RPC 已验证可用的创建配置：模板 2（Curve）、DEX 1、支付配置 1（ERC20 USDC，6 位精度）。写入前再次校验配置和钱包账户/链。
- `FactoryConfig.abi.json` 仅包含 Ayoo 项目 `contracts/ayoo/abis/v2/LaunchFactory.abi.json` 中的公开配置读取方法，已对当前 RPC 验证。原始 frontend 43 ABI 原样保留；没有补入 Agent 管理或结算写方法。

创建页通过 Agent 创建，支持可选的原子首笔买入。ERC20 先授权 Agent 所需数量，创建与首买使用同一笔交易；根据 Proxy 的 `TokenCreated` 和 `InitialBuyExecuted` 回执验证结果，不使用本地记录作为成功依据。首买需要填写正数最低收到数量（raw units）。确认页展示支付金额及最低输出；失败不自动重试。

创建流程参考 Ayoo：选择图片后立即上传 IPFS，上传完成才可预览确认；失败可重试，更换或删除图片会取消旧请求。提交创建时自动把名称、符号、描述、图片 IPFS URI 和社交链接生成 JSON 上传，再将 metadata URI 传入 Agent。无需手动填写 URL。

上传 API 由 Heyyo 独立服务提供：`POST /api/ipfs/pin-file`、`POST /api/ipfs/pin-json`。请在 `indexer/.env.local` 填写 **Heyyo 自己的 `PINATA_JWT`** 并重启 `pnpm indexer:api`；不会读取 Ayoo 凭据。密钥仅在服务端。未配置时返回 503，前端阻止继续创建。图片限制 PNG/JPG/WebP、2 MB，服务端校验文件签名、请求大小、metadata 字段并限流。

收益页、顶部统计、我的代币和领取记录均读取 Heyyo 独立 API。索引器在已提交的区块读取并保存 pending、claimable、claimed 快照，接口从数据库按钱包地址筛选，图片/简介复用已索引 metadata。领取历史查询已入库的 CreatorFeeClaimed 事件（最新 50 条）。金额经 API 以 raw 字符串返回，前端用 bigint 和实际精度展示。浏览器不再为列表或记录遍历合约与日志；只有创建配置校验、领取交易前校验及钱包签名仍访问链。

`GET /api/wallets/:address/rewards` 和 `GET /api/wallets/:address/claims` 均返回 indexedBlock、updatedAt 和 items。快照区块与索引游标不一致或发生重组时返回未就绪，不把不完整数据当作零余额。前端后台刷新期间保留已展示的数据，失败时提示并禁用领取。

## 本地运行

需要 Node.js 22.6+、pnpm 10、PostgreSQL 16。不要覆盖已有 `.env.local`。

```sh
pnpm install --frozen-lockfile
# 首次使用才从 .env.example 和 indexer/.env.example 建立本地配置
pnpm indexer:migrate
pnpm indexer:start
# 新终端
pnpm indexer:api
# 新终端
pnpm dev --host 127.0.0.1 --port 5174
```

打开 http://127.0.0.1:5174/。本工作区已建立独立 PostgreSQL 数据库 `heyyo_indexer`，仅监听 127.0.0.1:5433，数据在 `.data/postgres`。数据库凭据只保存在被忽略的配置文件中。

当前 31337 开发链使用 `INDEXER_CONFIRMATIONS=0`，因为它按交易出块；生产默认 6，不应照搬开发值。只读索引器已扫描部署块并返回真实空列表；没有向 RPC 发送交易或测试发币。

## 首页索引边界

首页只读取独立 Heyyo API，不访问 Ayoo 数据库。索引 Agent 的创建、首买、费用计提/领取/分配及目标配置事件；只有通过 Agent 登记并验证绑定关系的代币进入列表。事件去重、区块一致性检查、游标和数据库事务已接入。

曲线行情已接入 `TokensBought` / `TokensSold`，按事件储备和链上 `graduationParameters` 计算边际价格、市值、24h 涨跌、成交量和进度。`CurveGraduated` 标记毕业，`LiquidityMigrated` 绑定池子，之后跟踪 V3 `Swap`；同笔交易的 Agent 首买事件不重复计入成交量。行情独立游标从创建块自动回补，保留已有登记、metadata 和收益数据。USD 估值仅支持已核验的 USDC 支付地址，未知估值仍保留 null、界面显示 0。顶部平台回购/奖励汇总仍待接入。metadata 自动补全图片与简介，名称和符号以链上为准。

首页每 15 秒静默刷新，保留当前卡片。返回/刷新页面可复用 5 分钟内的同查询缓存并立即重新请求；搜索条件隔离、失败保留旧数据并提示。取消首页入场动画，后台加载文案不占布局空间。

31337 不生成指向 Arc 主网的代币详情链接。生产部署须提供 HTTPS RPC、同域 `/api` 反向代理及可公开读取的 metadata 服务/链接。

## 钱包与检查

Reown Project ID 使用 `VITE_REOWN_PROJECT_ID`；在 Reown Dashboard 配置应用来源 allowlist。所有 `VITE_` 变量都会进入前端，不能放私钥或助记词。

```sh
pnpm typecheck
pnpm indexer:typecheck
pnpm test
pnpm build
```

SDK 分包仍有体积提示。旧 model/store 的模拟数据仅作为遗留代码及测试夹具保留，创建页与收益页已不使用这些业务写入方法。

详见 [索引器说明](indexer/README.md)。

## JSON 创建与多钱包买入脚本

填写 `scripts/launch.local.json` 的代币信息、创建私钥、买入私钥及各自 USDC 金额。先执行 `pnpm launch:check` 检查，再运行 `pnpm launch:run`。创建确认后立即并发授权/买入，不额外等待区块，固定 minOut=1，不预估报价或 gas；只需普通 RPC，不保证同块。详见 [脚本说明](scripts/LAUNCH.md)。未发送真实交易。

钱包连接参考 Ayoo 的 RainbowKit 配置，沿用 `VITE_REOWN_PROJECT_ID` 作为 WalletConnect project ID。当前链为 31337；账户状态由 Wagmi 管理，Ethers 使用选中 connector 的 provider。
