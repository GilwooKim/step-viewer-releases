import core from '../electron/localization.cjs';
let language='ko';
const textSources=new WeakMap(),attributeSources=new WeakMap();
const attributes=['title','aria-label','placeholder'];
// File names, CAD labels and editable values are user data, never UI messages.
const userText='[data-user-text],.assembly-name,.tab-select,#part-name-edit,#tool-part,#recent-menu button span,#recent-menu button small,.part-row button span:last-child';
function translateNode(node){
  if(node.nodeType!==Node.TEXT_NODE||!node.parentElement||node.parentElement.closest('script,style,'+userText))return;
  const previous=textSources.get(node),current=node.nodeValue;
  const source=previous&&current===previous.display?previous.source:current,display=core.translate(source,language);
  textSources.set(node,{source,display});if(current!==display)node.nodeValue=display;
}
function translateAttributes(element){
  if(element.nodeType!==Node.ELEMENT_NODE)return;
  let records=attributeSources.get(element);if(!records){records={};attributeSources.set(element,records);}
  for(const key of attributes){const current=element.getAttribute(key);if(current===null)continue;
    if(element.matches('#file-name,#title-file,#selected-name,#recent-menu button')&&key==='title')continue;
    const old=records[key],source=old&&current===old.display?old.source:current,display=core.translate(source,language);records[key]={source,display};if(current!==display)element.setAttribute(key,display);
  }
}
function translateTree(root){
  if(root.nodeType===Node.TEXT_NODE){translateNode(root);return;}
  translateAttributes(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let node;
  while((node=walker.nextNode())){if(node.nodeType===Node.TEXT_NODE)translateNode(node);else translateAttributes(node);}
}
export const sourceText=element=>[...element.childNodes].map(node=>node.nodeType===Node.TEXT_NODE?(textSources.get(node)?.source??node.nodeValue):sourceText(node)).join('');
export const getLanguage=()=>language;
export const t=text=>core.translate(text,language);
export function setLanguage(value){
  if(!['en','ko'].includes(value))throw new Error('Unsupported language');language=value;document.documentElement.lang=value;translateTree(document.body);window.dispatchEvent(new CustomEvent('language-changed',{detail:value}));
}
export async function initLocalization(){
  const preferences=await window.desktop.preferences();language=preferences.language;
  const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')translateNode(record.target);else if(record.type==='attributes')translateAttributes(record.target);else for(const node of record.addedNodes)translateTree(node);}});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});setLanguage(language);
}
