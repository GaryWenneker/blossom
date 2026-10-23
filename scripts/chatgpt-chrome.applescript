-- Use the user's existing Google Chrome profile; submit only, never read model output.
on run argv
  if (count of argv) is not 2 then error "Expected ChatGPT URL and script"
  set targetURL to item 1 of argv
  set sendJS to item 2 of argv
  if targetURL does not start with "https://chatgpt.com/?prompt=" then error "Unexpected ChatGPT URL"
  tell application "Google Chrome"
    set chatWindow to make new window
    set URL of active tab of chatWindow to targetURL
    repeat with attempt from 1 to 65
      delay 1
      try
        set chatTab to active tab of chatWindow
        if (URL of chatTab) starts with "https://chatgpt.com/" then
          set actionStatus to execute chatTab javascript sendJS
          if actionStatus is "SUBMITTED" then return "SUBMITTED"
        end if
      on error errorText number errorNumber
        if errorNumber is -1743 then error "macOS denied Chrome Automation access" number errorNumber
      end try
    end repeat
  end tell
  error "ChatGPT composer did not become ready. Check Chrome login and JavaScript from Apple Events."
end run
