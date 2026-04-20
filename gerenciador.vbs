Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "taskkill /F /IM node.exe", 0, True
shell.Run "cmd /c timeout /t 1 /nobreak >nul", 0, True
shell.Run "cmd /c cd /d """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & """ && node manager.js", 0, False
shell.Run "http://localhost:3001"
