function id(){return 'b-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);}
function textBlock(text=''){return {id:id(),type:'text',text};}
function blocksOf(note){
 const blocks=note.blocks&&note.blocks.length?JSON.parse(JSON.stringify(note.blocks)):[textBlock(note.text||'')];
 const included=new Set(blocks.filter(b=>b.type==='media').map(b=>b.mediaId));
 for(const mediaId of note.attachmentIds||[])if(!included.has(mediaId))blocks.push({id:id(),type:'media',mediaId});
 if(blocks[blocks.length-1].type!=='text')blocks.push(textBlock());return blocks;
}
function contents(blocks){return {text:blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'),attachmentIds:Array.from(new Set(blocks.filter(b=>b.type==='media').map(b=>b.mediaId)))};}
function insertMedia(blocks,activeId,cursor,ids){
 const out=JSON.parse(JSON.stringify(blocks)),index=out.findIndex(b=>b.id===activeId&&b.type==='text'),at=index<0?out.length-1:index,b=out[at],pos=Math.max(0,Math.min(b&&b.type==='text'?b.text.length:0,Number.isFinite(cursor)?cursor:b&&b.text?b.text.length:0));
 const after=textBlock(b&&b.type==='text'?b.text.slice(pos):'');
 out.splice(at,b&&b.type==='text'?1:0,...(b&&b.type==='text'?[{...b,text:b.text.slice(0,pos)}]:[]),...ids.map(mediaId=>({id:id(),type:'media',mediaId})),after);return {blocks:out,activeId:after.id};
}
function removeBlock(blocks,blockId){const out=blocks.filter(b=>b.id!==blockId);return out.length?out:[textBlock()];}
module.exports={id,textBlock,blocksOf,contents,insertMedia,removeBlock};
