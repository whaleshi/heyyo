export function activity(message:string) {
  console.log(`[${new Date().toLocaleString('sv-SE',{hour12:false})}] ${message}`);
}
export async function withActivity<T>(message:string,work:()=>Promise<T>,log=activity,intervalMs=10000):Promise<T> {
  log(message);
  const started=Date.now();
  const timer=setInterval(()=>log(`${message}（仍在等待，已用时 ${Math.floor((Date.now()-started)/1000)} 秒）`),intervalMs);
  try{return await work();}finally{clearInterval(timer);}
}
