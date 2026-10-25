-- Open one visible Safari ChatGPT conversation for this analysis.
-- Do not read cookies, passwords, or storage.
-- Re-read window 1 on every pass. A stored document reference dies when the title loads.
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
  set sessionToken to do shell script "uuidgen | tr '[:upper:]' '[:lower:]'"
  if (length of sessionToken) is not 36 then error "Unsafe session token"
  my writeProgress(progressPath, "5")
  set sessionURL to "https://chatgpt.com/#blossom-dna-" & sessionToken
  set markJS to "(function(){try{sessionStorage.setItem('blossom-dna-session','" & sessionToken & "');sessionStorage.setItem('blossom-role','dna');return 'DNA';}catch(e){return 'WAIT';}})()"
  set roleJS to "(function(){try{return sessionStorage.getItem('blossom-dna-session')==='" & sessionToken & "'?'DNA':'OTHER';}catch(e){return 'OTHER';}})()"
  set freshJS to "(function(){try{if(sessionStorage.getItem('blossom-dna-session')!=='" & sessionToken & "')return 'OTHER';if(location.pathname.indexOf('/c/')===0){var n=document.querySelector('a[data-testid=\"create-new-chat-button\"], a[aria-label=\"New chat\"], button[aria-label=\"New chat\"], a[aria-label=\"Nieuwe chat\"], button[aria-label=\"Nieuwe chat\"]');if(n){n.click();return 'WAIT';}location.assign('https://chatgpt.com/');return 'WAIT';}return 'FRESH';}catch(e){return 'WAIT';}})()"
  set fillJS to "(function(){var prompt=" & promptLiteral & ";try{if(sessionStorage.getItem('blossom-dna-session')!=='" & sessionToken & "')return 'OTHER';}catch(e){return 'WAIT';}if(location.pathname.indexOf('/c/')===0)return 'WAIT';var e=document.querySelector('#prompt-textarea, [data-testid=prompt-textarea], form [contenteditable=true][role=textbox], [contenteditable=true][role=textbox]');if(!e)return 'WAIT';var current=String(e.value||e.innerText||'').trim();var wanted=String(prompt).trim();var placed=current===wanted||(wanted.length>24&&current.indexOf(wanted.slice(0,24))===0);if(!placed){e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(e,prompt);e.dispatchEvent(new Event('input',{bubbles:true}));}else{document.execCommand('selectAll',false,null);if(!document.execCommand('insertText',false,prompt))e.textContent=prompt;e.dispatchEvent(new Event('input',{bubbles:true}));}return 'WAIT';}var b=document.querySelector('button[data-testid=send-button], button[data-testid=composer-send-button], #composer-submit-button, button[aria-label=\"Send prompt\"], button[aria-label=\"Send message\"], button[aria-label=\"Verzenden\"], button[aria-label=\"Prompt verzenden\"], button[aria-label=\"Bericht verzenden\"]');if(!b){var f=e.closest&&e.closest('form');if(f)b=f.querySelector('button');}if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';b.click();return 'SUBMITTED';})()"
  set readJS to "(function(){try{if(sessionStorage.getItem('blossom-dna-session')!=='" & sessionToken & "')return 'WAIT';}catch(e){return 'WAIT';}var stop=document.querySelector('button[data-testid=stop-button], button[aria-label=\"Stop generating\"], button[aria-label=\"Stop met genereren\"], button[aria-label=Stoppen]');if(stop)return 'WAIT';function text(node){return ((node&&node.innerText)||'').trim();}function joined(list){return [].slice.call(list).map(text).filter(Boolean).join('\\n');}var root=document.querySelector('[data-thread-find-target=conversation]');var blob=text(root);var box=document.querySelector('[contenteditable=true][role=textbox]');var draft=text(box);if(draft)blob=blob.split(draft).join('\\n');if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))blob=joined(document.querySelectorAll('[data-message-author-role=assistant]'));if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))blob=joined(document.querySelectorAll('main .markdown, main article'));if(blob.indexOf('{')<0||(blob.indexOf('\"genres\"')<0&&blob.indexOf('\"summary\"')<0))return 'WAIT';return blob;})()"
  tell application "Safari"
    activate
    make new document with properties {URL:sessionURL}
    set miniaturized of front window to false
  end tell
  set marked to false
  repeat with attempt from 1 to 25
    delay 1
    tell application "Safari"
      try
        set resultText to (do JavaScript markJS in document of window 1) as text
        if resultText is "DNA" then tell me to set marked to true
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
    end tell
    if marked is true then exit repeat
  end repeat
  if marked is false then return "LOGIN"
  my writeProgress(progressPath, "15")
  set fresh to false
  set previousReply to ""
  repeat with attempt from 1 to 20
    delay 1
    set freshStatus to "WAIT"
    tell application "Safari"
      try
        set resultText to (do JavaScript freshJS in document of window 1) as text
        if resultText is "FRESH" then
          tell me to set freshStatus to resultText
          set priorText to (do JavaScript readJS in document of window 1) as text
          if priorText is not "" and priorText is not "missing value" and priorText is not "WAIT" then tell me to set previousReply to priorText
        end if
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
    end tell
    if freshStatus is "FRESH" then
      set fresh to true
      exit repeat
    end if
  end repeat
  if fresh is false then return "LOGIN"
  set submitted to false
  repeat with attempt from 1 to 25
    delay 1
    set actionStatus to "WAIT"
    tell application "Safari"
      try
        set roleText to (do JavaScript roleJS in document of window 1) as text
        set claimText to (do JavaScript "(function(){var e=document.querySelector('[contenteditable=true][role=textbox]');var t=((e&&(e.innerText||e.value))||'');return t.indexOf('You are Blossom')===0?'LYRICS':'OTHER';})()" in document of window 1) as text
        if roleText is "DNA" and claimText is not "LYRICS" then
          set resultText to (do JavaScript fillJS in document of window 1) as text
          if resultText is "SUBMITTED" then tell me to set actionStatus to resultText
        end if
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
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
    set conversationURL to ""
    tell application "Safari"
      try
        set pageURL to URL of document of window 1
        set resultText to (do JavaScript readJS in document of window 1) as text
        if resultText is not "" and resultText is not "missing value" and resultText is not "WAIT" then
          tell me to set replyText to resultText
          tell me to set conversationURL to pageURL
        end if
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
    end tell
    if replyText is previousReply then set replyText to "WAIT"
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" and conversationURL starts with "https://chatgpt.com/c/" then
      my writeProgress(progressPath, "85")
      return "REPLY" & linefeed & conversationURL & linefeed & replyText
    end if
  end repeat
  error "ChatGPT did not finish a reply"
end run
