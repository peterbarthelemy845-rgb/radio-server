// Decode only small, server-transformed PNGs; never arbitrary upload bytes.
export async function adPixels(buffer){const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<33||bytes.length>200000||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a)throw Error('Invalid normalized PNG.');
 let pos=8,width,height,depth,type,palette,transparency,chunks=[];
 while(pos+12<=bytes.length){const size=view.getUint32(pos),name=String.fromCharCode(...bytes.subarray(pos+4,pos+8));if(size>200000||pos+12+size>bytes.length)throw Error('Invalid chunk.');const data=bytes.subarray(pos+8,pos+8+size);
  if(name==='IHDR'){width=view.getUint32(pos+8);height=view.getUint32(pos+12);depth=data[8];type=data[9];if(width!==256||height!==76||data[10]||data[11]||data[12])throw Error('Unsupported normalized image.');}
  if(name==='PLTE')palette=data;if(name==='tRNS')transparency=data;if(name==='IDAT')chunks.push(data);pos+=12+size;if(name==='IEND')break;
 }
 const channels=({0:1,2:3,3:1,4:2,6:4})[type];if(!channels||![1,2,4,8].includes(depth)||(type!==0&&type!==3&&depth!==8)||!width||!chunks.length)throw Error('Unsupported normalized PNG.');
 const stride=Math.ceil(width*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8)),maximum=(stride+1)*height;
 const reader=new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let parts=[],length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maximum){await reader.cancel();throw Error('Expanded PNG too large.');}parts.push(value);}
 if(length!==maximum)throw Error('Invalid PNG length.');const raw=new Uint8Array(length);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
 const pixels=new Uint8Array(256*76*2),prior=new Uint8Array(stride);let cursor=0;
 for(let y=0;y<height;y++){const filter=raw[cursor++],row=raw.slice(cursor,cursor+stride);cursor+=stride;if(filter>4)throw Error('Invalid filter.');
  for(let i=0;i<stride;i++){const left=i>=bpp?row[i-bpp]:0,up=prior[i],ul=i>=bpp?prior[i-bpp]:0;let prediction=0;
   if(filter===1)prediction=left;if(filter===2)prediction=up;if(filter===3)prediction=Math.floor((left+up)/2);if(filter===4){const p=left+up-ul,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-ul);prediction=a<=b&&a<=c?left:b<=c?up:ul;}row[i]=(row[i]+prediction)&255;
  }
  for(let x=0;x<width;x++){let r,g,b,a=255;const i=x*channels;if(type===3||type===0){const index=(row[Math.floor(x*depth/8)]>>>(8-depth-(x*depth%8)))&((1<<depth)-1);if(type===3){if(!palette||index*3+2>=palette.length)throw Error('Invalid palette.');r=palette[index*3];g=palette[index*3+1];b=palette[index*3+2];a=transparency?.[index]??255;}else r=g=b=Math.round(index*255/((1<<depth)-1));}else if(type===2){r=row[i];g=row[i+1];b=row[i+2];}else if(type===4){r=g=b=row[i];a=row[i+1];}else{r=row[i];g=row[i+1];b=row[i+2];a=row[i+3];}r=Math.round(r*a/255);g=Math.round(g*a/255);b=Math.round(b*a/255);const rgb=((r>>3)<<11)|((g>>2)<<5)|(b>>3),o=(y*width+x)*2;pixels[o]=rgb&255;pixels[o+1]=rgb>>>8;}
  prior.set(row);
 }
 return pixels;
}
