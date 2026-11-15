window.createStickerMovie = async function(canvas, ASSETS, spec) {
const c=canvas.getContext("2d");
const W=1080,H=1440,D=24,TAU=Math.PI*2;
const ink='#69473c',orange='#d76e49',pink='#ec9e9a',cream='#fff9ee';
const scenes=[
 {at:0,end:3.6,name:'累瘫了',bg:'#faf1e7',tag:'今日心情 / LOW BATTERY',a:'今天，',b:'电量有点低。',small:'什么都不想做，只想趴一会儿。',level:3},
 {at:3.6,end:6.6,name:'陪陪我',bg:'#fff2dd',tag:'叮！你收到一份邀请',a:'那就，',b:'陪陪我嘛。',small:'不用说什么，在我身边就好。',level:20},
 {at:6.6,end:10.2,name:'摸摸头',bg:'#edf3e9',tag:'烦恼撤退中 / PAT PAT',a:'摸摸头，',b:'烦恼退退。',small:'被温柔接住的感觉，真好。',level:45},
 {at:10.2,end:13.8,name:'牵牵手',bg:'#f3edf7',tag:'正在连接你的好心情',a:'手给你，',b:'一起走呀。',small:'今天的快乐，我们一人一半。',level:70},
 {at:13.8,end:17.4,name:'贴贴',bg:'#ffede6',tag:'距离再近一点 / STAY CLOSE',a:'再靠近，',b:'一点点。',small:'贴贴，是轻喵的充电方式。',level:90},
 {at:17.4,end:20.4,name:'心动',bg:'#fce9e9',tag:'好心情，已充满！',a:'好啦，',b:'又心动了。',small:'原来我的快乐开关，是你。',level:100},
 {at:20.4,end:24,name:'心动',bg:'#fff5e7',tag:'轻喵 · 亲昵互动篇',a:'把喜欢，',b:'发给你。',small:'轻喵第2弹 · 24枚动态表情',level:100}
];
const imgs={};
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n)),ease=n=>1-Math.pow(1-clamp(n),3),smooth=n=>{n=clamp(n);return n*n*(3-2*n)};
function text(s,x,y,size=48,color=ink,weight=500,align='center'){
 c.fillStyle=color;c.font=`${weight} ${size}px "Microsoft YaHei","PingFang SC",sans-serif`;const width=c.measureText(s).width;if(width>940)c.font=`${weight} ${size*940/width}px "Microsoft YaHei","PingFang SC",sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillText(s,x,y);
}
function rr(x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=3;c.stroke()}}
function heart(x,y,s,color,rot=0,alpha=1){c.save();c.globalAlpha*=alpha;c.translate(x,y);c.rotate(rot);c.scale(s/100,s/100);c.beginPath();c.moveTo(0,32);c.bezierCurveTo(-105,-20,-60,-95,0,-43);c.bezierCurveTo(60,-95,105,-20,0,32);c.fillStyle=color;c.fill();c.restore()}
function flower(x,y,size,rot=0,alpha=1){c.save();c.translate(x,y);c.rotate(rot);c.globalAlpha*=alpha;for(let k=0;k<5;k++){c.rotate(TAU/5);c.beginPath();c.ellipse(0,-size*.47,size*.24,size*.43,0,0,TAU);c.fillStyle='#fffdf4';c.fill()}c.beginPath();c.arc(0,0,size*.21,0,TAU);c.fillStyle='#e8b464';c.fill();c.restore()}
function sparkle(x,y,r,color=orange){c.save();c.translate(x,y);c.fillStyle=color;c.beginPath();c.moveTo(0,-r);c.quadraticCurveTo(r*.12,-r*.12,r,0);c.quadraticCurveTo(r*.12,r*.12,0,r);c.quadraticCurveTo(-r*.12,r*.12,-r,0);c.quadraticCurveTo(-r*.12,-r*.12,0,-r);c.fill();c.restore()}
function sticker(name,t,x,y,size,rotation=0,alpha=1){
 const a=ASSETS[name],img=imgs[name];if(!img)return;
 let total=a.durations.reduce((x,y)=>x+y,0),ms=((t*1000)%total+total)%total,k=0;
 while(k<9&&ms>=a.durations[k]){ms-=a.durations[k];k++}
 c.save();c.globalAlpha*=alpha;c.translate(x,y);c.rotate(rotation);c.drawImage(img,(k%5)*a.size,Math.floor(k/5)*a.size,a.size,a.size,-size/2,-size/2,size,size);c.restore();
}
function battery(level,t){
 rr(841,76,128,51,14,null,ink);rr(972,91,9,21,3,ink);rr(850,85,109*level/100,33,6,level<10?'#d68f7b':'#a8bfa2');
 text(level+'%',905,162,27,ink,500);
}
function path(t,idx){
 c.save();c.strokeStyle=idx<2?'#dabfaf':'#deaaa0';c.lineWidth=5;c.lineCap='round';c.setLineDash([2,15]);c.lineDashOffset=-t*17;
 c.beginPath();c.moveTo(-60,1130);c.bezierCurveTo(140,1070,160,1240,430,1160);c.bezierCurveTo(760,1070,900,1260,1130,1100);c.stroke();c.restore();
}
function particles(t,idx){for(let j=0;j<10;j++){
 const k=j*2.399,xx=540+Math.cos(k)*(370+(j%3)*28),yy=850+Math.sin(k)*(260+(j%2)*65)+Math.sin(t*1.3+j)*13;
 if(j%3===0)flower(xx,yy,23+(j%2)*7,t*.1+j,.75);else if(j%3===1)heart(xx,yy,18+j*.9,pink,Math.sin(t+j)*.3,.65);else sparkle(xx,yy,10+Math.sin(t*2+j)*3,'#d9af79');
}}
function scene(idx,t){
 const s=scenes[idx],u=t-s.at; c.fillStyle=s.bg;c.fillRect(0,0,W,H);
 // Quiet printed-paper texture and large translucent circles.
 c.fillStyle='rgba(255,255,255,.38)';c.beginPath();c.arc(1050,780,540,0,TAU);c.fill();
 c.fillStyle='rgba(226,181,148,.08)';for(let x=30;x<W;x+=42)for(let y=30;y<H;y+=42){c.beginPath();c.arc(x,y,1.35,0,TAU);c.fill()}
 text('轻喵',80,104,38,ink,700,'left');text('VOL. 02',80,152,23,orange,500,'left');
 const previous=idx?scenes[idx-1].level:s.level;battery(Math.round(previous+(s.level-previous)*smooth((u-.4)/2)),t);
 c.save();c.globalAlpha=clamp(u/.3);text(s.tag,540,254,27,orange,500);c.restore();
 if(idx<6){
  // Two-step kinetic typesetting, with a spring settling into its baseline.
  let p=ease(u/.55),q=ease((u-.14)/.6);
  c.save();c.globalAlpha=p;text(s.a,540,365+(1-p)*68,91,ink,700);c.globalAlpha=q;text(s.b,540,484+(1-q)*70,91,ink,700);c.restore();
  path(t,idx);particles(t,idx);
  // Anchored soft shadow: the character remains grounded during its action.
  c.save();c.globalAlpha=.08;c.fillStyle=ink;c.beginPath();c.ellipse(540,1220,220,18,0,0,TAU);c.fill();c.restore();
  const intro=ease(u/.55),breath=idx===0?0:Math.sin(u*TAU/3.2)*5;
  const scale=1+.04*Math.exp(-u*5)*Math.sin(u*15),sz=730*scale;
  sticker(s.name,u,540+(1-intro)*80,899+(1-intro)*80+breath,sz,idx===1?Math.sin(u*3)*.012:0,intro);
  // Action punctuation is timed to the original sticker animation.
  if(idx===0)text('…',798,713,78,'#b89d8e');
  if(idx===1){const z=ease((u-.5)/.35);c.save();c.translate(250,657);c.rotate(-.10);c.scale(z,z);rr(-108,-37,216,74,37,'#fffaf0');text('在吗？',0,0,36,orange,700);c.restore()}
  if(idx===2){for(let j=0;j<3;j++){let a=(u*1.3+j*.27)%1;heart(343+j*190,640-a*110,22+15*a,'#dba996',-.25+j*.25,Math.sin(a*Math.PI)*.8)}}
  if(idx===4||idx===5){for(let j=0;j<7;j++){let a=(u*.45+j/7)%1,ang=j*2.39;heart(540+Math.cos(ang)*(240+a*240),860+Math.sin(ang)*(180+a*200),18+25*a,pink,ang*.08,Math.sin(a*Math.PI)*.5)}}
  text(s.small,540,1302,34,ink);text('轻喵第2弹 · 亲昵互动篇',540,1384,23,'#a17d6a');
 }else{
  let p=ease(u/.65);c.save();c.globalAlpha=p;text(s.a,540,350+(1-p)*60,105,ink,700);text(s.b,540,482+(1-p)*60,105,orange,700);c.restore();
  // Hero plus four smaller gestures make the final album composition.
  const positions=[[scenes[2].name,196,748,315,-.16],[scenes[1].name,884,748,315,.16],[scenes[3].name,200,1074,300,-.11],[scenes[4].name,880,1074,300,.11]];
  positions.forEach((a,j)=>{let v=ease((u-.20-j*.07)/.5);sticker(a[0],u+j*.31,a[1]+(a[1]<540?-90:90)*(1-v),a[2]+Math.sin(u*2+j)*8,a[3]*v,a[4],v)});
  c.save();c.globalAlpha=.08;c.fillStyle=ink;c.beginPath();c.ellipse(540,1118,210,18,0,0,TAU);c.fill();c.restore();
  sticker(scenes[5].name,u,540,895,590,Math.sin(u*2)*.012,p);
  for(let j=0;j<8;j++){let a=(u*.45+j/8)%1;heart(180+j*106,1080-a*430,18+18*a,pink,Math.sin(j)*.25,Math.sin(a*Math.PI)*.75)}
  text(spec.title,540,1205,54,ink,700);text(spec.mode ? '24枚'+(spec.mode==='static'?'静态':'动态')+'表情 · '+spec.packName : '24枚动态表情 · 亲昵互动篇',540,1280,31,ink);text('视频由轻喵小程序制作。',540,1380,25,'#9a7665');
 }
}
function render(t,ui=true){
 t=clamp(t,0,D);let idx=scenes.findIndex(s=>t<s.end);if(idx<0)idx=6;scene(idx,t);
 if(idx>0&&t-scenes[idx].at<.5){
  let u=(t-scenes[idx].at)/.5; // Expanding organic wipe reveals the next mood.
  const img=c.getImageData(0,0,W,H);scene(idx-1,t);c.save();c.beginPath();c.arc(540,870,1800*ease(u),0,TAU);c.clip();
  const scratch=document.createElement('canvas');scratch.width=W;scratch.height=H;scratch.getContext('2d').putImageData(img,0,0);c.drawImage(scratch,0,0);c.restore();
 }

}

if(spec.mode){scenes[6].tag=spec.packName;scenes[6].small='24枚'+(spec.mode==='static'?'静态':'动态')+'表情';}
scenes.slice(0,6).forEach((s,i)=>{
 s.name=spec.sceneIds[i];
 if(spec.mode || s.name!==['24','09','03','12','01','20'][i]){s.small=ASSETS[s.name].action;s.tag=(spec.mode?spec.packName:'轻喵')+' · '+ASSETS[s.name].name;}
 const line=spec.captions[i],comma=line.search(/[，,、]/),split=comma>=0&&comma<9?comma+1:Math.min(9,line.length);
 s.a=line.slice(0,split);s.b=line.slice(split);
});
await Promise.all(Object.entries(ASSETS).map(([key,a])=>new Promise((resolve,reject)=>{
 const image=new Image();image.onload=()=>{imgs[key]=image;resolve()};image.onerror=()=>reject(Error('表情素材无法解码：'+key));image.src=a.src;
})));
return {render:t=>render(t,false),scenes};
};
