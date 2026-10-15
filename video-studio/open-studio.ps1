$ErrorActionPreference = 'Stop'
$studioRepo = Split-Path -Parent $PSScriptRoot
$studioUrl = 'http://127.0.0.1:8140/'
function Test-StudioReady {
    try {
        $session = Invoke-RestMethod ($studioUrl + 'api/session') -TimeoutSec 2
        return [bool]$session.csrf
    } catch { return $false }
}
if (-not (Test-StudioReady)) {
    $studioNode = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $studioNode -ArgumentList 'video-studio/server.mjs' -WorkingDirectory $studioRepo -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-StudioReady) { break }
    }
    if (-not (Test-StudioReady)) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show('工作室暫時無法啟動，請回到 Codex 告訴我「工作室打不開」。', 'toEfu 影片工作室') | Out-Null
        exit 1
    }
}
Start-Process $studioUrl
