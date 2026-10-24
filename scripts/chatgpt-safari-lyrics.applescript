-- Work in a fresh tab using Safari's existing signed-in profile.
-- JavaScript is passed as an argument to keep selectors and prompt quoting intact.
on run argv
  if (count of argv) is not 4 then error "Expected browser, fill script, read script and timeout"
  if item 1 of argv is not "Safari" then error "Unsupported browser"
  set fillJS to item 2 of argv
  set readJS to item 3 of argv
  set maxAttempts to (item 4 of argv) as integer
  if maxAttempts < 1 or maxAttempts > 360 then error "Invalid timeout"
  tell application "Safari"
    activate
    set chatDocument to make new document with properties {URL:"https://chatgpt.com/"}
  end tell
  set submitted to false
  repeat with attempt from 1 to 30
    delay 1
    tell application "Safari"
      if (URL of chatDocument) does not start with "https://chatgpt.com/" then return "LOGIN"
      set actionStatus to do JavaScript fillJS in chatDocument
    end tell
    if actionStatus is "SUBMITTED" then
      set submitted to true
      exit repeat
    end if
  end repeat
  if submitted is false then return "LOGIN"
  repeat with attempt from 1 to maxAttempts
    delay 1
    tell application "Safari"
      if (URL of chatDocument) does not start with "https://chatgpt.com/" then return "LOGIN"
      set replyText to do JavaScript readJS in chatDocument
    end tell
    if replyText is not "WAIT" and replyText is not missing value and replyText is not "" then return "REPLY" & linefeed & replyText
  end repeat
  error "ChatGPT did not finish a reply. The existing project has been preserved."
end run
