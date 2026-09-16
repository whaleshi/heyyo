# Current contract artifacts — frontend 43

`abis/`, `deployment.json` (from deployments/remote.json), and `FRONTEND_INTEGRATION.md` were copied unchanged from `/Users/shijy/Downloads/frontend 43` on 2026-09-17.

Verified against the configured RPC: chainId 5042, Agent 0xe5FC1B60afb89a9136fe7A5c4eE5A03D33c8612b, version 1.1.0, Factory 0xED31e7ec603651803784196003903aCa05550552. Successful proxy deployment receipt is block 21208472 (the other Agent entry says 21208471). Template 2, DEX 1, payment 1 are verified enabled, with ERC20 USDC precision 6.

The supplied guide's section 1.1 still says its retained snapshot is version 1.0.0. This statement is stale relative to the supplied JSON and the verified on-chain version 1.1.0. The configured RPC identifies as Anvil, even though its chainId is 5042; it is not interchangeable with Arc's public RPC, where this Agent was not verified.

v1.1.0 adds pendingBuyback and BuybackExecuted and changes CreatorFeeDistributed to source payment asset + allocated amounts. Allocation is distinct from actual buyback execution. Frontend, script and indexer share the updated ABI/deployment. Public writes remain creation and claiming; no settlement/admin methods added. Runtime validation also checks version().

Old deployment index data was deleted at the user's request. Archived frontend-42 files are reference artifacts only, never imported at runtime.

## Supplemental ABI provenance (historical)

# Contract artifacts

`abis/`, `deployment.json`, and `FRONTEND_INTEGRATION.md` were copied unchanged from the user-provided `/Users/shijy/Downloads/frontend 42` bundle on 2026-09-17.

`FactoryConfig.abi.json` contains only public read methods selected from `/Users/shijy/Desktop/work/ayoo/contracts/ayoo/abis/v2/LaunchFactory.abi.json`. Configuration counts, template 2, DEX 1, payment 1, and Curve profile reads were verified against the user-provided 31337 RPC. The Agent Factory binding matches the export. These supplemental reads do not add Agent admin/settlement methods.

The bundle lists Agent block 21186583 and Proxy block 21186584 for the same address/transaction. The successful transaction receipt verifies deployment at 21186584. The indexer uses that block.

The six-argument Agent creation method was checked using an eth_call simulation with these configurations. No transaction was broadcast.

`CurveMarket.abi.json` selects only the `graduationParameters` view and canonical `TokensBought`, `TokensSold`, `CurveGraduated`, `LiquidityMigrated` events from the reference project's `contracts/ayoo/abis/v2/CurveLaunch.abi.json`. These event signatures also match its CurveLaunchV2 export. No write methods are added. The supplied RPC verified SUN's graduation parameters (800 million curve tokens, 8,000 USDC reserve target), zero sold/reserve, token/payment precision and Agent/Factory/Launch bindings. Curve pricing follows the reference indexer's virtual-reserve calculation, keeping rational precision instead of truncating intermediate raw prices. V3 token0/token1 reads and canonical Swap are declared in the indexer and bound to the Launch's migration event. Actual trading paths are covered with decoded ABI fixtures; no real buy/sell transaction was broadcast for testing.

## RPC chain ID update

The user changed the RPC chain ID to 31337 without changing contract addresses. `eth_chainId` was verified as `0x7a69`; runtime deployment and local launch/indexer configuration now use 31337. The original bundle verification above describes the earlier chain ID.

The current 31337 RPC first exposes Agent code at block 21212823 (historical `eth_getCode` binary search; earlier blocks return `0x`). This is the current indexing start, not a verified new proxy deployment receipt. The bundle's original receipt block 21208472 does not contain this address on the current snapshot.
