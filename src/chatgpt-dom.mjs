// Public rendered UI only: no cookies, credentials or private API calls.
export function chatGptDomScripts(prompt, { image = false } = {}) {
  const fill = `(function(){
    var e=document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"]');
    if(!e)return 'WAIT';
    var state=window.__blossomGeneration;
    if(!state){
      state=window.__blossomGeneration={count:document.querySelectorAll('[data-message-author-role="assistant"]').length,last:'',stable:0,imageSources:Array.from(document.querySelectorAll('main img')).map(function(i){return i.currentSrc||i.src}).filter(Boolean)};
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
    if(!state||document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]'))return 'WAIT';
    var node=nodes[nodes.length-1];
    ${image ? `// Image-only turns need not contain an assistant text-role element.
    // Search visible rendered images, excluding every URL present before submission.
    var scope=node&&(node.closest('[data-testid^="conversation-turn"]')||node.closest('article')||node);
    var images=Array.from(document.querySelectorAll('main img'));
    if(scope)images=images.concat(Array.from(scope.querySelectorAll('img')));
    images=images.filter(function(i){
      var url=i.currentSrc||i.src;
      return i.complete&&i.naturalWidth>=256&&i.naturalHeight>=256&&url&&
        !(state.imageSources||[]).includes(url)&&
        !(i.closest&&i.closest('[data-message-author-role="user"]'));
    });
    if(!images.length)return 'WAIT';
    var img=images[images.length-1],text=img.currentSrc||img.src;` : `if(nodes.length<=state.count)return 'WAIT';
    var text=(node.innerText||'').trim();
    if(!text)return 'WAIT';`}
    if(state.last!==text){state.last=text;state.stable=0;return 'WAIT';}
    if(++state.stable<3)return 'WAIT';
    ${image ? `try{
      var canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      if(canvas.width>4096||canvas.height>4096)return 'ERROR:Image exceeds supported dimensions';
      canvas.getContext('2d').drawImage(img,0,0);
      return canvas.toDataURL('image/png');
    }catch(e){
      // Export only the image URL already rendered in this assistant turn.
      // Cross-origin images can taint a canvas; fetch a CORS-readable blob instead.
      if(state.imageExport&&state.imageExport.url===text){
        if(state.imageExport.data)return state.imageExport.data;
        if(state.imageExport.error)return 'ERROR:Generated image could not be transferred to Blossom. Retry generation; the project is preserved.';
        return 'WAIT';
      }
      var transfer=state.imageExport={url:text};
      fetch(text).then(function(response){
        if(!response.ok)throw new Error('Image download failed');
        return response.blob();
      }).then(function(blob){
        if(!blob.type.startsWith('image/')||blob.size>20*1024*1024)throw new Error('Invalid image');
        var objectUrl=URL.createObjectURL(blob),copy=new Image();
        copy.onload=function(){try{
          var out=document.createElement('canvas');out.width=copy.naturalWidth;out.height=copy.naturalHeight;
          if(out.width>4096||out.height>4096)throw new Error('Image too large');
          out.getContext('2d').drawImage(copy,0,0);transfer.data=out.toDataURL('image/png');
        }catch(error){transfer.error=true;}finally{URL.revokeObjectURL(objectUrl);}};
        copy.onerror=function(){transfer.error=true;URL.revokeObjectURL(objectUrl);};copy.src=objectUrl;
      }).catch(function(){transfer.error=true;});
      return 'WAIT';
    }` : 'return text;'}
  })()`;
  return { fill, read };
}

