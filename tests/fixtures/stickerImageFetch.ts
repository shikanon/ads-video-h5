// Test process only, explicitly loaded by the disposable HTTP fixture.
const original=globalThis.fetch;
globalThis.fetch=((input:any,init:any)=>{
  if(String(input)==='https://ark.cn-beijing.volces.com/api/v3/images/generations')return original(process.env.QINGJIAN_STICKER_IMAGE_FIXTURE_URL!,init);
  return original(input,init);
}) as typeof fetch;
