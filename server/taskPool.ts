// Drain every active worker before propagating failure: no provider calls are
// left mutating caches after the owning task is marked failed or retried.
export async function mapLimited<T,R>(items:T[],limit:number,run:(item:T,index:number)=>Promise<R>):Promise<R[]> {
  const result:R[]=[];let next=0;let failed=false;let error:unknown;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!failed&&next<items.length){const index=next++;try{result[index]=await run(items[index],index);}catch(e){failed=true;error=e;}}
  }));
  if(failed)throw error;return result;
}
