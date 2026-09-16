import {activity,withActivity} from './lib/launch-log.ts';
import {readFileSync,mkdirSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,keccak256,type Wallet,type TransactionRequest} from 'ethers';
import {parseLaunchConfig,safeError,LaunchError,amountRaw} from './lib/launch-config.ts';
import {readImage,uploadMetadata,preflight,launchInterface,createMethod} from './lib/launch-prepare.ts';
import {agentAddress,agentInterface,tokenInterface,parseAgentLog,read,readSource,sameAddress} from '../shared/contracts.ts';

export async function runBuyers<T>(buyers:T[],buy:(buyer:T,index:number)=>Promise<unknown>) {
  return Promise.allSettled(buyers.map(buy));
}
async function main() {
  const args=process.argv.slice(2),check=args.includes('--check');
  if(args.includes('--help')){console.log('pnpm launch:check [scripts/launch.local.json]\npnpm launch:run [scripts/launch.local.json]\n创建确认后立即并发买入；检查命令不上传、不广播。');return;}
  if(args.some(a=>a.startsWith('--')&&a!=='--check')||args.filter(a=>!a.startsWith('--')).length>1)throw new LaunchError('参数不正确，使用 --help 查看用法');
  const configFile=resolve(args.find(a=>!a.startsWith('--'))??'scripts/launch.local.json');
  let json;try{json=JSON.parse(readFileSync(configFile,'utf8'));}catch{throw new LaunchError('无法读取 JSON 配置文件');}
  const config=parseLaunchConfig(json),image=readImage(config,configFile);
  const provider=new JsonRpcProvider(config.rpcUrl,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=500;
  let journal:Record<string,unknown>|undefined,journalPath='';
  const transactions:Record<string,unknown>[]=[];
  function save(){if(!journal)return;const temporary=`${journalPath}.tmp`;writeFileSync(temporary,JSON.stringify(journal,null,2)+'\n',{mode:0o600});renameSync(temporary,journalPath);}
  try {
    const ready=await withActivity('正在检查链、创建配置和钱包余额',()=>preflight(config,provider,activity));
    activity('链、创建配置和钱包余额检查通过');
    activity(`链 ${config.chainId}；创建钱包 ${ready.creator.address}；代币 ${config.token.name} ($${config.token.symbol})`);
    for(const [i,w] of ready.buyers.entries())activity(`买入钱包 ${i+1}: ${w.address}，${config.buyers[i].amount} ${ready.payment.symbol}`);
    if(check){console.log('配置、图片和链上余额检查通过。未上传或广播交易。');return;}
    const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../.data/launch-runs');mkdirSync(directory,{recursive:true,mode:0o700});journalPath=resolve(directory,`${config.runId}.json`);
    if(existsSync(journalPath))throw new LaunchError(`runId 已使用。请先查看 ${journalPath} 中的哈希；脚本不会重复创建或自动重发。`);
    journal={runId:config.runId,chainId:config.chainId,status:'preparing',startedAt:new Date().toISOString(),transactions};
    try{writeFileSync(journalPath,JSON.stringify(journal),{flag:'wx',mode:0o600});}catch{journal=undefined;throw new LaunchError('runId 已被其他进程占用');}
    async function send(wallet:Wallet,kind:'create'|'approve'|'buy',tx:TransactionRequest) {
      const task=`${{create:'创建',approve:'授权',buy:'买入'}[kind]} | ${wallet.address}`;
      activity(`${task}：准备签名`);
      const nonce=await provider.getTransactionCount(wallet.address,'pending');
      const raw=await wallet.signTransaction({...tx,chainId:config.chainId,type:0,gasPrice:ready.gasPrice,gasLimit:BigInt(config.gas[kind]),nonce});
      const hash=keccak256(raw),entry:Record<string,unknown>={kind,address:wallet.address,nonce,hash,status:'submitting'};
      transactions.push(entry);save();activity(`${task}：开始广播 | 交易 ${hash}`);
      try {
        const returned=await withActivity(`${task}：等待 RPC 接收 | 交易 ${hash}`,()=>provider.send('eth_sendRawTransaction',[raw]));
        if(returned.toLowerCase()!==hash.toLowerCase())throw new LaunchError('RPC 返回交易哈希不一致');
        entry.status='pending';save();
        const receipt=await withActivity(`${task}：已广播，等待链上确认 | 交易 ${hash}`,()=>provider.waitForTransaction(hash,1,config.timeoutSeconds*1000));
        if(!receipt)throw new LaunchError('等待回执超时');
        entry.blockNumber=receipt.blockNumber;entry.status=receipt.status===1?'confirmed':'reverted';save();
        activity(`${task}：${receipt.status===1?'交易成功':'交易回滚'} | 区块 ${receipt.blockNumber} | 交易 ${hash}`);
        if(receipt.status!==1)throw new LaunchError(`${kind} 交易回滚，请根据哈希检查`);
        return receipt;
      }catch(error){entry.error=safeError(error);save();activity(`${task}：未成功确认 | 交易 ${hash} | ${safeError(error)}`);throw error;}
    }
    const metadataURI=await withActivity('正在准备图片和代币资料',()=>uploadMetadata(config,image,activity));journal.metadataURI=metadataURI;save();
    journal.status='creating';save();
    const receipt=await send(ready.creator,'create',{to:agentAddress,data:agentInterface.encodeFunctionData(createMethod,
      [config.templateId,config.dexConfigId,config.paymentTokenConfigId,config.token.name,config.token.symbol,metadataURI])});
    const created=receipt.logs.map(l=>parseAgentLog({...l,topics:[...l.topics]})).find(e=>e?.name==='TokenCreated'&&sameAddress(e.args.creatorRecipient,ready.creator.address));
    if(!created)throw new LaunchError('创建回执中缺少匹配的 TokenCreated 事件');
    const source=await withActivity('创建已确认，正在校验合约绑定',()=>readSource(ready.rpc,created.args.launchId,`0x${receipt.blockNumber.toString(16)}`));
    if(!sameAddress(source.token,created.args.token)||!sameAddress(source.launch,created.args.launch)||!sameAddress(source.paymentToken,ready.payment.token)||source.paymentKind!==ready.payment.kind||source.paymentDecimals!==ready.payment.decimals)throw new LaunchError('创建后的合约绑定或支付配置不匹配');
    journal.launchId=source.launchId;journal.token=source.token;journal.launch=source.launch;journal.status='buying';save();
    activity(`创建成功 | 区块 ${receipt.blockNumber} | Token ${source.token}，立即启动 ${ready.buyers.length} 个钱包买入。`);
    const results=await runBuyers(ready.buyers,async(wallet,i)=>{
      const label=`买入钱包 ${i+1} | ${wallet.address}`;
      activity(`${label}：开始处理 ${config.buyers[i].amount} ${source.paymentSymbol}`);
      try {
      const amount=amountRaw(config.buyers[i].amount,source.paymentDecimals);
      if(source.paymentKind===1){activity(`${label}：检查授权额度`);const [allowance]=await read(ready.rpc,source.paymentToken,tokenInterface,'allowance',[wallet.address,source.launch]);
        if(allowance<amount){
          await send(wallet,'approve',{to:source.paymentToken,data:tokenInterface.encodeFunctionData('approve',[source.launch,amount])});}else activity(`${label}：授权额度足够，跳过授权`);}
      const receipt=await send(wallet,'buy',{to:source.launch,data:launchInterface.encodeFunctionData('buyFor',[wallet.address,amount,1n]),value:source.paymentKind===0?amount:0n});
      const received=receipt.logs.filter(l=>sameAddress(l.address,source.token)).some(l=>{const event=tokenInterface.parseLog(l);return event?.name==='Transfer'&&sameAddress(event.args.to,wallet.address)&&event.args.value>0n;});
      if(!received)throw new LaunchError('买入回执没有匹配的代币到账事件');
      activity(`${label}：到账验证通过 | 区块 ${receipt.blockNumber} | 交易 ${receipt.hash}`);
      return receipt.hash;
      } catch(error) {activity(`${label}：处理失败 | ${safeError(error)}`);throw error;}
    });
    journal.buyers=results.map((r,i)=>({address:ready.buyers[i].address,amount:config.buyers[i].amount,status:r.status==='fulfilled'?'confirmed':'failed',...(r.status==='fulfilled'?{hash:r.value}:{error:safeError(r.reason)})}));
    const failed=results.filter(r=>r.status==='rejected').length;
    journal.status=failed?'partial':'completed';journal.completedAt=new Date().toISOString();save();
    activity(`创建完成；买入成功 ${results.length-failed}，失败 ${failed}。结果：${journalPath}`);
    if(failed)process.exitCode=1;
  } catch(error){if(journal){journal.status='stopped';journal.error=safeError(error);save();console.error(`结果文件：${journalPath}`);}throw error;}finally{provider.destroy();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{activity(`脚本停止：${safeError(error)}`);process.exitCode=1;});
