@echo off
cd /d "%~dp0"
node dist-server\matcher-web-server.cjs
pause
