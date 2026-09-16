# JSON 创建 + 多钱包并发买入

填写 `scripts/launch.local.json`，在项目根目录运行：

```sh
pnpm launch:check
pnpm launch:run
```

指定其他配置：`pnpm launch:run scripts/launch.second.local.json`。

## 配置

- `creator.privateKey`：创建钱包私钥。
- `token`：名称、符号、描述、图片路径、网站和社交链接。
- `buyers`：多个买入钱包的私钥和各自 `amount`。当前支付配置为 USDC，`"10.25"` 表示花费 10.25 USDC，不是买入 10.25 枚新币。金额必须填写字符串。
- `rpcUrl` / `chainId`：普通 RPC，当前已填 Arc 5042 主网部署，无需交易包服务。
- `runId`：本次发行唯一名称。结果保存在 `.data/launch-runs/<runId>.json`，同名拒绝重复运行。
- `gas.create` / `gas.approve` / `gas.buy`：固定 gas limit；`gas.gasPriceGwei`：固定 gas price。样例值可修改，脚本不调用 gas 预估。

图片 `token.imagePath` 相对于 JSON 所在目录，例如 `./token.png`。支持 PNG/JPEG/WebP，最大 2 MB。图片和 metadata 使用独立 Heyyo API 上传，需要 `pnpm indexer:api` 已启动，Pinata 密钥仍由服务端读取。

已有图片可以用 `imageURI: "ipfs://<CID>"` 替换 imagePath。已有完整 metadata 可以填 `metadataURI: "ipfs://<CID>"`，跳过上传。

## 执行过程

1. 校验私钥、链、创建配置及所有钱包余额，拒绝重复买入地址和已有 pending 交易的钱包。
2. 上传图片/metadata，通过 Agent 创建代币。
3. 创建交易成功进入一个区块并核对绑定关系后，立即启动全部买入钱包任务，没有额外 10 区块等待。
4. 每个钱包独立并行：ERC20 授权不足时先授权新 Launch，授权确认后立即发送该钱包买单。不等待其他钱包完成。
5. 买入固定 `minOut=1` raw unit，几乎不设价格滑点保护，不调用买入报价；合约限购、状态和余额限制仍有效。
6. 分别记录授权和买入哈希，验证回执成功及代币到账事件。一个钱包失败不取消其他钱包；部分失败时退出码为 1。

这是创建成功后的并发买入，**不保证创建和买入同块**。当前 ERC20 首次使用新 Launch 必须先确认授权。创建钱包可以作为一个买入钱包，但 buyers 中不能重复地址。

## 私钥及重复执行

可直接填 `privateKey`，也可替换为 `privateKeyEnv: "BUYER_1_PRIVATE_KEY"`，从当前 shell 环境变量读取；两项选一。脚本不会自动加载项目 `.env`。

本地配置权限为 0600，`scripts/launch.local.json` 和 `scripts/launch.*.local.json` 已忽略。示例 `launch.example.json` 只放占位内容。结果文件记录地址、金额、哈希和状态，不写入私钥或签名原文。

`launch:check` 只检查本地配置、图片及链上余额，不上传、不广播。`launch:run` 发出真实交易。发生超时或部分失败时，先检查结果文件和链上哈希；脚本不会自动重发，也不会为失败钱包重新创建代币。不要用不同 runId 同时操作同一钱包，以免 nonce 冲突。

类型检查：`pnpm launch:typecheck`。测试：`pnpm test`。未使用真实私钥执行交易。

## 实时日志

运行时按时间打印预检查、图片和 metadata 上传、创建、每个钱包的授权与买入进度。等待 RPC 或回执期间每 10 秒输出等待状态和耗时。每笔创建/授权/买入回执返回后，立即打印成功或回滚、钱包地址、区块号及交易哈希；买入另打印到账验证结果。单个钱包失败会立即输出，不必等其他钱包结束。日志不打印私钥或签名原文。

创建 gas limit 默认设为 `10000000`：当前部署创建过程中还要部署池合约，`6000000` 在内部 CREATE2 耗尽 gas。已用失败交易相同参数及前置区块做只读调用验证，1000 万可通过。保持固定 gas，不调用 gas 预估。
