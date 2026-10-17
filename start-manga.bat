@echo off
REM =====================================================================
REM  MangaFlow launcher - start-manga.bat   (Windows)
REM  WHY:  a web page cannot read other websites directly (browser rule called CORS). This launcher starts
REM        proxy-local.js on YOUR computer. It serves MangaFlow at http://localhost:8787 and fetches manga pages for it
REM        from your own home internet connection, which sites trust more than a free cloud proxy.
REM  HOW:  1) check that Node.js is installed, 2) go to the folder of this file, 3) open the browser, 4) run the server.
REM        Keep this black window OPEN while you read. Close it to stop.
REM  IMPROVE: pick another port when 8787 is busy, and add a Mac/Linux twin (start-manga.sh) with the same steps.
REM =====================================================================
title MangaFlow

REM WHY: Node.js runs proxy-local.js. HOW: "where node" finds it on the PATH; errorlevel 1 means it was not found.
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Get it free from https://nodejs.org  ^(choose "LTS"^), install it, then run this file again.
  echo.
  pause
  exit /b 1
)

REM WHY: the files must be found next to this launcher. HOW: %~dp0 is the folder of this .bat file; /d also switches drive.
cd /d "%~dp0"

REM WHY: save you typing the address. HOW: "start" opens the default browser; the 2-second wait lets the server come up first.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8787"

REM WHY: this is the actual server (it also acts as the proxy). It keeps running until you close this window.
node proxy-local.js

REM WHY: if the server stops with an error the window must not vanish before you can read the message.
pause
