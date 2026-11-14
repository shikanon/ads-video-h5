from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text('utf-8')
body = source[source.index('const W='):source.index('function killAudio')]
body = body.replace('let imgs={},loaded=false,time=0,playing=false,last=0,muted=true,audio=null,audioStart=0,sources=[];', 'const imgs={};')
body = body.replace("const positions=[['摸摸头',196,748,315,-.16],['陪陪我',884,748,315,.16],['牵牵手',200,1074,300,-.11],['贴贴',880,1074,300,.11]];", 'const positions=[[scenes[2].name,196,748,315,-.16],[scenes[1].name,884,748,315,.16],[scenes[3].name,200,1074,300,-.11],[scenes[4].name,880,1074,300,.11]];')
body = body.replace("sticker('心动',u,540,895", 'sticker(scenes[5].name,u,540,895')
body = body.replace("text('轻喵 第2弹',540,1205,54", 'text(spec.title,540,1205,54')
body = body.replace(" if(ui){range.value=t;clock.textContent='00:'+String(Math.floor(t)).padStart(2,'0')+' / 00:24'}", '')
prefix = 'window.createStickerMovie = async function(canvas, ASSETS, spec) {\nconst c=canvas.getContext("2d");\n'
suffix = '''
scenes.slice(0,6).forEach((s,i)=>{
 s.name=spec.sceneIds[i];
 if(s.name!==['24','09','03','12','01','20'][i]){s.small=ASSETS[s.name].action;s.tag='轻喵 · '+ASSETS[s.name].name;}
 const line=spec.captions[i],comma=line.search(/[，,、]/),split=comma>=0&&comma<9?comma+1:Math.min(9,line.length);
 s.a=line.slice(0,split);s.b=line.slice(split);
});
await Promise.all(Object.entries(ASSETS).map(([key,a])=>new Promise((resolve,reject)=>{
 const image=new Image();image.onload=()=>{imgs[key]=image;resolve()};image.onerror=()=>reject(Error('表情素材无法解码：'+key));image.src=a.src;
})));
return {render:t=>render(t,false),scenes};
};
'''
target = Path(__file__).resolve().parents[1] / 'skills/qingmao-stickers/renderer.js'
body = body.replace('c.textAlign=align;c.textBaseline=', 'const measured=c.measureText(s).width;if(measured>940)c.font=`${weight} ${size*940/measured}px "Microsoft YaHei","PingFang SC",sans-serif`;c.textAlign=align;c.textBaseline=')
target.write_text(prefix + body + suffix, 'utf-8')
print(target)
