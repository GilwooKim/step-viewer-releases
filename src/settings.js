import {getLanguage,setLanguage} from './localization.js';
export function openSettings(){
  const dialog=document.getElementById('settings-dialog');
  // Keep an underlying export/help dialog and its progress intact.
  if(!dialog.open)dialog.showModal();
}
export function initSettings(){
  const $=id=>document.getElementById(id),select=$('settings-language');select.value=getLanguage();
  select.onchange=async()=>{
    const previous=getLanguage();select.disabled=true;$('settings-status').textContent='';
    try{const result=await window.desktop.setLanguage(select.value);setLanguage(result.language);$('settings-status').textContent='언어 설정을 저장했습니다.';}
    catch{select.value=previous;$('settings-status').textContent='언어 설정을 저장하지 못했습니다. 다시 시도해 주세요.';}
    finally{select.disabled=false;}
  };
  $('close-settings').onclick=()=>$('settings-dialog').close();$('help-settings').onclick=openSettings;
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key===','){event.preventDefault();openSettings();}});
}
