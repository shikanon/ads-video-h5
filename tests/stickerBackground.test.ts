import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { removeStickerBackdrop, stickerBackground, stickerReservedKeys, stickerMotionReference, validateStickerMotion } from '../server/stickerBackground';
const green={name:'绿色',hex:'#00FF00',channels:[1]};
function image(color:number[]){const p=new PNG({width:128,height:128});for(let i=0;i<p.data.length;i+=4){p.data[i]=color[0];p.data[i+1]=color[1];p.data[i+2]=color[2];p.data[i+3]=255;}return p;}
function rect(p:PNG,x:number,y:number,w:number,h:number,c:number[]){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*p.width+xx)*4;for(let k=0;k<4;k++)p.data[i+k]=c[k];}}
test('opaque references use an explicit non-colliding backdrop; real alpha stays in transparent mode',async()=>{
  const p=image([160,80,40]),bytes=PNG.sync.write(p),plan=await stickerBackground({bytes,mimeType:'image/png'});assert.equal(plan.background,'opaque');assert.equal(plan.key?.hex,'#00FF00');assert.deepEqual(plan.reference.bytes,bytes);
  const grass=image([0,230,0]),other=await stickerBackground({bytes:PNG.sync.write(grass),mimeType:'image/png'});assert.equal(other.key?.hex,'#FF00FF');
  const pinkProp=await stickerBackground({bytes:PNG.sync.write(grass),mimeType:'image/png'},false,['#FF00FF']);assert.equal(pinkProp.key?.hex,'#00FFFF','reserve the pink family for new hearts and cushions');
  const transparent=image([160,80,40]);rect(transparent,0,0,128,16,[0,0,0,0]);const original=PNG.sync.write(transparent),alpha=await stickerBackground({bytes:original,mimeType:'image/png'});assert.equal(alpha.background,'transparent');assert.equal(alpha.key,undefined);assert.deepEqual(alpha.reference.bytes,original);
});
test('matting removes outer canvas and enclosed limb gaps, preserves subject colors and refuses an unspecified background',()=>{
  const p=image([0,255,0]);rect(p,24,16,80,96,[180,90,55,255]);rect(p,48,42,24,30,[0,255,0,255]);
  const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(p),green));assert.equal(result.data[3],0);assert.equal(result.data[(55*128+55)*4+3],0,'closed spaces between limbs must be transparent');assert.deepEqual([...result.data.subarray((30*128+30)*4,(30*128+30)*4+4)],[180,90,55,255]);assert.deepEqual([...result.data.subarray(0,4)],[0,0,0,0]);
  assert.throws(()=>removeStickerBackdrop(PNG.sync.write(image([200,200,200])),green),/未通过抠图/);assert.throws(()=>removeStickerBackdrop(PNG.sync.write(image([0,255,0])),green),/未通过抠图/);
});
test('a green character selects a magenta background and keeps its green clothing after matting',async()=>{
  const role=image([0,220,0]),plan=await stickerBackground({bytes:PNG.sync.write(role),mimeType:'image/png'});assert.equal(plan.key?.hex,'#FF00FF');
  const generated=image([255,0,255]);rect(generated,25,25,75,85,[0,220,0,255]);const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),plan.key!));assert.deepEqual([...result.data.subarray((60*128+60)*4,(60*128+60)*4+4)],[0,220,0,255]);
});

test('a tiny observed green ornament reserves green even when full-photo pixel ranking misses it',async()=>{
  const photo=image([160,80,40]);rect(photo,60,45,2,2,[0,220,0,255]);const keys=stickerReservedKeys('黑色上衣胸口有一枚绿色装饰，粉色抱枕为新增道具');
  const plan=await stickerBackground({bytes:PNG.sync.write(photo),mimeType:'image/png'},true,keys);assert.equal(plan.key?.hex,'#00FFFF');
  const rendered=image([0,255,255]);rect(rendered,24,20,80,90,[160,80,40,255]);rect(rendered,60,45,6,6,[0,220,0,255]);const output=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(rendered),plan.key!));assert.deepEqual([...output.data.subarray((47*128+62)*4,(47*128+62)*4+4)],[0,220,0,255]);
});

test('dark cyan key spill at a black hair edge is removed while an interior green ornament stays opaque',()=>{
  const cyan={name:'青色',hex:'#00FFFF',channels:[1,2]},generated=image([0,255,255]);rect(generated,24,20,80,90,[16,16,16,255]);rect(generated,24,25,2,70,[15,45,45,255]);rect(generated,60,45,6,6,[0,220,0,255]);
  const p=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),cyan)),edge=(40*128+24)*4;assert.ok(Math.abs(p.data[edge]-p.data[edge+1])<2);assert.ok(Math.abs(p.data[edge]-p.data[edge+2])<2);assert.deepEqual([...p.data.subarray((47*128+62)*4,(47*128+62)*4+4)],[0,220,0,255]);
});

test('matting a magenta canvas preserves a pastel pink pillow instead of punching transparent holes',()=>{
 const magenta={name:'洋红色',hex:'#FF00FF',channels:[0,2]},generated=image([255,0,255]);rect(generated,25,20,75,90,[255,140,205,255]);rect(generated,40,40,40,35,[240,105,175,255]);
 const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),magenta));assert.equal(result.data[3],0);
 for(const [x,y] of [[50,50],[70,60],[60,90]]){const p=(y*128+x)*4;assert.equal(result.data[p+3],255);assert.deepEqual([...result.data.subarray(p,p+3)],[...generated.data.subarray(p,p+3)]);}
});

test('matting removes isolated backdrop flecks but retains meaningful separate heart decorations',()=>{
 const magenta={name:'洋红色',hex:'#FF00FF',channels:[0,2]},generated=image([255,0,255]);rect(generated,25,20,75,90,[255,140,205,255]);rect(generated,6,6,1,1,[170,30,70,255]);rect(generated,108,20,10,10,[240,130,160,255]);
 const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),magenta));assert.equal(result.data[(6*128+6)*4+3],0);assert.equal(result.data[(25*128+112)*4+3],255);
});

test('connected dark-magenta floor residue is removed without deleting a pastel cushion',()=>{
 const magenta={name:'洋红色',hex:'#FF00FF',channels:[0,2]},generated=image([255,0,255]);rect(generated,25,20,75,80,[255,140,205,255]);rect(generated,20,100,85,8,[255,25,125,255]);
 const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),magenta));assert.equal(result.data[(104*128+60)*4+3],0);assert.equal(result.data[(60*128+60)*4+3],255);
});

test('dark studio key enclosed between feet is cleared with the outside canvas',()=>{
 const magenta={name:'洋红色',hex:'#FF00FF',channels:[0,2]},generated=image([255,0,255]);rect(generated,25,20,75,90,[255,140,205,255]);rect(generated,50,80,10,15,[255,25,125,255]);
 const result=PNG.sync.read(removeStickerBackdrop(PNG.sync.write(generated),magenta));assert.equal(result.data[(88*128+54)*4+3],0);assert.equal(result.data[(50*128+50)*4+3],255);
});

test('animation reference pins six complete characters to separate transparent cells',()=>{
  const identity=new PNG({width:512,height:512});rect(identity,190,60,130,390,[180,90,55,255]);const sheet=PNG.sync.read(stickerMotionReference(PNG.sync.write(identity)));assert.equal(sheet.width,2496);assert.equal(sheet.height,1664);
  for(let n=0;n<6;n++){assert.equal(sheet.data[((Math.floor(n/3)*832+220)*2496+n%3*832+350)*4+3],255);assert.equal(sheet.data[((Math.floor(n/3)*832)*2496+n%3*832)*4+3],0);}
  assert.throws(()=>stickerMotionReference(PNG.sync.write(image([180,90,55]))),/参考检查/);
});

test('animation validation rejects identical poses with tiny rendering noise, but accepts changed limbs',()=>{
  const pose=new PNG({width:128,height:128});rect(pose,30,25,65,80,[180,90,55,255]);const first=PNG.sync.write(pose),noise=PNG.sync.read(first);noise.data[(40*128+40)*4]++;assert.throws(()=>validateStickerMotion([first,PNG.sync.write(noise)]),/动作变化过小/);
  const moving=PNG.sync.read(first);rect(moving,95,25,12,40,[180,90,55,255]);validateStickerMotion([first,PNG.sync.write(moving)]);
  const face=PNG.sync.read(first);rect(face,50,38,12,12,[20,10,5,255]);validateStickerMotion([first,PNG.sync.write(face)]);
});
