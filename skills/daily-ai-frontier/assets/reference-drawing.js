const BG='#FDF7FB',P='#6B21A8',R='#C2185B',M='#79707F',L='#E8D9E8',INK='#302038';
const ease=x=>1-(1-Math.max(0,Math.min(1,x)))**3;
function rr(x,y,w,h,r,fill,stroke){g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill()}if(stroke){g.strokeStyle=stroke;g.lineWidth=2;g.stroke()}}
function text(s,x,y,size=32,col=INK,align='left',weight=600){g.font=`${weight} ${size}px "Microsoft YaHei",sans-serif`;g.textAlign=align;g.fillStyle=col;g.fillText(s,x,y)}
function fit(s,x,y,w,size=32,col=INK,align='left'){g.font=`600 ${size}px "Microsoft YaHei",sans-serif`;if(g.measureText(s).width>w)throw Error('Text overflow: '+s);text(s,x,y,size,col,align)}
function line(pts,col=L,width=5){g.beginPath();g.lineWidth=width;g.strokeStyle=col;g.lineCap='round';g.lineJoin='round';pts.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke()}
function circle(x,y,r,col){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fillStyle=col;g.fill()}
function arrow(x,y,xx,yy,col=P){line([[x,y],[xx,yy]],col,5);let a=Math.atan2(yy-y,xx-x);line([[xx-18*Math.cos(a-.6),yy-18*Math.sin(a-.6)],[xx,yy],[xx-18*Math.cos(a+.6),yy-18*Math.sin(a+.6)]],col,5)}
function doc(x,y,s=1,col=P){g.save();g.translate(x,y);g.scale(s,s);rr(-70,-85,140,170,14,'white',col);for(let k=0;k<4;k++)line([[-42,-45+k*28],[k===3?10:42,-45+k*28]],L,6);g.restore()}
function tick(x,y,col=P){line([[x-15,y],[x,y+14],[x+28,y-20]],col,7)}
function lens(x,y){circle(x,y,76,'#FDF7FBBB');g.beginPath();g.arc(x,y,76,0,Math.PI*2);g.strokeStyle=R;g.lineWidth=9;g.stroke();line([[x+55,y+55],[x+115,y+115]],R,14)}
