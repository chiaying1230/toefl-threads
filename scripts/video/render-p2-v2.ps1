param([ValidateSet('audit','stills','phone','render')][string]$Mode='render')
$env:PLAYWRIGHT_MODULE='C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
$env:CHROMIUM_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:FFMPEG_PATH='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe'
$env:FFPROBE_PATH='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffprobe-win64.exe'
$outputDir=if($Mode -eq 'phone') {'docs/p2-v2/phone'} else {'docs/p2-v2'}
$renderArgs=@('scripts/make-video.mjs','scripts/video/episodes/p2-v2.json','--out',$outputDir)
if($Mode -eq 'audit') { $renderArgs+=@('--audit','--beats') }
if($Mode -eq 'stills') { $renderArgs+=@('--stills','0,0.8,2.4,5,9.8,13.5,16.5,20.5,24.5,27,30,33,35') }
if($Mode -eq 'phone') { $renderArgs+=@('--phone','--stills','0.8,13.5,24.5,27,30,33,35') }
& node @renderArgs
exit $LASTEXITCODE
