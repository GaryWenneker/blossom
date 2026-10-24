-- Analyze one recording in its own Safari ChatGPT window.
-- Do not activate Safari, and do not read cookies, passwords, or storage.
on writeProgress(progressPath, value)
  if progressPath does not start with "/tmp/" and progressPath does not start with "/private/tmp/" and progressPath does not start with "/var/folders/" then error "Unsafe progress path"
  do shell script "printf %s " & quoted form of value & " > " & quoted form of progressPath
end writeProgress

on run argv
  if (count of argv) is not 3 then error "Expected browser name, prompt, and progress path"
  set browserName to item 1 of argv
  set promptLiteral to item 2 of argv
  set progressPath to item 3 of argv
  if browserName is not "Safari" then error "Unsupported browser"
  my writeProgress(progressPath, "5")
  set roleJS to "(function(){try{return sessionStorage.getItem('blossom-role')==='dna'?'DNA':'OTHER';}catch(e){return 'OTHER';}})()"
  set markJS to "(function(){try{sessionStorage.setItem('blossom-role','dna');return 'DNA';}catch(e){return 'WAIT';}})()"
  set fillJS to "(function(){var prompt=" & promptLiteral & ";var e=document.querySelector('#prompt-textarea, [data-testid=prompt-textarea], form [contenteditable=true][role=textbox], [contenteditable=true][role=textbox]');if(!e)return 'WAIT';var current=String(e.value||e.innerText||'').trim();var wanted=String(prompt).trim();var placed=current===wanted||(wanted.length>24&&current.indexOf(wanted.slice(0,24))===0);if(!placed){e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(e,prompt);e.dispatchEvent(new Event('input',{bubbles:true}));}else{document.execCommand('selectAll',false,null);if(!document.execCommand('insertText',false,prompt))e.textContent=prompt;e.dispatchEvent(new Event('input',{bubbles:true}));}return 'WAIT';}var b=document.querySelector('button[data-testid=send-button], button[data-testid=composer-send-button], #composer-submit-button, button[aria-label=\"Send prompt\"], button[aria-label=\"Send message\"], button[aria-label=\"Verzenden\"], button[aria-label=\"Prompt verzenden\"], button[aria-label=\"Bericht verzenden\"]');if(!b){var f=e.closest&&e.closest('form');if(f)b=f.querySelector('button');}if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';b.click();return 'SUBMITTED';})()"
  set readJS to "(function(){var stop=document.querySelector('button[data-testid=stop-button], button[aria-label=\"Stop generating\"], button[aria-label=\"Stop met genereren\"], button[aria-label=Stoppen]');if(stop)return 'WAIT';function text(node){return ((node&&node.innerText)||'').trim();}function joined(list){return [].slice.call(list).map(text).filter(Boolean).join('\\n');}var root=document.querySelector('[data-thread-find-target=conversation]');var blob=text(root);var box=document.querySelector('[contenteditable=true][role=textbox]');var draft=text(box);if(draft)blob=blob.split(draft).join('\\n');if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))blob=joined(document.querySelectorAll('[data-message-author-role=assistant]'));if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))blob=joined(document.querySelectorAll('main .markdown, main article'));if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))return 'WAIT';return blob;})()"
  tell application "Safari"
    set foundDna to false
    repeat with openDocument in documents
      try
        set pageURL to URL of openDocument
        if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
          set roleText to (do JavaScript roleJS in openDocument) as text
          if roleText is "DNA" then set foundDna to true
        end if
      end try
    end repeat
    if foundDna is false then
      make new document with properties {URL:"https://chatgpt.com/#blossom-dna"}
      try
        set miniaturized of front window to true
      end try
    end if
  end tell
  if foundDna is false then
    repeat with attempt from 1 to 25
      delay 1
      set marked to false
      tell application "Safari"
        repeat with openDocument in documents
          try
            set pageURL to URL of openDocument
            if pageURL contains "blossom-dna" then
              set resultText to (do JavaScript markJS in openDocument) as text
              if resultText is "DNA" then set marked to true
            end if
          on error errorText number errorNumber
            if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
          end try
        end repeat
      end tell
      if marked is true then exit repeat
    end repeat
  end if
  if foundDna is false then
    tell application "Safari"
      try
        set pageURL to URL of front document
        if pageURL contains "chatgpt.com" then
          set claimText to (do JavaScript "(function(){var e=document.querySelector('[contenteditable=true][role=textbox]');var t=((e&&(e.innerText||e.value))||'');return t.indexOf('You are Blossom')===0?'LYRICS':'OTHER';})()" in front document) as text
          if claimText is not "LYRICS" then
            set resultText to (do JavaScript markJS in front document) as text
            if resultText is "DNA" then set foundDna to true
          end if
        end if
      end try
    end tell
  end if
  my writeProgress(progressPath, "15")
  set previousReply to ""
  tell application "Safari"
    repeat with openDocument in documents
      try
        set pageURL to URL of openDocument
        if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
          set resultText to (do JavaScript readJS in openDocument) as text
          if resultText is not "" and resultText is not "missing value" and resultText is not "WAIT" then tell me to set previousReply to resultText
        end if
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
    end repeat
  end tell
  set submitted to false
  repeat with attempt from 1 to 25
    delay 1
    set actionStatus to "WAIT"
    tell application "Safari"
      repeat with openDocument in documents
        try
          set pageURL to URL of openDocument
          if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
            set roleText to (do JavaScript roleJS in openDocument) as text
            set claimText to (do JavaScript "(function(){var e=document.querySelector('[contenteditable=true][role=textbox]');var t=((e&&(e.innerText||e.value))||'');return t.indexOf('You are Blossom')===0?'LYRICS':'OTHER';})()" in openDocument) as text
            if roleText is "DNA" and claimText is not "LYRICS" then
              set resultText to (do JavaScript fillJS in openDocument) as text
              if resultText is "SUBMITTED" then
                tell me to set actionStatus to resultText
                exit repeat
              end if
            end if
          end if
        on error errorText number errorNumber
          if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
        end try
      end repeat
    end tell
    if actionStatus is "SUBMITTED" then
      set submitted to true
      my writeProgress(progressPath, "40")
      exit repeat
    end if
  end repeat
  if submitted is false then return "LOGIN"
  repeat with attempt from 1 to 90
    delay 1
    set pct to 40 + attempt
    if pct > 80 then set pct to 80
    my writeProgress(progressPath, pct as text)
    set replyText to "WAIT"
    tell application "Safari"
      repeat with openDocument in documents
        try
          set pageURL to URL of openDocument
          if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
            set resultText to (do JavaScript readJS in openDocument) as text
            if resultText is not "" and resultText is not "missing value" and resultText is not "WAIT" then
              tell me to set replyText to resultText
              exit repeat
            end if
          end if
        on error errorText number errorNumber
          if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
        end try
      end repeat
    end tell
    if replyText is previousReply then set replyText to "WAIT"
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then
      my writeProgress(progressPath, "85")
      return "REPLY" & linefeed & replyText
    end if
  end repeat
  error "ChatGPT did not finish a reply"
end run
