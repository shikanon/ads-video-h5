// Dedicated blank space in the header; keep all other content outside it.
const WATERMARK=Object.freeze({text:'轻喵小程序制作',x:760,y:24,width:400,height:56,fontSize:24});
function drawWatermark(){
 g.save();g.globalAlpha=.78;g.font=`500 ${WATERMARK.fontSize}px "Microsoft YaHei",sans-serif`;
 if(g.measureText(WATERMARK.text).width>WATERMARK.width-32)throw Error('Watermark exceeds reserved space');
 text(WATERMARK.text,WATERMARK.x+WATERMARK.width/2,61,WATERMARK.fontSize,M,'center',500);g.restore();
}
function renderFrame(time){
 time=Math.max(0,Math.min(total-.001,time));let i=TIMING.items.findIndex(q=>time>=q.start&&time<q.start+q.duration+.24);if(i<0)i=TIMING.items.length-1;
 const q=TIMING.items[i],local=time-q.start,p=Math.max(0,Math.min(1,local/q.duration));
 g.fillStyle=BG;g.fillRect(0,0,1920,1080);circle(1870,430,330,'#F4E7F7');circle(40,860,220,'#FAE8EF');
 text(DATA.brand,100,65,28,P);text('AI实用课 / '+DATA.edition,1818,65,26,M,'right');rr(100,90,1720,4,2,L);rr(100,90,1720*time/total,4,2,R);
 let a=ease(local/.35);g.save();g.globalAlpha=a;text(DATA.scenes[i].title,100+(1-a)*30,196,66,P);g.restore();text(`${i+1} / ${TIMING.items.length}`,1818,195,27,M,'right');
 draw_scene(i,p,time);
 text(DATA.notice,100,874,24,M);text(DATA.source_short,1818,874,24,M,'right');
 rr(80,908,1760,96,24,'white');const parts=q.text.match(/[^，。；：！？]+[，。；：！？]?/g)||[q.text];let offset=0,phrase=parts.at(-1);const spoken=q.words.filter(w=>time>=w.start&&time<w.end).at(-1)||[...q.words].reverse().find(w=>time>=w.start);let ci=spoken?spoken.charStart:0;for(const part of parts){if(ci<offset+part.length){phrase=part;break}offset+=part.length}fit(phrase,960,969,1680,46,P,'center');
 text(DATA.footer_left,100,1040,23,M);text(DATA.footer_right,1818,1040,23,R,'right');
 drawWatermark();
}
