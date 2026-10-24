-- Use the signed-in Safari profile. Do not read cookies, passwords, or storage.
on run argv
  if (count of argv) is not 2 then error "Expected browser name and prompt"
  set browserName to item 1 of argv
  set promptLiteral to item 2 of argv
  if browserName is not "Safari" then error "Unsupported browser"
  set fillJS to "(function(){var prompt=" & promptLiteral & ";var e=document.querySelector('#prompt-textarea, [data-testid='prompt-textarea'], [contenteditable='true'][role='textbox']');if(!e)return 'WAIT';e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(e,prompt);e.dispatchEvent(new Event('input',{bubbles:true}));}else{document.execCommand('selectAll',false,null);if(!document.execCommand('insertText',false,prompt))e.textContent=prompt;e.dispatchEvent(new Event('input',{bubbles:true}));}var b=document.querySelector('button[data-testid='send-button'], button[data-testid='composer-send-button'], #composer-submit-button, button[aria-label='Send prompt'], button[aria-label='Send message'], button[aria-label='Verzenden']');if(!b){var f=e.closest('form');if(f)b=f.querySelector('button');}if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';b.click();return 'SUBMITTED';})()"
  set readJS to "(function(){var stop=document.querySelector('button[data-testid='stop-button']');var nodes=document.querySelectorAll('[data-message-author-role='assistant']');if(!nodes.length||stop)return 'WAIT';var text=(nodes[nodes.length-1].innerText||'').trim();if(!text)return 'WAIT';return text;})()"
  tell application "Safari"
    activate
    set chatDocument to missing value
    repeat with openDocument in documents
      try
        if (URL of openDocument) starts with "https://chatgpt.com/" then
          set chatDocument to openDocument
          exit repeat
        end if
      end try
    end repeat
    if chatDocument is missing value then set chatDocument to make new document with properties {URL:"https://chatgpt.com/"}
  end tell
  set submitted to false
  repeat with attempt from 1 to 25
    delay 1
    tell application "Safari"
      if (URL of chatDocument) does not start with "https://chatgpt.com/" then return "LOGIN"
      try
        set actionStatus to do JavaScript fillJS in chatDocument
      on error errorText number errorNumber
        if errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
        set actionStatus to "WAIT"
      end try
    end tell
    if actionStatus is "SUBMITTED" then
      set submitted to true
      exit repeat
    end if
  end repeat
  if submitted is false then return "LOGIN"
  repeat with attempt from 1 to 90
    delay 1
    tell application "Safari"
      try
        set replyText to do JavaScript readJS in chatDocument
      on error errorText number errorNumber
        if errorNumber is 12 or errorNumber is -1743 then error errorText number errorNumber
        set replyText to "WAIT"
      end try
    end tell
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then return "REPLY" & linefeed & replyText
  end repeat
  error "ChatGPT did not finish a reply"
end run
