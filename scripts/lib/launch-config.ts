import { Wallet, parseUnits } from 'ethers';
import { chainId } from '../../shared/contracts.ts';
export class LaunchError extends Error {}
export type KeyConfig = {privateKey?:string;privateKeyEnv?:string};
export type LaunchConfig = {
  runId:string;rpcUrl:string;chainId:number;uploadApiUrl:string;templateId:string;dexConfigId:string;paymentTokenConfigId:string;
  creator:KeyConfig;token:{name:string;symbol:string;description:string;imagePath?:string;imageURI?:string;metadataURI?:string;website:string;x:string;telegram:string};
  timeoutSeconds:number;gas:{create:string;approve:string;buy:string;gasPriceGwei:string};buyers:(KeyConfig & {label:string;amount:string})[];
};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function key(v:unknown):KeyConfig {
  if(!object(v)) throw new LaunchError('钱包配置缺失');
  const privateKey=typeof v.privateKey==='string'?v.privateKey.trim():undefined;
  const privateKeyEnv=typeof v.privateKeyEnv==='string'?v.privateKeyEnv.trim():undefined;
  if(Boolean(privateKey)===Boolean(privateKeyEnv)) throw new LaunchError('每个钱包填写 privateKey 或 privateKeyEnv 中的一项');
  if(privateKey && !/^(0x)?[a-fA-F0-9]{64}$/.test(privateKey)) throw new LaunchError('钱包私钥格式不正确');
  if(privateKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(privateKeyEnv)) throw new LaunchError('私钥环境变量名称不正确');
  return {privateKey,privateKeyEnv};
}
function text(v:unknown,max:number,required=false) {if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim())) throw new LaunchError('创建信息格式不正确');return v.trim();}
function url(v:unknown) {const s=text(v,2048,true);try {if(!['http:','https:'].includes(new URL(s).protocol))throw 0;}catch{throw new LaunchError('RPC 或上传 API 地址不正确');}return s;}
export function positiveAmount(v:unknown):string {if(typeof v!=='string'||!/^\d+(\.\d+)?$/.test(v)||!/[1-9]/.test(v)||v.length>100)throw new LaunchError('金额必须是大于零的十进制字符串');return v;}
export function amountRaw(v:string,decimals:number) {try {const n=parseUnits(v,decimals);if(n<=0n||n>=2n**256n)throw 0;return n;}catch{throw new LaunchError('金额超出范围或小数位超过链上精度');}}
export function parseLaunchConfig(value:unknown):LaunchConfig {
  if(!object(value)||!object(value.token)||!Array.isArray(value.buyers))throw new LaunchError('JSON 配置结构不正确');
  const runId=text(value.runId,64,true);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId))throw new LaunchError('runId 只能包含字母、数字、下划线和连字符');
  if(value.chainId!==chainId)throw new LaunchError(`chainId 必须与当前部署 ${chainId} 一致`);
  const ids=['templateId','dexConfigId','paymentTokenConfigId'].map(n=>{const v=value[n];if(typeof v!=='string'||! /^[1-9]\d{0,76}$/.test(v))throw new LaunchError('模板/DEX/支付配置 ID 必须为正整数字符串');return v;});
  const t=value.token, name=text(t.name,40,true),symbol=text(t.symbol,10,true);
  if(!/^[A-Z0-9]{1,10}$/.test(symbol))throw new LaunchError('symbol 仅支持大写字母和数字');
  const metadataURI=t.metadataURI?text(t.metadataURI,2048,true):undefined;
  const imageURI=t.imageURI?text(t.imageURI,140,true):undefined;
  const imagePath=t.imagePath?text(t.imagePath,4096,true):undefined;
  if(metadataURI&&!/^(ipfs:\/\/[a-zA-Z0-9]{20,120}|https:\/\/[^\s]+)$/.test(metadataURI))throw new LaunchError('metadataURI 必须是 IPFS 或 HTTPS 地址');
  if(!metadataURI && Boolean(imageURI)===Boolean(imagePath))throw new LaunchError('填写 imagePath 或 imageURI 中的一项');
  if(imageURI&&!/^ipfs:\/\/[a-zA-Z0-9]{20,120}$/.test(imageURI))throw new LaunchError('imageURI 必须是 IPFS 图片地址');
  const links=Object.fromEntries(['website','x','telegram'].map(n=>{const v=text(t[n]??'',300);if(v){let u;try{u=new URL(v);}catch{throw new LaunchError('社交链接格式不正确');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new LaunchError('社交链接格式不正确');}return[n,v];})) as {website:string;x:string;telegram:string};
  const timeoutSeconds=value.timeoutSeconds??180;
  if(value.slippageBps!==undefined)throw new LaunchError('固定 minOut=1，不使用 slippageBps 或买入报价');
  if(!object(value.gas))throw new LaunchError('请填写固定 gas 参数，不调用 gas 预估');
  const gas={create:positiveAmount(value.gas.create),approve:positiveAmount(value.gas.approve),buy:positiveAmount(value.gas.buy),gasPriceGwei:positiveAmount(value.gas.gasPriceGwei)};
  if(![gas.create,gas.approve,gas.buy].every(v=>/^[1-9]\d{0,8}$/.test(v)))throw new LaunchError('gas limit 必须为正整数');
  if(!Number.isInteger(timeoutSeconds)||Number(timeoutSeconds)<30||Number(timeoutSeconds)>3600)throw new LaunchError('timeoutSeconds 范围为 30–3600');
  if(value.buyers.length>100)throw new LaunchError('单次最多支持 100 个买入钱包');
  return {runId,rpcUrl:url(value.rpcUrl),chainId,uploadApiUrl:url(value.uploadApiUrl??'http://127.0.0.1:8787/api'),
    templateId:ids[0],dexConfigId:ids[1],paymentTokenConfigId:ids[2],creator:key(value.creator),
    token:{name,symbol,description:text(t.description??'',280),metadataURI,imageURI,imagePath,...links},gas,timeoutSeconds:Number(timeoutSeconds),
    buyers:value.buyers.map((b,i)=>{if(!object(b))throw new LaunchError('买入钱包配置不正确');return {...key(b),label:text(b.label??`buyer-${i+1}`,64,true),amount:positiveAmount(b.amount)};})};
}
export function walletFromConfig(config:KeyConfig,env:NodeJS.ProcessEnv=process.env) {
  const value=config.privateKey??env[config.privateKeyEnv??''];
  if(!value)throw new LaunchError('钱包私钥环境变量未设置');
  try{return new Wallet(value.startsWith('0x')?value:`0x${value}`);}catch{throw new LaunchError('钱包私钥无效');}
}
export function uniqueBuyers(addresses:string[]) {if(new Set(addresses.map(a=>a.toLowerCase())).size!==addresses.length)throw new LaunchError('买入钱包地址不能重复，避免 nonce 冲突');}
export function safeError(error:unknown) {if(error instanceof LaunchError)return error.message;const code=object(error)&&typeof error.code==='string'&&/^[A-Z_]{1,40}$/.test(error.code)?error.code:'FAILED';return `操作失败 (${code})，请根据已记录的交易哈希检查链上结果`;}
