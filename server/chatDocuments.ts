import { inflateRawSync } from 'node:zlib';
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_XML=4*1024*1024;
export function documentText(bytes:Buffer,name:string):{text:string;truncated:boolean} {
  if(bytes.length>20*1024*1024)throw Error('文档不能超过20MB。');
  let text='';
  if(/\.docx$/i.test(name)) {
    let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0)throw Error('Word文件不完整，请重新上传.docx文件。');
    const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);if(count>5000||offset>=bytes.length)throw Error('Word文件结构不受支持。');
    let at=offset,xml:Buffer|undefined;
    for(let i=0;i<count;i++){
      if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Word目录已损坏。');
      const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
      const entry=bytes.toString('utf8',at+46,at+46+length);at+=46+length+extra+comment;
      if(entry!=='word/document.xml')continue;
      if(xml||flags&1||size>MAX_XML||packed>20*1024*1024||local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw Error('Word正文无效、加密或过大。');
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+packed>bytes.length)throw Error('Word正文不完整。');
      const data=bytes.subarray(start,start+packed);xml=method===0?Buffer.from(data):method===8?inflateRawSync(data,{maxOutputLength:MAX_XML}):undefined;
      if(!xml||xml.length!==size)throw Error('Word压缩格式不受支持。');
    }
    if(!xml)throw Error('未找到Word正文，请上传.docx文档。');
    const source=xml.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Word正文包含不支持的XML声明。');
    text=source.replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<\/w:tc>/g,'\t').replace(/<[^>]*>/g,'')
      .replace(/&(?:lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi,entity=>{const named:Record<string,string>={'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&apos;':"'"};if(named[entity])return named[entity];const n=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
  } else if(/\.(?:txt|md)$/i.test(name)) {
    text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(text.includes('\0'))throw Error('文本文件编码不受支持，请使用UTF-8。');
  } else throw Error('文档支持.docx、.txt和.md；旧版.doc请另存为.docx。');
  text=text.replace(/\r/g,'').replace(/\n{4,}/g,'\n\n').trim();if(!text)throw Error('文档没有可读取的正文；扫描图片请作为图片上传。');
  return {text:text.slice(0,60000),truncated:text.length>60000};
}
