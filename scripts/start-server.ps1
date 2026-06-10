$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Python = "python"

Set-Location $Root
& $Python .\server.py
