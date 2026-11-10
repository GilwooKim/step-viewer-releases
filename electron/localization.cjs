const messages=require('./locale-messages.json');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(messages).filter(([key])=>/\{\d+\}/.test(key)).sort((a,b)=>b[0].replace(/\{\d+\}/g,'').length-a[0].replace(/\{\d+\}/g,'').length).map(([key,value])=>{
  const slots=[];let source='',last=0;
  for(const match of key.matchAll(/\{(\d+)\}/g)){source+=escape(key.slice(last,match.index))+'([\\s\\S]*?)';slots.push(Number(match[1]));last=match.index+match[0].length;}
  return {match:new RegExp('^'+source+escape(key.slice(last))+'$'),value,slots};
});
function translate(text,language='ko'){
  if(language!=='en'||typeof text!=='string')return text;
  const source=text.trim();let result=Object.hasOwn(messages,source)?messages[source]:undefined;
  if(result===undefined&&source.includes('\n'))return text.split('\n').map(line=>translate(line,language)).join('\n');
  if(result===undefined){for(const pattern of patterns){const match=source.match(pattern.match);if(match){const values={};pattern.slots.forEach((slot,i)=>values[slot]=match[i+1]);result=pattern.value.replace(/\{(\d+)\}/g,(_,i)=>values[i]??'');break;}}}
  if(result===undefined)return text;
  return text.slice(0,text.indexOf(source))+result+text.slice(text.indexOf(source)+source.length);
}
module.exports={translate};
