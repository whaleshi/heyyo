# AYOO Proxy 协议前端集成文档 / AYOO Proxy Protocol Frontend Integration Guide

> 本文面向公开前端、钱包展示页和索引服务。AYOO Proxy 是一个连接 AYOO Launchpad 的 Curve creator-fee 结算组件；本文描述公开创建、收益领取、状态读取、事件索引、资产展示和地址校验。 / This guide is for public frontends, wallet views, and indexers. AYOO Proxy is a Curve creator-fee settlement component connected to AYOO Launchpad; this guide covers public creation, fee claims, state reads, event indexing, asset display, and address validation.

本包提供公开查询、Agent Proxy 创建和创建者收益领取流程所需的 ABI。结算和其他非公开写入流程不属于本前端包；前端不要根据源码 ABI 自行补回未导出的写方法。 / This package provides the ABIs required for public queries, Agent Proxy creation, and creator fee claims. Settlement and other non-public write flows are outside this frontend package; do not reconstruct omitted write methods from source ABIs.

## 1. 导出集成包 / Export the integration package

确认部署实现与待导出源码版本一致后，先编译合约，再按部署网络导出。脚本优先从当前 `artifacts/` 读取 ABI；本仓库使用 Foundry 构建时也会从 `out/` 读取，并从部署网络读取 chain ID、Proxy 状态和 source Launch 快照。 / Confirm that the deployed implementation matches the source version being exported, then build and export for that network. The script prefers current ABIs from `artifacts/`, also reads `out/` for Foundry builds, and reads the chain ID, Proxy state, and source Launch snapshot from the deployment network.

```bash
pnpm exec hardhat build
pnpm run frontend:export -- local

# Custom network or RPC override / 自定义网络或 RPC 覆盖
FRONTEND_RPC_URL=https://rpc.example pnpm run frontend:export -- arcMainnet
```

默认输出： / Default outputs:

| 文件 / File                                                  | 用途 / Purpose                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/frontend/abis/CurveCreatorAgent.abi.json`              | Proxy 公开读取、创建、领取和事件 ABI / Public read, creation, claim, and event ABI for the Proxy                        |
| `docs/frontend/abis/ICurveCreatorAgentFactory.abi.json`      | 外部 Factory 的公开记录和 DEX 配置读取 ABI / Public Launch record and DEX config reads for the external Factory         |
| `docs/frontend/abis/ICurveCreatorAgentLaunch.abi.json`       | Curve Launch 状态和池信息读取 ABI / Curve Launch state and pool reads                                                   |
| `docs/frontend/abis/ICurveCreatorAgentManagedToken.abi.json` | Managed Token 的 `transferController` 读取 ABI / `transferController` read for Managed Tokens                           |
| `docs/frontend/abis/ICurveCreatorAgentFeeVault.abi.json`     | FeeVault 余额和 WETH 地址读取 ABI / FeeVault balance and WETH address reads                                             |
| `docs/frontend/abis/ERC20.abi.json`、`WETH.abi.json`         | 余额、精度、元数据和用户授权读取/交互 ABI / Balance, decimals, metadata, and user-approval ABI                          |
| `docs/frontend/deployments/<network>.json`                   | Proxy 地址、Factory 地址、chain ID 与公开状态快照 / Proxy address, Factory address, chain ID, and public state snapshot |
| `docs/frontend.<network>.<YYYYMMDDHHmmss>.zip`               | 可交付给前端或索引服务的归档 / Distributable archive for frontend or indexer teams                                      |

导出 ABI 仅保留公开查询、Agent 创建及收益领取接口、协议事件和标准用户资产交互接口，前端可以直接按本手册建立 ABI 白名单。 / Exported ABIs contain only public queries, Agent creation and claim interfaces, protocol events, and standard user asset interactions, so the frontend can use this guide as its ABI allow-list.

`FRONTEND_OUTPUT_ROOT_RELATIVE` 和 `FRONTEND_ARCHIVE_RELATIVE` 必须是 `docs/` 内的相对路径。自定义输出目录时，脚本不会自动复制本手册；交付时请把本文件一并放入包内。 / `FRONTEND_OUTPUT_ROOT_RELATIVE` and `FRONTEND_ARCHIVE_RELATIVE` must remain relative paths inside `docs/`. When using a custom output directory, the script does not copy this guide; include this file separately in the delivery.

### 1.1 实现版本与 ABI 匹配 / Implementation and ABI compatibility

本次 M-02/M-03 修复对应合约实现 **v1.1.0**。当前保留的 `deployments/remote.json` 快照记录的是 **v1.0.0**，同目录 ABI 和历史归档不能直接作为 v1.1.0 集成包；本次文档更新不代表该部署已升级。 / The M-02/M-03 fixes correspond to implementation **v1.1.0**. The retained `deployments/remote.json` snapshot records **v1.0.0**; the bundled ABIs and historical archives are not a v1.1.0 integration package. Updating this guide does not upgrade that deployment.

导出脚本优先读取 `artifacts/`，只有对应文件不存在时才读取 `out/`。仅执行 Foundry 构建不会刷新已有 Hardhat ABI，因此上面的命令使用 Hardhat 编译。导出脚本不会强制校验源码和部署版本相同；交付前需读取 Proxy 的 `version()`，核对 `config.agent.version`，并确认导出的 ABI 包含当前实现所支持的字段和事件。 / The exporter prefers `artifacts/` and falls back to `out/` only when the corresponding file is absent. A Foundry build does not refresh existing Hardhat ABIs, so the commands above build with Hardhat. The exporter does not enforce source/deployment version equality; read the Proxy's version(), compare config.agent.version, and verify that the exported ABI matches the implementation before delivery.

v1.1.0 的公开 ABI 增加 `pendingBuyback(uint256)`、`BuybackExecuted`，并改变 `CreatorFeeDistributed` 的签名。`distributeCreatorFee` 和 `executeBuyback` 是 Owner 结算入口，仍从公开前端 ABI 中排除。旧实现不支持 `pendingBuyback`；字段缺失或读取失败应显示“不可用”，不能按余额为零处理。 / The v1.1.0 public ABI adds pendingBuyback(uint256) and BuybackExecuted and changes the CreatorFeeDistributed signature. The Owner settlement methods distributeCreatorFee and executeBuyback remain excluded from the public frontend ABI. Older implementations do not support pendingBuyback; absent fields or failed reads mean unavailable, not a zero balance.

## 2. 地址和数据关系 / Addresses and data relationships

```text
CurveCreatorAgent Proxy
    │ reads source/target state
    ├──> external Launchpad Factory ──> Launch record
    ├──> source Curve Launch ──> source Token / source FeeVault
    └──> target Curve Launch ──> target Token / target FeeVault / V3 Router
```

地址语义： / Address semantics:

| 地址 / Address                     | 说明 / Meaning                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `addresses.CurveCreatorAgent`      | 前端唯一集成地址 / The only Agent address used by the frontend                     |
| `addresses.CurveCreatorAgentProxy` | `CurveCreatorAgent` 地址别名 / Alias of `CurveCreatorAgent`                        |
| `addresses.LaunchpadFactory`       | Agent 绑定的外部 Launchpad Factory / External Launchpad Factory bound to the Agent |

所有 Agent 状态读取都绑定 `addresses.CurveCreatorAgent`。不要把部署目录中的其他合约地址当作前端调用目标，也不要把 Proxy 地址替换成外部 Launch、Token、FeeVault 或 Router 地址。 / Bind all Agent state reads to `addresses.CurveCreatorAgent`. Do not use other deployment-directory addresses as frontend targets, and do not replace the Proxy address with an external Launch, Token, FeeVault, or Router address.

## 3. 支付域和状态模型 / Payment domain and state model

```ts
enum PaymentKind {
  NativeWrapped = 0,
  Erc20 = 1,
}
```

`NativeWrapped` 的 `paymentToken` 通常是 WETH 等包装资产，但 creator fee 账本使用 `asset = address(0)`；`Erc20` 使用具体支付 Token 地址。所有金额均为 raw units，精度必须从外部 Factory 的支付配置或 Token `decimals()` 读取。 / For `NativeWrapped`, `paymentToken` is usually WETH or another wrapped asset, while the creator-fee ledger uses `asset = address(0)`. For `Erc20`, the ledger uses the concrete payment-token address. All amounts are raw units; read decimals from the external Factory payment configuration or Token `decimals()`.

Agent 只接受一个 source payment domain。导出快照中的 `config.source.paymentConfigured`、`paymentKind` 和 `paymentToken` 用于判断 source Launch 是否已经形成统一支付域；目标配置中的对应字段用于判断买回资产。 / The Agent accepts one source payment domain. Use `config.source.paymentConfigured`, `paymentKind`, and `paymentToken` in the exported snapshot to determine whether source Launches have a unified payment domain; use the corresponding target fields to determine the buyback asset.

| 快照字段 / Snapshot field                           | 前端含义 / Frontend meaning                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `config.agent.version` | 导出时读取的实现版本，需与当前 Proxy 再次核对 / Implementation version at export; recheck against the current Proxy |
| `config.target.configured`                          | 是否存在可用于公开展示的目标 Launch 配置 / Whether a target Launch configuration is available for display |
| `config.target.launch`、`token`                     | 目标 Curve Launch 和目标 Token / Target Curve Launch and Token                                            |
| `config.target.feeVault`                            | 目标 creator-fee FeeVault / Target creator-fee FeeVault                                                   |
| `config.target.paymentKind`、`paymentToken`、`weth` | 买回资产及其原生包装关系 / Buyback asset and its native-wrapper relationship                              |
| `config.target.router`、`poolFee`                   | 买回使用的 V3 Router 和池费率 / V3 Router and pool fee used for buyback                                   |
| `config.source.launchIds`                           | Agent 创建并登记的 source Launch ID / Source Launch IDs registered by the Agent                           |
| `config.source.launches[].fees.pending`             | 仍在外部 FeeVault 中的 creator fee / Creator fee still pending in the external FeeVault                   |
| `config.source.launches[].fees.claimable`           | 已记账、当前可领取的 creator fee / Accounted creator fee currently claimable                              |
| `config.source.launches[].fees.pendingBuyback` | v1.1.0 待回购支付资产余额，包含部分成交余款 / v1.1.0 reserved payment-asset balance, including partial-fill residuals |
| `config.source.launches[].fees.claimed`             | 累计已领取的 creator fee / Cumulative creator fee already claimed                                         |

目标配置字段始终表示最近一次成功发布的目标 Launch。每次目标配置刷新都会重新写入目标 Launch、Token、FeeVault、支付资产、Router 和池费率，并再次发出 `TargetLaunchConfigured`；前端不要把该事件当作只能出现一次。 / Target fields always represent the most recently published target Launch. Each successful target refresh writes the target Launch, Token, FeeVault, payment asset, Router, and pool fee again and emits `TargetLaunchConfigured`; the frontend must not assume that this event occurs only once.

## 4. 公开接口 / Public interfaces

### 4.1 Agent Proxy / Agent Proxy

使用 `CurveCreatorAgent.abi.json` 读取状态或执行表中公开写入： / Use `CurveCreatorAgent.abi.json` for state reads and the public writes listed below:

| 方法 / Method                                                                     | 用途 / Use                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `version()`                                                                       | 展示协议组件版本 / Display component version                                                            |
| `launchpadFactory()`                                                              | 校验外部 Factory 绑定 / Verify the external Factory binding                                             |
| `targetConfigured()`、`targetLaunchId()`、`targetLaunch()`、`targetToken()`       | 展示目标 Launch 和 Token / Display target Launch and Token                                              |
| `targetFeeVault()`、`targetPaymentToken()`、`targetPaymentKind()`、`targetWeth()` | 展示目标费用资产 / Display target fee asset                                                             |
| `targetRouter()`、`targetPoolFee()`                                               | 展示买回路由信息 / Display buyback route information                                                    |
| `sourcePaymentConfigured()`、`sourcePaymentToken()`、`sourcePaymentKind()`        | 展示 source 支付域 / Display source payment domain                                                      |
| `sourceLaunchIds()`、`sourceLaunches(launchId)`                                   | 列出 source Launch 及其绑定信息 / List source Launches and their bindings                               |
| `pendingCreatorFee(launchId)`                                                     | 展示仍在 FeeVault 中待分配的 creator fee / Display creator fees still pending in FeeVault               |
| `claimableCreatorFee(launchId)`                                                   | 展示已由 Agent 记账、可由 creator 领取的金额 / Display Agent-accounted amount claimable by the creator  |
| `creatorFeeClaimable(launchId)`                                                   | 读取已记账余额的 mapping getter / Read the mapping getter for the accounted balance                     |
| `pendingBuyback(launchId)` | v1.1.0 待回购支付资产余额，不能由创建者领取 / v1.1.0 reserved payment-asset balance, unavailable for creator withdrawal |
| `creatorFeeClaimed(launchId)`                                                     | 读取累计已领取余额 / Read the cumulative claimed balance                                                |
| `claimCreatorFee(launchId)`                                                       | creator 领取已记账的 50% / Creator claims the accounted 50%                                             |
| `createCurveLaunch(...)`                                                          | 通过 Agent 创建并登记 source Curve Launch / Create and register a source Curve Launch through the Agent |

`sourceLaunches(launchId)` 返回 `launch`、`token`、`creatorRecipient`、`feeVault`、`paymentToken`、`paymentKind` 和 `registered`。`registered == false` 的记录应标记为无效，不要展示为 source Launch。 / `sourceLaunches(launchId)` returns `launch`, `token`, `creatorRecipient`, `feeVault`, `paymentToken`, `paymentKind`, and `registered`. Mark records with `registered == false` as invalid and do not display them as source Launches.

### 4.2 创建 source Curve Launch / Create a source Curve Launch

第一个 source 由用户公开创建，不要求 Owner 先配置 target，也不要求 Owner 首创。Factory 在链上限制允许的支付资产；Agent 记录首个 source 的支付域，并继续校验后续 source 和 target 的 `paymentToken`、`paymentKind` 一致。Owner 随后调用 `setTargetToken` 配置已完成迁移的同域目标。前端不应仅因 `targetConfigured == false` 或 `sourcePaymentConfigured == false` 禁用创建。若旧部署包含 Owner 首创限制，需要升级后才支持该流程。/ The first source is publicly created by a user without prior Owner target configuration or Owner creation. The Factory restricts payment assets on-chain; the Agent records the first source domain and validates paymentToken/paymentKind consistency for later sources and targets. The Owner subsequently configures a migrated target in that domain. Do not disable creation solely because either configuration flag is false. Older deployments with Owner-only bootstrap require an upgrade.

创建页调用 Agent Proxy 的以下接口；不要直接调用外部 Factory 的同名接口，否则新 Launch 不会进入 Agent 的 `sourceLaunches` 登记关系。 / The creation page calls the following interface on the Agent Proxy. Do not call the same-named method on the external Factory directly, or the new Launch will not be registered in the Agent's `sourceLaunches` relation.

```solidity
function createCurveLaunch(
  uint256 templateId,
  uint256 dexConfigId,
  uint256 paymentTokenConfigId,
  string calldata name,
  string calldata symbol,
  string calldata metadataURI
) external returns (uint256 launchId, address token, address launch);

struct CreateParams {
  uint256 templateId;
  uint256 dexConfigId;
  uint256 paymentTokenConfigId;
  string name;
  string symbol;
  string metadataURI;
  uint256 initialBuyAmount;
  uint256 initialBuyMinOut;
  uint256 initialBuyDeadline;
}

function createCurveLaunch(
  CreateParams calldata params
) external payable returns (uint256 launchId, address token, address launch);
```

创建前从同一版本的 Launchpad 集成包读取并校验 `templateId`、`dexConfigId` 和 `paymentTokenConfigId`；确认模板、DEX 和支付配置可用，并使用支付配置中的精度处理相关金额。`initialBuyAmount == 0` 时只创建；大于 0 时，在同一笔交易中完成首笔买入，Native 使用 `msg.value`，ERC20 使用创建者对 Agent 的 allowance。 / Before creation, read and validate `templateId`, `dexConfigId`, and `paymentTokenConfigId` from the same-version Launchpad integration package. Confirm the template, DEX, and payment configuration are usable and use the payment configuration decimals for related amounts. When `initialBuyAmount == 0`, only creation occurs; when it is non-zero, the first buy is atomic, using `msg.value` for Native and the creator's allowance to the Agent for ERC20.

成功回执必须在 Agent Proxy 上解析 `TokenCreated(launchId, launch, token, creatorRecipient, feeVault, paymentToken)`；如果配置了首笔买入，还要解析紧邻的 `InitialBuyExecuted(launchId, buyer, token, amountIn, tokenOut, refundAmount)`。再通过外部 Factory 的 `getLaunchRecord(launchId)` 和 Launch 的公开读取接口补全模式、元数据、支付类型、池和 FeeVault 信息。 / On success, parse `TokenCreated(launchId, launch, token, creatorRecipient, feeVault, paymentToken)` from the Agent Proxy; when an initial buy is requested, also parse the adjacent `InitialBuyExecuted(launchId, buyer, token, amountIn, tokenOut, refundAmount)`. Then use the external Factory's `getLaunchRecord(launchId)` and the Launch public reads to complete mode, metadata, payment type, pool, and FeeVault information.

六参数重载始终不执行首笔买入；`CreateParams` 重载允许 `initialBuyAmount > 0`。NativeWrapped 要求 `msg.value == initialBuyAmount`，Erc20 要求 `msg.value == 0` 并由创建者先授权 Agent Proxy，合约会把未使用的支付资产退款给 `buyer`。`initialBuyMinOut` 必须大于 0，`initialBuyDeadline` 必须有效。 / The six-argument overload never executes an initial buy; the `CreateParams` overload accepts `initialBuyAmount > 0`. NativeWrapped requires `msg.value == initialBuyAmount`; Erc20 requires `msg.value == 0` and a prior approval from the creator to the Agent Proxy, after which unused payment assets are refunded to `buyer`. `initialBuyMinOut` must be greater than zero and `initialBuyDeadline` must be valid.

### 4.3 外部 Factory 和 Launch / External Factory and Launch

使用 `ICurveCreatorAgentFactory.abi.json`： / Use `ICurveCreatorAgentFactory.abi.json`:

```ts
const record = await publicClient.readContract({
  address: launchpadFactory,
  abi: factoryAbi,
  functionName: 'getLaunchRecord',
  args: [launchId],
});

const dex = await publicClient.readContract({
  address: launchpadFactory,
  abi: factoryAbi,
  functionName: 'getDexConfig',
  args: [record.dexConfigId],
});
```

使用 `ICurveCreatorAgentLaunch.abi.json` 读取 source/target Launch 的 `factory()`、`creator()`、`token()`、`paymentToken()`、`paymentKind()`、`pool()`、`poolFee()`、`feeVault()`、`launchId()`、`positionTokenId()` 和 `state()`。ABI 还包含 `buyFor(address,uint256,uint256)`，直接交易时按 Launchpad Curve 交易规范处理支付资产和滑点。 / Use `ICurveCreatorAgentLaunch.abi.json` to read `factory()`, `creator()`, `token()`, `paymentToken()`, `paymentKind()`, `pool()`, `poolFee()`, `feeVault()`, `launchId()`, `positionTokenId()`, and `state()` from source or target Launches. The ABI also contains `buyFor(address,uint256,uint256)`; when trading directly, follow the Launchpad Curve trading rules for payment assets and slippage.

Factory 的 `getLaunchRecord(launchId)` 是模式、Token、Launch、配置 ID、`snapshotHash`、`metadataURI` 和 `metadataHash` 的权威来源；Agent 的 `sourceLaunches` 是 source 登记关系的权威来源。两者不一致时标记为未验证。 / The Factory's `getLaunchRecord(launchId)` is authoritative for mode, Token, Launch, configuration IDs, `snapshotHash`, `metadataURI`, and `metadataHash`; the Agent's `sourceLaunches` is authoritative for source registration. Mark a record as unverified if they disagree.

### 4.4 Token 和 FeeVault / Token and FeeVault

对 `source.token`、`target.token` 和支付 Token 使用 `ERC20.abi.json` 读取 `name()`、`symbol()`、`decimals()`、`totalSupply()`、`balanceOf()` 和 `allowance()`。用户交易页如需授权，应仅对实际交易目标合约执行 `approve()`。 / Use `ERC20.abi.json` to read `name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf()`, and `allowance()` for source/target Tokens and payment Tokens. If a user trading page needs an approval, approve only the actual trade target.

对 FeeVault 使用 `ICurveCreatorAgentFeeVault.abi.json` 读取 `claimableBalance(launchId, beneficiary, asset)` 和 `weth()`；Agent 的 `pendingCreatorFee` 表示仍在 FeeVault 中的 creator fee，`claimableCreatorFee` 与 `creatorFeeClaimable` 表示已由 Agent 记账、可由真实 creator 手动领取的 50%，`creatorFeeClaimed` 表示累计已领取数量。 / Use `ICurveCreatorAgentFeeVault.abi.json` to read `claimableBalance(launchId, beneficiary, asset)` and `weth()`; Agent `pendingCreatorFee` is the creator fee still in FeeVault, `claimableCreatorFee` and `creatorFeeClaimable` are the Agent-accounted 50% available for the real creator to claim manually, and `creatorFeeClaimed` is the cumulative claimed amount.

v1.1.0 中，`pendingBuyback(sourceLaunchId)` 返回待回购余额，与创建者可领取余额独立；原生支付以原生币记账，ERC20 支付以支付 Token 记账。创建者入账和提现无需回购成功。`CreatorFeeDistributed` 仅表示分配入账，不能据此显示回购已完成。 / In v1.1.0, pendingBuyback records reserved input separately from creator claims, in native currency or the payment token according to payment kind. Accrual and withdrawal do not require a successful buyback; CreatorFeeDistributed does not indicate buyback completion.

新接口和事件适用于 v1.1.0 实现。历史部署快照及打包文件保留原版本，升级后需重新导出匹配的 ABI、地址和快照。 / The new API and events apply to v1.1.0. Existing deployment snapshots and archives retain their original version; export matching ABI, addresses, and snapshots after upgrading.

### 4.5 收益展示与领取 / Fee display and claims

按 source Launch 分别展示以下四个数值；它们不能直接相加为“可领取收益”。 / Display these four values separately for each source Launch; their sum is not the creator's claimable income.

| 展示项 / Display | 数据来源 / Source | 语义 / Meaning |
|---|---|---|
| 待分配手续费 / Fees awaiting distribution | `pendingCreatorFee(launchId)` | FeeVault 尚未分配的总额，含创建者和回购两份 / Undistributed total in FeeVault, including both creator and buyback shares |
| 可领取收益 / Claimable income | `claimableCreatorFee(launchId)` | 创建者当前可提取的准确金额 / Exact amount currently withdrawable by the creator |
| 待回购资金 / Pending buyback | `pendingBuyback(launchId)` | 预留的支付资产，尚未换成目标 Token / Reserved payment assets not yet swapped into target tokens |
| 累计已领取 / Total claimed | `creatorFeeClaimed(launchId)` | 历史提现累计值 / Cumulative historical withdrawals |

例如实际到账 101 个最小单位时，创建者入账 50，待回购增加 51；若只花费 25，待回购剩余 26，创建者仍可领取 50。回购输出使用目标 Token 的精度展示，其他上述余额使用 source 支付资产的精度；不要将 `targetTokenOut` 与支付资产数量直接相加。 / For 101 received base units, 50 are credited to the creator and 51 reserved for buyback. Spending only 25 leaves 26 reserved while the creator can still claim 50. Format buyback output using target-token decimals and the balances above using source payment-asset decimals; do not add targetTokenOut directly to payment-asset amounts.

领取流程： / Claim flow:

1. 读取 `sourceLaunches(launchId)`，确认 `registered == true` 且连接的钱包地址等于 `creatorRecipient`，再读取 `claimableCreatorFee`。/ Read sourceLaunches, verify registration and that the connected wallet equals creatorRecipient, then read claimableCreatorFee.
2. 可领取金额大于零时，钱包向 Agent Proxy 调用 `claimCreatorFee(launchId)`；无需授权 ERC20，也不附带原生币。该调用领取当前全部已入账余额，没有金额参数。/ When the claimable amount is positive, call claimCreatorFee on the Agent Proxy without ERC20 approval or native value. The call withdraws the entire credited balance and has no amount parameter.
3. 等待成功回执并解析 `CreatorFeeClaimed`，刷新可领取、累计已领取和钱包余额；失败时保留原展示并重新读取链上状态。/ Wait for a successful receipt, parse CreatorFeeClaimed, and refresh claimable, total claimed, and wallet balances. On failure, retain the display and reread chain state.

v1.1.0 的领取按钮不依赖目标配置、待回购余额是否为零或最近一次回购是否成功。全局暂停仍允许已入账收益提现。Owner 尚未执行分配时，FeeVault 中的待分配余额不能通过 `claimCreatorFee` 直接领取。 / In v1.1.0, the claim button does not depend on target configuration, an empty buyback reserve, or the latest buyback succeeding. Accrued withdrawals remain available while globally paused. Fees still in FeeVault cannot be claimed through claimCreatorFee until the Owner distributes them.

## 5. 事件索引 / Event indexing

在 `addresses.CurveCreatorAgent` 上索引以下事件： / Index the following events at `addresses.CurveCreatorAgent`:

| 事件 / Event             | 语义 / Meaning                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TokenCreated`           | 新 source Launch 和 Token 已登记 / A new source Launch and Token were registered                                                      |
| `TargetLaunchConfigured` | 目标 Launch 配置已发布或刷新 / Target Launch configuration was published or refreshed                                                 |
| `CreatorFeeAccrued`      | 50% creator fee 已记入 Agent 待领取账本 / 50% creator fee was credited to the Agent claim ledger                                      |
| `CreatorFeeClaimed`      | creator 已手动领取 Agent 账本余额 / Creator manually claimed the Agent ledger balance                                                 |
| `CreatorFeeDistributed`  | creator fee 已拆分入账，另一半进入待回购账本 / Creator fee was allocated to creator credit and pending buyback |
| `BuybackExecuted` | 回购实际支出、目标输出及剩余预算 / Actual buyback spending, target output, and remaining budget |
| `InitialBuyExecuted`     | 创建时原子首笔买入已执行 / Atomic initial buy during creation was executed                                                            |

```solidity
event TokenCreated(
  uint256 indexed launchId,
  address indexed launch,
  address indexed token,
  address creatorRecipient,
  address feeVault,
  address paymentToken
);

event TargetLaunchConfigured(
  uint256 indexed targetLaunchId,
  address indexed targetLaunch,
  address indexed targetToken,
  address targetPaymentToken,
  address targetRouter
);

event CreatorFeeAccrued(
  uint256 indexed sourceLaunchId,
  address indexed creatorRecipient,
  address indexed asset,
  uint256 amount
);

event CreatorFeeClaimed(
  uint256 indexed sourceLaunchId,
  address indexed creatorRecipient,
  address indexed asset,
  uint256 amount
);

event CreatorFeeDistributed(
  uint256 indexed sourceLaunchId,
  address indexed creatorRecipient,
  address indexed asset,
  uint256 totalCreatorFee,
  uint256 creatorAmount,
  uint256 buybackAmount
);

event BuybackExecuted(
  uint256 indexed sourceLaunchId,
  address indexed targetToken,
  address indexed asset,
  uint256 amountSpent,
  uint256 targetTokenOut,
  uint256 remainingBuyback
);

event InitialBuyExecuted(
  uint256 indexed launchId,
  address indexed buyer,
  address indexed token,
  uint256 amountIn,
  uint256 tokenOut,
  uint256 refundAmount
);
```

推荐唯一键为 `chainId + agentProxy + transactionHash + logIndex`。交易展示以回执事件为准，索引器应处理链重组并避免重复累计 creator fee 或买回数量。 / Use `chainId + agentProxy + transactionHash + logIndex` as the event key. Use receipt events for displayed transaction results; indexers must handle reorgs and avoid double-counting creator fees or buyback amounts.

### 5.1 分配、回购和升级的索引规则 / Indexing distribution, buyback, and upgrades

- `CreatorFeeAccrued.amount` 与同笔 `CreatorFeeDistributed.creatorAmount` 描述同一次创建者入账，只选一个作为累计依据，避免记两次。`CreatorFeeDistributed.buybackAmount` 是新增预算，不是实际回购支出。/ CreatorFeeAccrued.amount and CreatorFeeDistributed.creatorAmount describe the same creator credit; choose one for totals. CreatorFeeDistributed.buybackAmount is new budget, not actual spending.
- `BuybackExecuted.amountSpent` 才是实际支付资产支出；`targetTokenOut` 是实际转入 `0xdead` 的目标 Token 数量；`remainingBuyback` 是执行后的余额快照，应覆盖该 source 的待回购展示，不能累计相加。/ BuybackExecuted.amountSpent is actual payment-asset spending, targetTokenOut is the target amount delivered to 0xdead, and remainingBuyback is the post-execution balance to replace, not add to, the source's displayed reserve.
- 用事件中的 `targetToken` 标记该次回购，历史记录不能随当前全局目标变化而重标。后续目标变更时，已有待回购支付资产将按新配置执行，不能把这笔预算预先记成旧目标 Token。/ Label each buyback with its event's targetToken; do not relabel historical buys when the global target changes. Pending payment assets use the configuration in effect when executed and must not be recorded as holdings of the previous target token.
- 分配与回购属于不同交易。没有 `BuybackExecuted` 不能推断分配失败，也不能区分“尚未执行回购”与“回购交易失败”；刷新 `pendingBuyback` 显示余额，只有已知失败交易的回执才能用于显示失败。/ Distribution and buyback are separate transactions. A missing BuybackExecuted neither implies failed distribution nor distinguishes an unattempted buyback from a failed attempt. Refresh pendingBuyback and use a known failed transaction receipt to label failure.
- 旧版 `CreatorFeeDistributed(uint256,address,address,uint256,uint256,uint256,uint256)` 与新版 `CreatorFeeDistributed(uint256,address,address,uint256,uint256,uint256)` 的 topic0 不同；旧版第三个 indexed 字段为 `targetToken`，新版为 `asset`。升级后的历史扫描须同时保留两版事件解码，按 topic0 选择签名；当前 `version()` 不能代表所有历史日志的版本。/ Legacy and new CreatorFeeDistributed signatures have different topic0 values; the third indexed field changes from targetToken to asset. Keep both decoders for historical scans and select by topic0; the current version() does not identify every historical log's version.

## 6. 数量、精度与安全 / Amounts, decimals, and safety

- 所有金额使用 `bigint` 和 raw units；展示时使用 `formatUnits`，不要使用 JavaScript `number` 计算。 / Use `bigint` and raw units for all amounts; use `formatUnits` for display and never calculate with JavaScript `number`.
- 从导出 JSON 的 `chain.chainId` 校验钱包和 RPC 网络；从 `addresses.CurveCreatorAgent` 获取 Agent 地址。 / Validate the wallet and RPC network against `chain.chainId` and read the Agent address from `addresses.CurveCreatorAgent`.
- `targetConfigured == false` 时，不要把目标 Token、Router 或池信息展示为已生效配置。 / When `targetConfigured == false`, do not display the target Token, Router, or pool information as active configuration.
- `paymentKind == NativeWrapped` 时，FeeVault 账本资产是 `address(0)`，不是 `paymentToken` 地址。 / When `paymentKind == NativeWrapped`, the FeeVault ledger asset is `address(0)`, not the `paymentToken` address.
- 不要向 Agent Proxy 直接发送原生币；其原生币接收逻辑只服务于协议内部结算回调。 / Do not send native currency directly to the Agent Proxy; its native-currency receiver is reserved for protocol settlement callbacks.
- 不要把外部 Router 当作 Agent 的公开交易入口；本包不导出内部 Router 调用 ABI。 / Do not treat the external Router as a public Agent trading entrypoint; this package does not export the internal Router-call ABI.
- Token、Launch、FeeVault、Factory 的地址必须通过链上关系交叉校验；RPC 失败或未知记录应标记为未验证。 / Cross-check Token, Launch, FeeVault, and Factory addresses through on-chain relationships; mark RPC failures or unknown records as unverified.

## 7. 最小 Viem 示例 / Minimal Viem example

```ts
import { createPublicClient, http } from 'viem';
import deployment from './deployments/arcMainnet.json';
import agentAbi from './abis/CurveCreatorAgent.abi.json';

const agentProxy = deployment.addresses.CurveCreatorAgent as `0x${string}`;
const publicClient = createPublicClient({
  chain,
  transport: http('https://rpc.example'),
});

const [configured, targetToken, sourceLaunchIds] = await Promise.all([
  publicClient.readContract({ address: agentProxy, abi: agentAbi, functionName: 'targetConfigured' }),
  publicClient.readContract({ address: agentProxy, abi: agentAbi, functionName: 'targetToken' }),
  publicClient.readContract({ address: agentProxy, abi: agentAbi, functionName: 'sourceLaunchIds' }),
]);
```

实际项目应使用部署快照中的 chain ID 和地址，不要把示例中的 `arcMainnet` 或 RPC URL 当作固定配置。 / Production code should use the chain ID and addresses from the deployment snapshot; do not treat `arcMainnet` or the example RPC URL as fixed configuration.

## 8. 上线检查清单 / Release checklist

- [ ] ABI、Proxy 地址、Factory 地址和快照来自同一次导出。 / ABI, Proxy, Factory address, and snapshot come from one export.
- [ ] ABI 已绑定 `addresses.CurveCreatorAgent`，没有绑定其他部署地址。 / ABI is bound to `addresses.CurveCreatorAgent` and no other deployment address.
- [ ] `chain.chainId` 与钱包网络一致。 / `chain.chainId` matches the wallet network.
- [ ] `getLaunchRecord` 与 `sourceLaunches` 的 Launch、Token、FeeVault 关系一致。 / Launch, Token, and FeeVault relationships match between `getLaunchRecord` and `sourceLaunches`.
- [ ] NativeWrapped/Erc20 的账本资产语义已按 `paymentKind` 处理。 / Ledger asset semantics are handled according to `paymentKind`.
- [ ] 已核对 v1.1.0 的 `pendingBuyback`、新版分配事件和独立回购事件；旧版缺失字段不会显示为零。 / Verified v1.1.0 pendingBuyback and both new settlement events; unsupported legacy fields do not display as zero.
- [ ] 可领取收益独立于目标配置和回购结果，历史入账事件不会重复累计。 / Claims remain independent of target configuration and buyback results, and credit events are not counted twice.
- [ ] 事件按交易回执和 `logIndex` 去重。 / Events are deduplicated by receipt and `logIndex`.
- [ ] 未确认的 RPC、地址或状态不会被静默展示为有效。 / Unverified RPC results, addresses, or states are not silently shown as valid.

作者 / Author: frankd6eaf  
更新时间 / Updated: 2026-09-17  
版本号 / Version: v1.0.7
