import {useEffect} from 'react';
let dialogNumber=0;
// Existing business forms share this focus behaviour, including nested order workspaces.
export default function useModalAccessibility(){
 useEffect(()=>{
  let active=null,previous=null,frame=null,overflow=null;
  const inertStates=new Map();
  const restore=()=>{for(const [element,inert]of inertStates)element.inert=inert;inertStates.clear();};
  const controls=()=>[...(active?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')||[])].filter(e=>e.getClientRects().length&&!e.closest('[inert]'));
  const sync=()=>{
   const next=[...document.querySelectorAll('.modal')].at(-1)||null;
   if(next===active)return;
   if(frame!==null)cancelAnimationFrame(frame);
   restore();
   if(!next){
    active=null;if(overflow!==null)document.body.style.overflow=overflow;overflow=null;
    if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});else document.getElementById('main-content')?.focus({preventScroll:true});
    previous=null;return;
   }
   if(!active){previous=document.activeElement;overflow=document.body.style.overflow;document.body.style.overflow='hidden';}
   active=next;
   const panel=active.firstElementChild,heading=panel?.querySelector('h2');
   if(panel){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');if(!panel.hasAttribute('tabindex'))panel.tabIndex=-1;if(heading&&!panel.hasAttribute('aria-labelledby')){if(!heading.id)heading.id='dialog-heading-'+(++dialogNumber);panel.setAttribute('aria-labelledby',heading.id);}}
   // Keep only the active dialog's ancestor path interactive.
   for(let branch=active;branch?.parentElement&&branch!==document.body;branch=branch.parentElement){
    for(const sibling of branch.parentElement.children){if(sibling===branch||['SCRIPT','STYLE','LINK'].includes(sibling.tagName))continue;inertStates.set(sibling,sibling.inert);sibling.inert=true;}
   }
   frame=requestAnimationFrame(()=>{if(!active)return;const target=active.querySelector('[autofocus]')||controls()[0]||panel;target?.focus({preventScroll:true});});
  };
  const keydown=e=>{
   if(!active)return;
   if(e.key==='Escape'){
    const close=controls().find(el=>el.tagName==='BUTTON'&&/^(cancel|close)$/i.test(el.textContent.trim()));
    if(close){e.preventDefault();e.stopPropagation();close.click();}
   }
   if(e.key==='Tab'){
    const targets=controls(),first=targets[0],last=targets.at(-1);
    if(!targets.length){e.preventDefault();return;}
    if(!active.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();}
    else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});document.addEventListener('keydown',keydown,true);sync();
  return()=>{observer.disconnect();document.removeEventListener('keydown',keydown,true);if(frame!==null)cancelAnimationFrame(frame);restore();if(overflow!==null)document.body.style.overflow=overflow;};
 },[]);
}
