@echo off
REM Minimal launcher: serves the project folder via Python's HTTP server.
REM Double-click to run, then open http://localhost:8000/ in your browser.
cd /d "%~dp0"
echo Serving this folder on http://localhost:8000/
echo Press Ctrl+C to stop.
python -m http.server 8000
