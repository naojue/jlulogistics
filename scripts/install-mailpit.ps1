$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$toolDirectory = Join-Path $taskRoot '.tools'
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
$releaseInfo = Invoke-RestMethod -Uri 'https://api.github.com/repos/axllent/mailpit/releases/latest'
$zipAsset = $releaseInfo.assets | Where-Object { $_.name -match 'windows-amd64\.zip$' } | Select-Object -First 1
if (-not $zipAsset -or -not $zipAsset.digest -or $zipAsset.digest -notmatch '^sha256:') { throw 'Mailpit release asset or its official SHA256 digest was not found.' }
$zipPath = Join-Path $toolDirectory $zipAsset.name
Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath
$expectedHash = $zipAsset.digest.Substring(7)
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Mailpit archive checksum mismatch.' }
Expand-Archive -LiteralPath $zipPath -DestinationPath $toolDirectory -Force
Write-Output ('Installed Mailpit ' + $releaseInfo.tag_name + ' into .tools. Run npm run mail.')
