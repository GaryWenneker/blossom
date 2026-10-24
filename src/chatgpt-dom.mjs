// Public rendered UI only: no cookies, credentials or private API calls.
export function chatGptDomScripts(prompt, { image = false } = {}) {
  const fill = `(function(){
    var e=document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"]');
    if(!e)return 'WAIT';
    var state=window.__blossomGeneration;
    if(!state){
      state=window.__blossomGeneration={count:document.querySelectorAll('[data-message-author-role="assistant"]').length,last:'',stable:0};
      e.focus();
      var prompt=${JSON.stringify(prompt)};
      if(e.tagName==='TEXTAREA'){
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,prompt);
      }else{
        var range=document.createRange();range.selectNodeContents(e);
        var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand('insertText',false,prompt))e.textContent=prompt;
      }
      e.dispatchEvent(new Event('input',{bubbles:true}));
      return 'WAIT';
    }
    var b=document.querySelector('button[data-testid="send-button"], button[data-testid="composer-send-button"], #composer-submit-button, button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Verzenden"]');
    if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';
    b.click();return 'SUBMITTED';
  })()`;
  const read = `(function(){
    var state=window.__blossomGeneration;
    var nodes=document.querySelectorAll('[data-message-author-role="assistant"]');
    if(!state||nodes.length<=state.count||document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]'))return 'WAIT';
    var node=nodes[nodes.length-1];
    ${image ? `// Image attachments can be siblings of the assistant text container.
    var scope=node.closest('article')||node;
    var images=Array.from(scope.querySelectorAll('img')).filter(function(i){return i.complete&&i.naturalWidth>=256&&i.naturalHeight>=256});
    if(!images.length)return 'WAIT';
    var img=images[images.length-1],text=img.currentSrc||img.src;` : `var text=(node.innerText||'').trim();
    if(!text)return 'WAIT';`}
    if(state.last!==text){state.last=text;state.stable=0;return 'WAIT';}
    if(++state.stable<3)return 'WAIT';
    ${image ? `try{
      var canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      if(canvas.width>4096||canvas.height>4096)return 'ERROR:Image exceeds supported dimensions';
      canvas.getContext('2d').drawImage(img,0,0);
      return canvas.toDataURL('image/png');
    }catch(e){return 'ERROR:Browser could not export the generated image. Download it from ChatGPT and import it in Blossom.';}` : 'return text;'}
  })()`;
  return { fill, read };
}

