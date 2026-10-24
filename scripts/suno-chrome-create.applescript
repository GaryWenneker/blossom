-- Fill and create on suno.com in the user's normal Google Chrome.
-- Never runs on accounts.google.com. A Google sign-in page returns LOGIN.
on run argv
	if (count of argv) is not 1 then error "Expected Suno page script"
	set sendJS to item 1 of argv
	tell application "Google Chrome"
		set targetTab to missing value
		repeat with chromeWindow in windows
			set tabIndex to 0
			repeat with chromeTab in tabs of chromeWindow
				set tabIndex to tabIndex + 1
				if (URL of chromeTab) starts with "https://suno.com/create" then
					set targetTab to chromeTab
					set active tab index of chromeWindow to tabIndex
					set index of chromeWindow to 1
					exit repeat
				end if
			end repeat
			if targetTab is not missing value then exit repeat
		end repeat
		if targetTab is missing value then
			set targetWindow to make new window
			set URL of active tab of targetWindow to "https://suno.com/create"
			set targetTab to active tab of targetWindow
		end if
		repeat with attempt from 1 to 20
			delay 0.5
			if (URL of targetTab) starts with "https://accounts.google.com/" then return "LOGIN"
			if (URL of targetTab) starts with "https://suno.com/sign-in" then return "LOGIN"
			if (URL of targetTab) starts with "https://suno.com/create" then
				try
					set actionStatus to execute targetTab javascript sendJS
					if actionStatus is "LOGIN" or actionStatus is "CREATED" or actionStatus is "FILLED" or actionStatus is "NOBUTTON" or actionStatus starts with "MISSING:" or actionStatus is "WRONG_HOST" then return actionStatus
				on error errorText number errorNumber
					if errorNumber is -1743 then error "macOS denied Chrome Automation access" number errorNumber
					if errorText contains "JavaScript" then error errorText number errorNumber
				end try
			end if
		end repeat
	end tell
	return "LOGIN"
end run
