const {nodeLayout}=require('./tool-workbench');
const {loadThumbnails}=require('./thumbnails');
const limit=v=>Math.max(-1e9,Math.min(1e9,v));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const touch=t=>({x:Number(t.clientX===undefined?t.pageX:t.clientX)||0,y:Number(t.clientY===undefined?t.pageY:t.clientY)||0});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const center=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
function worldPoint(camera,p){return {x:camera.x+p.x/camera.zoom,y:camera.y+p.y/camera.zoom};}
function screenPoint(camera,p){return {x:(p.x-camera.x)*camera.zoom,y:(p.y-camera.y)*camera.zoom};}
function visibleNodes(nodes,camera,width,height){return nodes.filter(n=>{const p=screenPoint(camera,n),s=(n.scale||1)*camera.zoom;return p.x+n.width*s>=-80&&p.y+n.height*s>=-80&&p.x<width+80&&p.y<height+80;}).sort((a,b)=>(a.z||0)-(b.z||0)).slice(-120);}
const methods={
  measureBoard(){if(!wx.createSelectorQuery)return;try{wx.createSelectorQuery().in(this).select('.tw-canvas-wrap').boundingClientRect(r=>{if(!r||!this._visible)return;this._boardRect=r;this.drawBoard();}).exec();}catch{}},
  drawBoard(){
    const app=getApp(),all=this._worldNodes||[],rect=this._boardRect||{width:this._canvasWidth||339,height:Math.max(160,(this._baseHeight||600)-300)};let camera=this.data.camera||{x:0,y:0,zoom:1};
    if(all.length&&(!this._cameraReady||this._cameraAuto&&this._autoFocusCount!==all.length)){const last=all[all.length-1];camera={x:last.x-16,y:last.y-16,zoom:1};this._cameraReady=true;this._cameraAuto=true;this._autoFocusCount=all.length;}
    const old=new Map((this.data.nodes||[]).map(n=>[n.id,n])),visible=visibleNodes(all,camera,rect.width,rect.height).map(n=>{const p=screenPoint(camera,n),previous=old.get(n.id);return Object.assign({},n,{screenX:p.x,screenY:p.y,screenScale:(n.scale||1)*camera.zoom,layer:n.id===this.data.selectedId?1000000001:n.z||1,cover:n.cover||previous&&previous.coverSource===n.coverSource&&previous.cover||app.client.cachedDownload&&app.client.cachedDownload(n.coverSource)||''});});
    const target=screenPoint(camera,this.data.nextPosition||{x:camera.x+32,y:camera.y+40}),grid=Math.max(8,15*camera.zoom);
    this.setData({nodes:visible,nodeCount:all.length,camera,zoom:camera.zoom,zoomPercent:Math.round(camera.zoom*100),zoomLabel:camera.zoom<.01?'<1%':Math.round(camera.zoom*100)+'%',gridStep:grid,gridX:-camera.x*camera.zoom%grid,gridY:-camera.y*camera.zoom%grid,targetX:target.x,targetY:target.y});
    const key=visible.filter(n=>n.coverSource&&!n.cover).map(n=>n.id+':'+n.coverSource).join('|');if(key&&key!==this._canvasThumbKey){this._canvasThumbKey=key;loadThumbnails(this,'nodes',app.client);}
  },
  captureLayout(){const known=new Set(this._layouts.map(n=>n.id));for(const n of this._worldNodes||[])if(!known.has(n.id))this._layouts.push(nodeLayout(n));},
  rememberCamera(){this._cameraReady=true;this._cameraAuto=false;this._dirty=true;this.rememberDraft();this.scheduleSave();},
  localTouch(t){const p=touch(t),r=this._boardRect||{left:51,top:46};return {x:p.x-r.left,y:p.y-r.top};},
  boardStart(event){const ts=event.touches||[];if(!ts.length)return;this._cameraAuto=false;this._dirty=true;const camera=Object.assign({},this.data.camera),a=this.localTouch(ts[0]);this._boardGesture={camera,a,moved:false};if(ts.length>1){const b=this.localTouch(ts[1]),c=center(a,b);Object.assign(this._boardGesture,{distance:distance(a,b),anchor:worldPoint(camera,c)});}},
  boardMove(event){const g=this._boardGesture,ts=event.touches||[];if(!g||!ts.length)return;const a=this.localTouch(ts[0]);let camera;
    if(ts.length>1){const b=this.localTouch(ts[1]),c=center(a,b);if(!g.distance){g.distance=distance(a,b);g.anchor=worldPoint(this.data.camera,c);g.camera=Object.assign({},this.data.camera);}const zoom=clamp(g.camera.zoom*distance(a,b)/Math.max(1,g.distance),1e-7,4);camera={x:limit(g.anchor.x-c.x/zoom),y:limit(g.anchor.y-c.y/zoom),zoom};g.moved=true;}
    else{const dx=a.x-g.a.x,dy=a.y-g.a.y;if(!g.moved&&Math.hypot(dx,dy)<6)return;g.moved=true;camera={x:limit(g.camera.x-dx/g.camera.zoom),y:limit(g.camera.y-dy/g.camera.zoom),zoom:g.camera.zoom};}
    this.setData({camera});this.drawBoard();
  },
  boardEnd(event){const g=this._boardGesture;if(!g)return;if(event.touches&&event.touches.length){this.boardStart(event);this._boardGesture.moved=true;return;}this._boardGesture=null;if(!g.moved){const p=worldPoint(this.data.camera,g.a);this._dirty=true;this.setData({nextPosition:{x:limit(p.x),y:limit(p.y)},positionChosen:true,selectedId:'',selectedLabel:''});this.drawBoard();}this.rememberCamera();},
  selectNode(event){const id=event.currentTarget.dataset.id,n=(this._worldNodes||[]).find(n=>n.id===id);if(!n)return;this._cameraAuto=false;const z=Math.min(1e9,Math.max(0,...this._layouts.map(n=>n.z||0),...(this._worldNodes||[]).map(n=>n.z||0))+1);this.setData({selectedId:id,selectedLabel:n.label});this.layout(Object.assign({},n,{z}));},
  nodeStart(event){const ts=event.touches||[];if(!ts.length)return;this.selectNode(event);const n=(this._worldNodes||[]).find(n=>n.id===event.currentTarget.dataset.id);if(!n)return;const a=touch(ts[0]);this._nodeGesture={node:Object.assign({},n),a,moved:false};if(ts.length>1)this.beginNodePinch(this._nodeGesture,a,touch(ts[1]));},
  beginNodePinch(g,a,b){const c=center(a,b),r=this._boardRect||{left:51,top:46},p=worldPoint(this.data.camera,{x:c.x-r.left,y:c.y-r.top});g.distance=distance(a,b);g.anchor={x:(p.x-g.node.x)/(g.node.scale||1),y:(p.y-g.node.y)/(g.node.scale||1)};},
  nodeMove(event){const g=this._nodeGesture,ts=event.touches||[];if(!g||!ts.length)return;const a=touch(ts[0]),zoom=this.data.camera.zoom,n=g.node;
    if(ts.length>1){const b=touch(ts[1]),c=center(a,b);if(!g.distance){g.node=Object.assign({},(this._worldNodes||[]).find(v=>v.id===n.id)||n);this.beginNodePinch(g,a,b);}const scale=clamp((g.node.scale||1)*distance(a,b)/Math.max(1,g.distance),.25,4),r=this._boardRect||{left:51,top:46},p=worldPoint(this.data.camera,{x:c.x-r.left,y:c.y-r.top});this.layout(Object.assign({},g.node,{scale,x:limit(p.x-g.anchor.x*scale),y:limit(p.y-g.anchor.y*scale)}));g.moved=true;}
    else{const dx=a.x-g.a.x,dy=a.y-g.a.y;if(!g.moved&&Math.hypot(dx,dy)<4)return;g.moved=true;this.layout(Object.assign({},n,{x:limit(n.x+dx/zoom),y:limit(n.y+dy/zoom)}));}
  },
  nodeEnd(event){if(this._nodeGesture&&event&&event.touches&&event.touches.length){const n=(this._worldNodes||[]).find(n=>n.id===this._nodeGesture.node.id);if(n)this._nodeGesture={node:Object.assign({},n),a:touch(event.touches[0]),moved:true};return;}this._nodeGesture=null;this.rememberDraft();if(!this._id&&getApp().client.hasSession())this.ensureWorkspace().then(()=>this.persist()).catch(e=>this.setData({error:e.message}));},
  resizeStart(event){const n=(this._worldNodes||[]).find(n=>n.id===event.currentTarget.dataset.id),t=event.touches&&event.touches[0];if(n&&t)this._resizeGesture={node:Object.assign({},n),a:touch(t)};},
  resizeMove(event){const g=this._resizeGesture,t=event.touches&&event.touches[0];if(!g||!t)return;const p=touch(t),n=g.node,ratio=clamp((n.width+(p.x-g.a.x)/(this.data.camera.zoom*(n.scale||1)))/n.width,Math.max(48/n.width,48/n.height),Math.min(2000/n.width,2000/n.height));this.layout(Object.assign({},n,{width:n.width*ratio,height:n.height*ratio}));},
  resizeEnd(){this._resizeGesture=null;this.nodeEnd();},
  layout(node){this.captureLayout();this._dirty=true;const value=nodeLayout(node),i=this._layouts.findIndex(n=>n.id===node.id);if(i<0)this._layouts.push(value);else this._layouts[i]=value;this._worldNodes=(this._worldNodes||[]).map(n=>n.id===node.id?Object.assign({},n,value):n).filter(n=>!n.hidden);this.drawBoard();this.scheduleSave();},
  enlargeNode(event){const n=(this._worldNodes||[]).find(n=>n.id===event.currentTarget.dataset.id);if(n){this.layout(Object.assign({},n,{scale:clamp((n.scale||1)*1.25,.25,4)}));this.nodeEnd();}},
  removeNode(event){const n=(this._worldNodes||[]).find(n=>n.id===event.currentTarget.dataset.id);if(!n)return;this._undo=nodeLayout(n);this.layout(Object.assign({},n,{hidden:true}));this.setData({undoNode:n.id,selectedId:'',selectedLabel:''});this.nodeEnd();},
  focusNode(event){const n=(this._worldNodes||[]).find(n=>n.id===event.currentTarget.dataset.id);if(!n)return;this._cameraReady=true;this._cameraAuto=false;this.setData({camera:{x:n.x-20,y:n.y-20,zoom:1},selectedId:n.id,selectedLabel:n.label,sheet:''});this.drawBoard();this.rememberCamera();},
  zoom(event){const camera=this.data.camera||{x:0,y:0,zoom:1},r=this._boardRect||{width:339,height:300},c={x:r.width/2,y:r.height/2},anchor=worldPoint(camera,c),zoom=clamp(Math.round((camera.zoom+Number(event.currentTarget.dataset.delta))*1e8)/1e8,1e-7,4);this.setData({camera:{x:anchor.x-c.x/zoom,y:anchor.y-c.y/zoom,zoom}});this.rememberCamera();this.drawBoard();},
  fit(){const all=this._worldNodes||[],r=this._boardRect||{width:339,height:300};let camera={x:0,y:0,zoom:1};if(all.length){const x=Math.min(...all.map(n=>n.x)),y=Math.min(...all.map(n=>n.y)),right=Math.max(...all.map(n=>n.x+n.width*(n.scale||1))),bottom=Math.max(...all.map(n=>n.y+n.height*(n.scale||1))),zoom=clamp(Math.min((r.width-32)/Math.max(1,right-x),(r.height-32)/Math.max(1,bottom-y),1),1e-7,1);camera={x:x-16/zoom,y:y-16/zoom,zoom};}this.setData({camera});this.rememberCamera();this.drawBoard();},
};
module.exports={methods,worldPoint,screenPoint,visibleNodes};
