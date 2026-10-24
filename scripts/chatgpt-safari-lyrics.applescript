-- Use the signed-in Safari profile. Do not read cookies, passwords, or storage.
on writeProgress(progressPath, value)
  if progressPath is "" then return
  if progressPath does not start with "/tmp/" and progressPath does not start with "/private/tmp/" and progressPath does not start with "/var/folders/" then error "Unsafe progress path"
  do shell script "printf %s " & quoted form of value & " > " & quoted form of progressPath
end writeProgress

on run argv
  if (count of argv) is 4 then return my runImage(argv)
  if (count of argv) is not 3 and (count of argv) is not 2 then error "Expected browser name, prompt, and progress path"
  set browserName to item 1 of argv
  set promptLiteral to item 2 of argv
  set progressPath to ""
  if (count of argv) is 3 then set progressPath to item 3 of argv
  if browserName is not "Safari" then error "Unsupported browser"
  -- Attribute selectors stay unquoted so the JavaScript string does not end early.
  set fillJS to "(function(){var prompt=" & promptLiteral & ";var e=document.querySelector('#prompt-textarea, [data-testid=prompt-textarea], form [contenteditable=true][role=textbox], [contenteditable=true][role=textbox]');if(!e)return 'WAIT';var current=String(e.value||e.innerText||'').trim();var wanted=String(prompt).trim();var placed=current===wanted||(wanted.length>24&&current.indexOf(wanted.slice(0,24))===0);if(!placed){e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(e,prompt);e.dispatchEvent(new Event('input',{bubbles:true}));}else{document.execCommand('selectAll',false,null);if(!document.execCommand('insertText',false,prompt))e.textContent=prompt;e.dispatchEvent(new Event('input',{bubbles:true}));}return 'WAIT';}var b=document.querySelector('button[data-testid=send-button], button[data-testid=composer-send-button], #composer-submit-button, button[aria-label=\"Send prompt\"], button[aria-label=\"Send message\"], button[aria-label=\"Verzenden\"], button[aria-label=\"Prompt verzenden\"], button[aria-label=\"Bericht verzenden\"]');if(!b){var f=e.closest&&e.closest('form');if(f)b=f.querySelector('button');}if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';b.click();return 'SUBMITTED';})()"
  set readJS to "(function(){var stop=document.querySelector('button[data-testid=stop-button], button[aria-label=\"Stop generating\"], button[aria-label=\"Stop met genereren\"], button[aria-label=Stoppen]');if(stop)return 'WAIT';function text(node){return ((node&&node.innerText)||'').trim();}function joined(list){return [].slice.call(list).map(text).filter(Boolean).join('\\n');}var root=document.querySelector('[data-thread-find-target=conversation]');var blob=text(root);var box=document.querySelector('[contenteditable=true][role=textbox]');var draft=text(box);if(draft)blob=blob.split(draft).join('\\n');if(blob.indexOf('{')<0||blob.indexOf('\"lyrics\"')<0)blob=joined(document.querySelectorAll('[data-message-author-role=assistant]'));if(blob.indexOf('{')<0||blob.indexOf('\"lyrics\"')<0)blob=joined(document.querySelectorAll('main .markdown, main article'));if(blob.indexOf('{')<0||blob.indexOf('\"lyrics\"')<0)return 'WAIT';return blob;})()"
  set roleJS to "(function(){try{return sessionStorage.getItem('blossom-role')==='dna'?'DNA':'OTHER';}catch(e){return 'OTHER';}})()"
  tell application "Safari"
    activate
    set foundChat to false
    repeat with openDocument in documents
      try
        set pageURL to URL of openDocument
        if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
          set roleText to (do JavaScript roleJS in openDocument) as text
          if roleText is "DNA" then
          else
            set foundChat to true
          end if
        end if
      end try
    end repeat
    -- Do not keep this document. Safari names it "Naamloos" until the title loads, and that reference then raises -1728.
    if foundChat is false then make new document with properties {URL:"https://chatgpt.com/"}
  end tell
  -- A finished brief already on screen is copied. A blank chat falls through and receives the article.
  set replyText to "WAIT"
  tell application "Safari"
    repeat with openDocument in documents
      try
        set pageURL to URL of openDocument
        if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
          set roleText to (do JavaScript roleJS in openDocument) as text
          if roleText is "DNA" then
          else
            set resultText to (do JavaScript readJS in openDocument) as text
            if resultText is not "" and resultText is not "missing value" and resultText is not "WAIT" then
              tell me to set replyText to resultText
              exit repeat
            end if
          end if
        end if
      on error errorText number errorNumber
        if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
      end try
    end repeat
  end tell
  if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then
    my writeProgress(progressPath, "90")
    return "REPLY" & linefeed & replyText
  end if
  my writeProgress(progressPath, "20")
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
            set claimText to (do JavaScript "(function(){var e=document.querySelector('[contenteditable=true][role=textbox]');var t=((e&&(e.innerText||e.value))||'');return t.indexOf('You are Blossom')===0?'OURS':'OTHER';})()" in openDocument) as text
            if roleText is "DNA" and claimText is not "OURS" then
            else
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
    if pct > 84 then set pct to 84
    my writeProgress(progressPath, pct as text)
    set replyText to "WAIT"
    tell application "Safari"
      repeat with openDocument in documents
        try
          set pageURL to URL of openDocument
          if pageURL is "https://chatgpt.com" or pageURL starts with "https://chatgpt.com/" or pageURL starts with "https://chatgpt.com?" then
            set roleText to (do JavaScript roleJS in openDocument) as text
            if roleText is "DNA" then
            else
              set resultText to (do JavaScript readJS in openDocument) as text
              if resultText is not "" and resultText is not "missing value" and resultText is not "WAIT" then
                tell me to set replyText to resultText
                exit repeat
              end if
            end if
          end if
        on error errorText number errorNumber
          if errorNumber is 8 or errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
        end try
      end repeat
    end tell
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then
      my writeProgress(progressPath, "90")
      return "REPLY" & linefeed & replyText
    end if
  end repeat
  error "ChatGPT did not finish a reply"
end run

on runImage(argv)
  if item 1 of argv is not "Safari" then error "Unsupported browser"
  set providedFill to item 2 of argv
  set providedRead to item 3 of argv
  set maxAttempts to (item 4 of argv) as integer
  if maxAttempts < 1 or maxAttempts > 600 then error "Invalid timeout"
  tell application "Safari"
    activate
    set imageDocument to make new document with properties {URL:"https://chatgpt.com/"}
  end tell
  set imageSubmitted to false
  repeat with attempt from 1 to 30
    delay 1
    tell application "Safari"
      if (URL of imageDocument) does not start with "https://chatgpt.com/" then return "LOGIN"
      set actionStatus to do JavaScript providedFill in imageDocument
    end tell
    if actionStatus is "SUBMITTED" then
      set imageSubmitted to true
      exit repeat
    end if
  end repeat
  if imageSubmitted is false then return "LOGIN"
  repeat with attempt from 1 to maxAttempts
    delay 1
    tell application "Safari"
      if (URL of imageDocument) does not start with "https://chatgpt.com/" then return "LOGIN"
      set replyText to do JavaScript providedRead in imageDocument
    end tell
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then return "REPLY" & linefeed & replyText
  end repeat
  error "ChatGPT did not finish a reply. The existing project has been preserved."
end runImage
