function clampPercent(value, round=true){
 const number=Number(value);
 if(!Number.isFinite(number))return 0;
 const clamped=Math.min(100,Math.max(0,number));
 return round?Math.round(clamped):clamped;
}
function axisFocus(focus,delta,container,rendered,round){
 const slack=container-rendered;
 if(slack===0)return clampPercent(focus,round);
 return clampPercent(((slack*(focus/100))+delta)/slack*100,round);
}
export function focusFromDrag({containerWidth,containerHeight,naturalWidth,naturalHeight,focusX,focusY,dx,dy,round=true}){
 const current={focusX:clampPercent(focusX,round),focusY:clampPercent(focusY,round)};
 if(!(containerWidth>0)||!(containerHeight>0)||!(naturalWidth>0)||!(naturalHeight>0))return current;
 const scale=Math.max(containerWidth/naturalWidth,containerHeight/naturalHeight);
 return {
  focusX:axisFocus(current.focusX,dx,containerWidth,naturalWidth*scale,round),
  focusY:axisFocus(current.focusY,dy,containerHeight,naturalHeight*scale,round)
 };
}
export function savedFocus(record){
 const valid=value=>Number.isInteger(value)&&value>=0&&value<=100;
 return {focusX:valid(record?.focusX)?record.focusX:50,focusY:valid(record?.focusY)?record.focusY:0};
}
export function objectPosition(focusX,focusY){return clampPercent(focusX)+"% "+clampPercent(focusY)+"%";}
function percentAttribute(element,name,fallback){
 const raw=element.getAttribute(name);
 if(raw==null||raw==="")return fallback;
 const number=Number(raw);
 return Number.isInteger(number)&&number>=0&&number<=100?number:fallback;
}
export function applyPhotoFocus(root){
 const nodes=root?.querySelectorAll?.("[data-photo-focus]");
 if(!nodes)return;
 for(const element of nodes){
  element.style.objectPosition=objectPosition(
   percentAttribute(element,"data-focus-x",50),
   percentAttribute(element,"data-focus-y",0)
  );
 }
}
