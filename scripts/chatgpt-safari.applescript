-- Use the user's existing Safari profile; submit only, never read model output.
on run argv
  if (count of argv) is not 2 then error "Expected ChatGPT URL and script"
  set targetURL to item 1 of argv
  set sendJS to item 2 of argv
  -- The Node launcher passes exactly two arguments following the script file.
  if targetURL does not start with "https://chatgpt.com/?prompt=" then error "Unexpected ChatGPT URL"
  tell application "Safari"
    set chatDocument to make new document with properties {URL:targetURL}
    repeat with attempt from 1 to 65
      delay 1
      try
        if (URL of chatDocument) starts with "https://chatgpt.com/" then
          set actionStatus to do JavaScript sendJS in chatDocument
          if actionStatus is "SUBMITTED" then return "SUBMITTED"
        end if
      on error errorText number errorNumber
        if errorNumber is -1743 then error "macOS denied Safari Automation access" number errorNumber
      end try
    end repeat
  end tell
  error "ChatGPT composer did not become ready. Check Safari login and JavaScript from Apple Events."
end run
