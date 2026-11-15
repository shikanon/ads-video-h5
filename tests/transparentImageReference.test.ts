import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { PNG } from 'pngjs';
import { generateImage, ProviderError } from '../server/providers';
import { runWithJobSignal, JobCancelledError } from '../server/jobExecution';
import type { ModelConfig } from '../server/modelRegistry';

const config:ModelConfig={id:'image-fixture',kind:'image',enabled:true,provider:'ark',name:'Fixture',modelId:'doubao-seedream-5-0-flash-260915',apiKey:'local-fixture-key',baseUrl:'https://ark.cn-beijing.volces.com'};
function png(){const image=new PNG({width:40,height:32});for(let i=0;i<image.data.length;i+=4){image.data[i]=110;image.data[i+1]=70;image.data[i+2]=30;image.data[i+3]=i<320?0:255;}return PNG.sync.write(image);}
function encode(format:'mjpeg'|'libwebp',bytes:Buffer){const r=spawnSync(ffmpeg!,['-v','error','-i','pipe:0','-frames:v','1','-threads','1','-c:v',format,'-f','image2pipe','pipe:1'],{input:bytes,maxBuffer:5*1024*1024,windowsHide:true});assert.equal(r.status,0,r.stderr.toString());return r.stdout;}

test('transparent image requests normalize JPEG, WebP and RGB PNG into real RGBA PNG without changing stored input',async()=>{
  const originalFetch=globalThis.fetch,output=png(),requests:any[]=[];
  globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({data:[{b64_json:output.toString('base64')}]}));};
  try{
    const rgb=PNG.sync.write(PNG.sync.read(output),{colorType:2});
    for(const [bytes,mimeType] of [[encode('mjpeg',output),'image/jpeg'],[encode('libwebp',output),'image/webp'],[rgb,'image/png']] as const){
      const before=Buffer.from(bytes);await generateImage('保留角色，绘制透明贴贴表情',config,{bytes,mimeType},{background:'transparent'});
      const body=requests.at(-1),actual=Buffer.from(body.image.split(',')[1],'base64');assert.ok(body.image.startsWith('data:image/png;base64,'));assert.equal(body.output_format,'png');assert.equal(actual[25],6);
      const decoded=PNG.sync.read(actual,{checkCRC:true});assert.equal(decoded.width,40);assert.equal(decoded.height,32);assert.deepEqual(bytes,before);
      if(mimeType==='image/webp')assert.ok(decoded.data.some((v,i)=>i%4===3&&v===0),'existing transparency must survive');
    }
    await generateImage('保留角色',config,{bytes:output,mimeType:'image/png'},{background:'transparent'});
    assert.deepEqual(Buffer.from(requests.at(-1).image.split(',')[1],'base64'),output,'existing RGBA PNG is preserved byte for byte');
    const jpeg=encode('mjpeg',output);await generateImage('普通不透明图片',config,{bytes:jpeg,mimeType:'image/jpeg'});
    assert.equal(requests.at(-1).output_format,'jpeg');assert.equal(requests.at(-1).image,'data:image/jpeg;base64,'+jpeg.toString('base64'));
  }finally{globalThis.fetch=originalFetch;}
});

test('corrupt, oversized, incompatible or cancelled transparent input fails before any paid provider request',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>assert.fail('invalid or cancelled image must not reach the provider');
  try{
    const ref={bytes:png(),mimeType:'image/png'};
    await assert.rejects(()=>generateImage('透明背景',config,ref,{background:'transparent',outputFormat:'jpeg'}),error=>error instanceof ProviderError&&error.code==='INVALID_INPUT');
    const corrupt=Buffer.alloc(128);corrupt[0]=0xff;corrupt[1]=0xd8;corrupt[2]=0xff;
    await assert.rejects(()=>generateImage('透明背景',config,{bytes:corrupt,mimeType:'image/jpeg'},{background:'transparent'}),/无法解码/);
    const huge=Buffer.from(ref.bytes);huge.writeUInt32BE(16777217,16);
    await assert.rejects(()=>generateImage('透明背景',config,{...ref,bytes:huge},{background:'transparent'}),/总像素/);
    const crc=Buffer.from(ref.bytes);crc[crc.length-1]^=255;
    await assert.rejects(()=>generateImage('透明背景',config,{...ref,bytes:crc},{background:'transparent'}),/无法解码/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(()=>runWithJobSignal(controller.signal,()=>generateImage('透明背景',config,ref,{background:'transparent'})),JobCancelledError);
    const during=new AbortController();const pending=runWithJobSignal(during.signal,()=>generateImage('透明背景',config,{bytes:encode('mjpeg',ref.bytes),mimeType:'image/jpeg'},{background:'transparent'}));during.abort();await assert.rejects(pending,JobCancelledError);
  }finally{globalThis.fetch=originalFetch;}
});
