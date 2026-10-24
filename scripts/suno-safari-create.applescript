-- Fill and create on suno.com in the user's normal Safari.
-- Never runs on accounts.google.com. A Google sign-in page returns LOGIN.
-- An optional album cover is chosen through Safari's file dialog after Create.
on run argv
	local sendJS, coverJS, coverPath, targetTab, lastStatus, actionStatus, clickedCreate, tabIndex
	if (count of argv) is 2 or (count of argv) is 3 then
		if item 1 of argv is "harvest" then
			set coverJS to item 2 of argv
			set coverPath to ""
			if (count of argv) is 3 then set coverPath to item 3 of argv
			return my harvestClips(coverJS, coverPath)
		end if
	end if
	if (count of argv) is not 1 and (count of argv) is not 3 then error "Expected Suno page script"
	set sendJS to item 1 of argv
	set coverJS to ""
	set coverPath to ""
	if (count of argv) is 3 then
		set coverJS to item 2 of argv
		set coverPath to item 3 of argv
	end if
	tell application "Safari"
		activate
		set targetTab to my tabFromLocation(my sunoLocation())
		if targetTab is missing value then
			make new document with properties {URL:"https://suno.com/create"}
			set targetTab to current tab of front window
		end if
		set lastStatus to "MISSING:lyrics"
		repeat with attempt from 1 to 20
			delay 0.5
			if (URL of targetTab) starts with "https://accounts.google.com/" then return "LOGIN"
			if (URL of targetTab) starts with "https://suno.com/sign-in" then return "LOGIN"
			if (URL of targetTab) starts with "https://suno.com/create" then
				try
					set actionStatus to do JavaScript sendJS in targetTab
					if actionStatus is "READY" then
						set clickedCreate to false
						tell application "System Events"
							tell process "Safari"
								repeat with safariWindow in windows
									if name of safariWindow contains "Suno" then
										click button "Create song" of UI element 1 of scroll area 1 of group 1 of group 1 of tab group 1 of splitter group 1 of safariWindow
										set clickedCreate to true
										exit repeat
									end if
								end repeat
							end tell
						end tell
						if clickedCreate is false then return "NOBUTTON"
						if coverPath is "" then return "CREATED"
						return my attachCover(targetTab, coverJS, coverPath)
					end if
					if actionStatus is "LOGIN" or actionStatus is "CREATED" or actionStatus is "FILLED" then return actionStatus
					if actionStatus is "DISABLED" or actionStatus is "WAIT" or actionStatus is "NOBUTTON" or actionStatus is "WRONG_HOST" or actionStatus starts with "MISSING:" then set lastStatus to actionStatus
				on error errorText number errorNumber
					if errorNumber is -1743 then error "macOS denied Safari Automation access" number errorNumber
					if errorText contains "JavaScript" or errorText contains "Apple Events" then error errorText number errorNumber
				end try
			end if
		end repeat
	end tell
	return lastStatus
end run

on attachCover(targetTab, coverJS, coverPath)
	local savedCount, waits, saveJS, coverStatus, saved
	set savedCount to 0
	set waits to 0
	set saveJS to "(()=>{const dialog=document.querySelector('[role=dialog]');if(!dialog)return'NO_FILE';const label=el=>((el.getAttribute('aria-label')||el.innerText||'').replace(/\\s+/g,' ').trim());const save=[...dialog.querySelectorAll('button')].find(el=>label(el)==='Save');if(!save||save.disabled)return'NO_FILE';save.click();return'SAVED';})()"
	repeat with attempt from 1 to 30
		delay 0.8
		tell application "Safari"
			set coverStatus to do JavaScript coverJS in targetTab
		end tell
		if coverStatus is "COVER_OPEN" then
			set waits to 0
			tell application "Safari" to activate
			ignoring application responses
				tell application "Safari" to do JavaScript "document.getElementById('blossom-cover-file').click()" in targetTab
			end ignoring
			delay 1
			tell application "System Events"
				tell process "Safari"
					keystroke "g" using {command down, shift down}
					delay 0.8
					keystroke coverPath
					delay 0.2
					keystroke return
					delay 0.7
					keystroke return
				end tell
			end tell
			delay 1
			tell application "Safari"
				set saved to do JavaScript saveJS in targetTab
			end tell
			if saved is "SAVED" then set savedCount to savedCount + 1
		else if coverStatus is "COVER_WAIT" then
			set waits to waits + 1
			if savedCount > 0 and waits > 4 then exit repeat
		else
			exit repeat
		end if
	end repeat
	if savedCount > 0 then return "CREATED_COVER"
	return "CREATED_NOCOVER"
end attachCover

on harvestClips(coverJS, coverPath)
	local targetTab, clipStatus, artCount, audioPaths, seenPaths, found, summary, onePath, saved, tabIndex
	set artCount to 0
	set audioPaths to {}
	set seenPaths to my listMp3()
	set targetTab to my tabFromLocation(my sunoLocation())
	if targetTab is missing value then return "WRONG_HOST"
	tell application "Safari"
		if (URL of targetTab) does not start with "https://suno.com/create" then return "WRONG_HOST"
		repeat with attempt from 1 to 80
			delay 1.5
			if (URL of targetTab) does not start with "https://suno.com/" then return "WRONG_HOST"
			set clipStatus to do JavaScript coverJS in targetTab
			if clipStatus is "COVER_OPEN" then
				if coverPath is not "" then
					set saved to my chooseCover(targetTab, coverPath)
					if saved is "SAVED" then set artCount to artCount + 1
					if saved is not "SAVED" then tell application "System Events" to key code 53
				end if
			else if clipStatus is "DOWNLOAD_CLICKED" then
				set found to my waitForMp3(seenPaths, audioPaths)
				if found is not "" then
					set end of audioPaths to found
					set end of seenPaths to found
					do JavaScript my markDownloadedJS() in targetTab
				else
					do JavaScript my retryDownloadJS() in targetTab
				end if
			else if clipStatus is "CLIPS_DONE" then
				exit repeat
			else if clipStatus is "CLIP_WAIT" or clipStatus is "COVER_WAIT" then
				-- Generation is still running, or the next menu has not opened.
			else
				exit repeat
			end if
		end repeat
	end tell
	if artCount > 0 then
		set summary to "CREATED_COVER"
	else if coverPath is "" then
		set summary to "CREATED"
	else
		set summary to "CREATED_NOCOVER"
	end if
	repeat with onePath in audioPaths
		set summary to summary & linefeed & onePath
	end repeat
	return summary
end harvestClips

on sunoLocation()
	tell application "Safari"
		repeat with windowIndex from 1 to (count of windows)
			repeat with tabIndex from 1 to (count of tabs of window windowIndex)
				if (URL of tab tabIndex of window windowIndex) starts with "https://suno.com/create" then
					set current tab of window windowIndex to tab tabIndex of window windowIndex
					return (windowIndex as integer as text) & ":" & (tabIndex as integer as text)
				end if
			end repeat
		end repeat
	end tell
	return ""
end sunoLocation

on tabFromLocation(place)
	if place is "" then return missing value
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to ":"
	set windowIndex to (text item 1 of place) as integer
	set tabIndex to (text item 2 of place) as integer
	set AppleScript's text item delimiters to previousDelimiters
	tell application "Safari" to return tab tabIndex of window windowIndex
end tabFromLocation

on chooseCover(targetTab, coverPath)
	local saved, chosen, sheetReady, waitSheet
	tell application "Safari"
		set sunoWindow to first window whose name starts with "Suno"
		set index of sunoWindow to 1
		activate
		ignoring application responses
			do JavaScript "(function(){var dialog=document.querySelector('[role=dialog]');var upload=dialog&&[].slice.call(dialog.querySelectorAll('button')).find(function(el){return (el.innerText||'').replace(/\\s+/g,' ').trim()==='Upload';});if(upload){upload.click();return;}var input=document.getElementById('blossom-cover-file');if(input)input.click();})()" in targetTab
		end ignoring
	end tell
	set sheetReady to false
	repeat with waitSheet from 1 to 12
		delay 0.4
		tell application "System Events" to tell process "Safari" to if (count of sheets of window 1) > 0 then set sheetReady to true
		if sheetReady then exit repeat
	end repeat
	if sheetReady is false then
		tell application "Safari"
			ignoring application responses
				do JavaScript "(function(){var dialog=document.querySelector('[role=dialog]');var upload=dialog&&[].slice.call(dialog.querySelectorAll('button')).find(function(el){return (el.innerText||'').replace(/\\s+/g,' ').trim()==='Upload';});if(upload)upload.click();})()" in targetTab
			end ignoring
		end tell
		repeat with waitSheet from 1 to 12
			delay 0.4
			tell application "System Events" to tell process "Safari" to if (count of sheets of window 1) > 0 then set sheetReady to true
			if sheetReady then exit repeat
		end repeat
	end if
	if sheetReady is false then return "NO_FILE"
	tell application "System Events"
		tell process "Safari"
			set frontmost to true
			if name of window 1 does not start with "Suno" then return "NO_FILE"
			keystroke "g" using {command down, shift down}
			delay 0.7
			keystroke "a" using {command down}
			keystroke coverPath
			delay 0.3
			keystroke return
		end tell
	end tell
	delay 0.8
	tell application "System Events"
		tell process "Safari"
			set chosen to false
			repeat with chooseAttempt from 1 to 8
				try
					set uploadButton to button "Upload" of UI element 1 of sheet 1 of window "Suno | AI Music"
					if enabled of uploadButton is true then
						click uploadButton
						set chosen to true
						exit repeat
					end if
				end try
				delay 0.4
			end repeat
		end tell
	end tell
	if chosen is false then return "NO_FILE"
	delay 1.2
	set saved to "WAIT"
	tell application "Safari"
		repeat with saveAttempt from 1 to 16
			set saved to do JavaScript "(()=>{const dialog=document.querySelector('[role=dialog]');if(!dialog)return'CLOSED';const label=el=>((el.getAttribute('aria-label')||el.innerText||'').replace(/\\s+/g,' ').trim());const save=[...dialog.querySelectorAll('button')].find(el=>label(el)==='Save');if(!save||save.disabled)return'WAIT';save.click();const row=document.querySelector('[data-testid=clip-row][data-blossom-step=details]');if(row)row.dataset.blossomStep='saved';return'SAVING';})()" in targetTab
			if saved is "SAVING" or saved is "CLOSED" then exit repeat
			delay 0.5
		end repeat
		if saved is "SAVING" then
			repeat with closeAttempt from 1 to 8
				delay 0.6
				set saved to do JavaScript "(()=>{return document.querySelector('[role=dialog]')?'OPEN':'CLOSED';})()" in targetTab
				if saved is "CLOSED" then exit repeat
			end repeat
		end if
	end tell
	if saved is "CLOSED" then return "SAVED"
	return "NO_FILE"
end chooseCover

on markDownloadedJS()
	return "(function(){var row=document.querySelector('[data-testid=clip-row][data-blossom-step=downloading]');if(row){row.dataset.blossomDone='1';row.removeAttribute('data-blossom-step');}return 'MARKED';})()"
end markDownloadedJS

on retryDownloadJS()
	return "(function(){var row=document.querySelector('[data-testid=clip-row][data-blossom-step=downloading]');if(row)row.dataset.blossomStep='audio';return 'RETRY';})()"
end retryDownloadJS

on listMp3()
	local downloadsFolder, listing
	set downloadsFolder to POSIX path of (path to downloads folder)
	try
		set listing to do shell script "find " & quoted form of downloadsFolder & " -maxdepth 1 -type f -name '*.mp3'"
		return paragraphs of listing
	on error
		return {}
	end try
end listMp3

on waitForMp3(seenPaths, audioPaths)
	local downloadsFolder, attempt, listing, onePath, ignored, firstSize, secondSize, header
	set downloadsFolder to POSIX path of (path to downloads folder)
	repeat with attempt from 1 to 30
		delay 1
		try
			set listing to paragraphs of (do shell script "find " & quoted form of downloadsFolder & " -maxdepth 1 -type f -name '*.mp3'")
		on error
			set listing to {}
		end try
		repeat with onePath in listing
			set ignored to false
			repeat with seenPath in seenPaths
				if seenPath as text is equal to onePath as text then set ignored to true
			end repeat
			repeat with seenPath in audioPaths
				if seenPath as text is equal to onePath as text then set ignored to true
			end repeat
			if ignored is false and onePath as text is not "" then
				try
					set firstSize to do shell script "stat -f %z " & quoted form of (onePath as text)
					delay 1
					set secondSize to do shell script "stat -f %z " & quoted form of (onePath as text)
					if firstSize is equal to secondSize and (firstSize as number) > 128 then
						set header to do shell script "od -An -t x1 -N 2 " & quoted form of (onePath as text) & " | tr -d ' \n'"
						if header starts with "4944" or header starts with "ff" then return onePath as text
					end if
				end try
			end if
		end repeat
	end repeat
	return ""
end waitForMp3
