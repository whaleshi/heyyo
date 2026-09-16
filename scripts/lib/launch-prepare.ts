import { readFileSync, statSync } from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import { Interface, JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import {agentAddress,agentInterface,tokenInterface,read,readCreationConfig,verifyDeployment, type Rpc} from '../../shared/contracts.ts';
import launchAbi from '../../contracts/heyyo/abis/ICurveCreatorAgentLaunch.abi.json';
import {sanitizeMetadata,validImage} from '../../indexer/src/uploads.ts';
import {LaunchError,amountRaw,uniqueBuyers,walletFromConfig,type LaunchConfig} from './launch-config.ts';
export const launchInterface=new Interface(launchAbi);
export const createMethod='createCurveLaunch(uint256,uint256,uint256,string,string,string)';
export function readImage(config:LaunchConfig,configFile:string) {
  if(config.token.metadataURI||!config.token.imagePath)return null;
  const path=resolve(dirname(configFile),config.token.imagePath),mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'} as Record<string,string>)[extname(path).toLowerCase()];
  let bytes:Buffer;try{if(statSync(path).size>2*1024*1024)throw 0;bytes=readFileSync(path);}catch{throw new LaunchError('图片不存在或超过 2 MB');}
  if(!bytes.length||!validImage(bytes,mime))throw new LaunchError('图片必须是 PNG/JPEG/WebP');return {bytes,mime};
}
export async function uploadMetadata(config:LaunchConfig,image:ReturnType<typeof readImage>,log:(message:string)=>void=()=>{}) {
  if(config.token.metadataURI){log('使用已有 metadata，跳过上传');return config.token.metadataURI;}
  async function pin(path:string,body:BodyInit,headers?:Record<string,string>) {
    const response=await fetch(`${config.uploadApiUrl.replace(/\/+$/,'')}/${path}`,{method:'POST',body,headers,signal:AbortSignal.timeout(60000)});
    const json=await response.json() as {cid?:string};
    if(!response.ok||!json.cid||!/^[a-zA-Z0-9]{20,120}$/.test(json.cid))throw new LaunchError('上传失败，请检查独立 Heyyo API/Pinata 配置');return `ipfs://${json.cid}`;
  }
  let imageURI=config.token.imageURI;
  if(image){log('开始上传代币图片');const form=new FormData();form.append('file',new Blob([new Uint8Array(image.bytes)],{type:image.mime}),`token${image.mime==='image/png'?'.png':image.mime==='image/webp'?'.webp':'.jpg'}`);imageURI=await pin('ipfs/pin-file',form);log(`图片上传成功：${imageURI}`);}
  const metadata=sanitizeMetadata({...config.token,image:imageURI});if(!metadata)throw new LaunchError('Metadata 信息无效');
  log('开始上传代币 metadata');
  const uri=await pin('ipfs/pin-json',JSON.stringify(metadata),{'Content-Type':'application/json'});
  log(`Metadata 上传成功：${uri}`);return uri;
}
export function validateGasPrice(gasPrice:bigint,baseFee:bigint|null) {
  if(baseFee!==null && gasPrice<baseFee)throw new LaunchError(`配置 gasPrice ${formatUnits(gasPrice,9)} Gwei 低于当前 base fee ${formatUnits(baseFee,9)} Gwei，请提高 gas.gasPriceGwei`);
}
export async function preflight(config:LaunchConfig,provider:JsonRpcProvider,log:(message:string)=>void=()=>{}) {
  const rpc:Rpc={request:(method,params)=>provider.send(method,params)};await verifyDeployment(rpc);
  const creator=walletFromConfig(config.creator),buyers=config.buyers.map(b=>walletFromConfig(b));uniqueBuyers(buyers.map(w=>w.address));
  const payment=await readCreationConfig(rpc,config),gasPrice=amountRaw(config.gas.gasPriceGwei,9);
  const block=await provider.getBlock('latest');if(!block)throw new LaunchError('无法读取区块');
  log(`固定 gasPrice：${formatUnits(gasPrice,9)} Gwei；当前 base fee：${block.baseFeePerGas===null?'无':formatUnits(block.baseFeePerGas,9)+' Gwei'}`);
  validateGasPrice(gasPrice,block.baseFeePerGas);
  const requirements=new Map<string,{wallet:Wallet;native:bigint;payment:bigint}>();
  function add(wallet:Wallet,native:bigint,pay:bigint){const existing=requirements.get(wallet.address)??{wallet,native:0n,payment:0n};existing.native+=native;existing.payment+=pay;requirements.set(wallet.address,existing);}
  add(creator,BigInt(config.gas.create)*gasPrice,0n);
  for(const [i,wallet] of buyers.entries()){const amount=amountRaw(config.buyers[i].amount,payment.decimals);add(wallet,(BigInt(config.gas.buy)+(payment.kind===1?BigInt(config.gas.approve):0n))*gasPrice+(payment.kind===0?amount:0n),payment.kind===1?amount:0n);}
  await Promise.all([...requirements.values()].map(async({wallet,native,payment:needed})=>{
    const [balance,latest,pending]=await Promise.all([provider.getBalance(wallet.address),provider.getTransactionCount(wallet.address,'latest'),provider.getTransactionCount(wallet.address,'pending')]);
    if(latest!==pending)throw new LaunchError(`钱包 ${wallet.address} 有待处理交易，请先处理`);
    if(balance<native)throw new LaunchError(`钱包 ${wallet.address} 的原生余额不足以覆盖配置的 gas 上限`);
    if(needed>0n){const [balance]=await read(rpc,payment.token,tokenInterface,'balanceOf',[wallet.address]);if(balance<needed)throw new LaunchError(`钱包 ${wallet.address} 的 ${payment.symbol} 余额不足`);}
  }));
  return {rpc,creator,buyers,payment,gasPrice};
}
