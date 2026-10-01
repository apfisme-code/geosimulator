# Minimal launcher: serves the project folder via Python's built-in HTTP server.
# Usage: powershell -ExecutionPolicy Bypass -File .\serve.ps1
# Then open http://localhost:8000/ in your browser.

$port = 8000
$root = $PSScriptRoot
Write-Host "Serving $root on http://localhost:$port/" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Set-Location $root
python -m http.server $port
