-- Submit a prefilled Studio instruction using the user's existing Safari session.
-- This script never reads ChatGPT output, cookies, storage or account data.
-- Safari requires Developer > Allow JavaScript from Apple Events (one-time).
on run argv
  if (count of argv) is not 1 then error "Expected one ChatGPT URL"
  set targetURL to item 1 of argv
  if targetURL does not start with "https://chatgpt.com/?prompt=" then error "Unexpected target URL"

  tell application "Safari"
    set chatDocument to make new document with properties {URL:targetURL}
    repeat with attempt from 1 to 65
      delay 1
      try
        if (URL of chatDocument) starts with "https://chatgpt.com/" then
          set actionStatus to do JavaScript "(function(){var e=document.querySelector('#prompt-textarea, [data-testid=prompt-textarea][contenteditable=true], [contenteditable=true][role=textbox]');if(!e)return 'WAIT';var text=(e.value||e.innerText||e.textContent||'').trim();if(!text.includes('studio_project_get')||!text.includes('studio_project_save_result'))return 'WAIT';var b=document.querySelector('button[data-testid=send-button], button[data-testid=composer-send-button], #composer-submit-button, button[aria-label=\\'Send prompt\\'], button[aria-label=\\'Send message\\'], button[aria-label=\\'Verzenden\\']');if(!b){var form=e.closest('form');if(form)b=form.querySelector('button[type=submit]')}if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return 'WAIT';b.click();return 'SUBMITTED'})()" in chatDocument
          if actionStatus is "SUBMITTED" then return "SUBMITTED"
        end if
      on error errorText number errorNumber
        if errorNumber is -1743 then error "macOS denied Automation access to Safari" number errorNumber
      end try
    end repeat
  end tell
  error "ChatGPT composer did not become ready. Check that Safari is signed in and JavaScript from Apple Events is enabled."
end run
