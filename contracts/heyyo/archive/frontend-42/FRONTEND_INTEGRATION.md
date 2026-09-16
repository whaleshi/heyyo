# AYOO Proxy 协议前端集成文档 / AYOO Proxy Protocol Frontend Integration Guide

> 本文面向公开前端、钱包展示页和索引服务。AYOO Proxy 是一个连接 AYOO Launchpad 的 Curve creator-fee 结算组件；本文只描述公开读取、事件索引、资产展示和地址校验。 / This guide is for public frontends, wallet views, and indexers. AYOO Proxy is a Curve creator-fee settlement component connected to AYOO Launchpad; this guide covers only public reads, event indexing, asset display, and address validation.

本包提供公开查询和 Agent Proxy 创建流程所需的 ABI。结算和其他非公开写入流程不属于本前端包；前端不要根据源码 ABI 自行补回未导出的写方法。 / This package provides the ABIs required for public queries and the Agent Proxy creation flow. Settlement and other non-public write flows are outside this frontend package; do not reconstruct omitted write methods from source ABIs.

## 1. 导出集成包 / Export the integration package

先编译合约，再按部署网络导出。脚本优先从当前 `artifacts/` 读取 ABI；本仓库使用 Foundry 构建时也会从 `out/` 读取，并从部署网络读取 chain ID、Proxy 状态和 source Launch 快照。 / Build first, then export for the deployment network. The script prefers current ABIs from `artifacts/`, also reads `out/` for Foundry builds, and reads the chain ID, Proxy state, and source Launch snapshot from the deployment network.

```bash
pnpm run fg:build
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

导出 ABI 仅保留公开查询、Agent 创建接口、协议事件和标准用户资产交互接口，前端可以直接按本手册建立 ABI 白名单。 / Exported ABIs contain only public queries, the Agent creation interface, protocol events, and standard user asset interactions, so the frontend can use this guide as its ABI allow-list.

`FRONTEND_OUTPUT_ROOT_RELATIVE` 和 `FRONTEND_ARCHIVE_RELATIVE` 必须是 `docs/` 内的相对路径。自定义输出目录时，脚本不会自动复制本手册；交付时请把本文件一并放入包内。 / `FRONTEND_OUTPUT_ROOT_RELATIVE` and `FRONTEND_ARCHIVE_RELATIVE` must remain relative paths inside `docs/`. When using a custom output directory, the script does not copy this guide; include this file separately in the delivery.

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
| `config.target.configured`                          | 是否存在可用于公开展示的目标 Launch 配置 / Whether a target Launch configuration is available for display |
| `config.target.launch`、`token`                     | 目标 Curve Launch 和目标 Token / Target Curve Launch and Token                                            |
| `config.target.feeVault`                            | 目标 creator-fee FeeVault / Target creator-fee FeeVault                                                   |
| `config.target.paymentKind`、`paymentToken`、`weth` | 买回资产及其原生包装关系 / Buyback asset and its native-wrapper relationship                              |
| `config.target.router`、`poolFee`                   | 买回使用的 V3 Router 和池费率 / V3 Router and pool fee used for buyback                                   |
| `config.source.launchIds`                           | Agent 创建并登记的 source Launch ID / Source Launch IDs registered by the Agent                           |
| `config.source.launches[].fees.pending`             | 仍在外部 FeeVault 中的 creator fee / Creator fee still pending in the external FeeVault                   |
| `config.source.launches[].fees.claimable`           | 已记账、当前可领取的 creator fee / Accounted creator fee currently claimable                              |
| `config.source.launches[].fees.claimed`             | 累计已领取的 creator fee / Cumulative creator fee already claimed                                         |

目标配置字段始终表示最近一次成功发布的目标 Launch。每次目标配置刷新都会重新写入目标 Launch、Token、FeeVault、支付资产、Router 和池费率，并再次发出 `TargetLaunchConfigured`；前端不要把该事件当作只能出现一次。 / Target fields always represent the most recently published target Launch. Each successful target refresh writes the target Launch, Token, FeeVault, payment asset, Router, and pool fee again and emits `TargetLaunchConfigured`; the frontend must not assume that this event occurs only once.

## 4. 公开接口 / Public interfaces

### 4.1 Agent Proxy / Agent Proxy

使用 `CurveCreatorAgent.abi.json` 读取： / Use `CurveCreatorAgent.abi.json` to read:

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
| `creatorFeeClaimed(launchId)`                                                     | 读取累计已领取余额 / Read the cumulative claimed balance                                                |
| `claimCreatorFee(launchId)`                                                       | creator 领取已记账的 50% / Creator claims the accounted 50%                                             |
| `createCurveLaunch(...)`                                                          | 通过 Agent 创建并登记 source Curve Launch / Create and register a source Curve Launch through the Agent |

`sourceLaunches(launchId)` 返回 `launch`、`token`、`creatorRecipient`、`feeVault`、`paymentToken`、`paymentKind` 和 `registered`。`registered == false` 的记录应标记为无效，不要展示为 source Launch。 / `sourceLaunches(launchId)` returns `launch`, `token`, `creatorRecipient`, `feeVault`, `paymentToken`, `paymentKind`, and `registered`. Mark records with `registered == false` as invalid and do not display them as source Launches.

### 4.2 创建 source Curve Launch / Create a source Curve Launch

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

## 5. 事件索引 / Event indexing

在 `addresses.CurveCreatorAgent` 上索引以下事件： / Index the following events at `addresses.CurveCreatorAgent`:

| 事件 / Event             | 语义 / Meaning                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TokenCreated`           | 新 source Launch 和 Token 已登记 / A new source Launch and Token were registered                                                      |
| `TargetLaunchConfigured` | 目标 Launch 配置已发布或刷新 / Target Launch configuration was published or refreshed                                                 |
| `CreatorFeeAccrued`      | 50% creator fee 已记入 Agent 待领取账本 / 50% creator fee was credited to the Agent claim ledger                                      |
| `CreatorFeeClaimed`      | creator 已手动领取 Agent 账本余额 / Creator manually claimed the Agent ledger balance                                                 |
| `CreatorFeeDistributed`  | creator fee 已拆分，50% 进入可领取账本，买回结果已结算 / Creator fee was split, 50% entered the claim ledger, and the buyback settled |
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
  address indexed targetToken,
  uint256 totalCreatorFee,
  uint256 creatorAmount,
  uint256 buybackAmount,
  uint256 targetTokenOut
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
- [ ] 事件按交易回执和 `logIndex` 去重。 / Events are deduplicated by receipt and `logIndex`.
- [ ] 未确认的 RPC、地址或状态不会被静默展示为有效。 / Unverified RPC results, addresses, or states are not silently shown as valid.

作者 / Author: frankd6eaf  
更新时间 / Updated: 2026-09-17  
版本号 / Version: v1.0.3
