param(
 [Parameter(Mandatory=$true)][ValidateSet('backup','apply')][string]$Mode,
 [string]$BackupDirectory
)
$ErrorActionPreference='Stop'
$budgetWorkspace=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $budgetWorkspace
$budgetCacheRoot=[IO.Path]::GetFullPath((Join-Path $budgetWorkspace '.cache/db-activation'))+[IO.Path]::DirectorySeparatorChar
$budgetOperator=[Security.Principal.WindowsIdentity]::GetCurrent().User
$budgetSystem=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if($Mode -eq 'backup'){
 if($BackupDirectory){throw 'Backup mode creates its own private directory.'}
 $BackupDirectory=Join-Path $budgetCacheRoot ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-budget-additions')
 New-Item -ItemType Directory -Path $BackupDirectory -ErrorAction Stop | Out-Null
 $budgetAcl=[Security.AccessControl.DirectorySecurity]::new()
 $budgetAcl.SetAccessRuleProtection($true,$false)
 $budgetAcl.SetOwner($budgetOperator)
 foreach($budgetSid in @($budgetOperator,$budgetSystem)){
  $budgetAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($budgetSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 Set-Acl -LiteralPath $BackupDirectory -AclObject $budgetAcl
}else{
 if(-not $BackupDirectory){throw 'An existing verified backup directory is required.'}
 $BackupDirectory=[IO.Path]::GetFullPath($BackupDirectory)
}
if(-not $BackupDirectory.StartsWith($budgetCacheRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Backup path is outside the intended workspace directory.'}
$budgetDir=Get-Item -LiteralPath $BackupDirectory
if($budgetDir.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Backup directory must not be a link.'}
$budgetAccess=Get-Acl -LiteralPath $BackupDirectory
$budgetAllowed=@($budgetOperator.Value,$budgetSystem.Value)
if(-not $budgetAccess.AreAccessRulesProtected){throw 'Backup directory permissions must be private.'}
foreach($budgetRule in $budgetAccess.Access){
 if($budgetRule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $budgetAllowed -or $budgetRule.AccessControlType -ne 'Allow'){throw 'Unexpected backup directory permissions.'}
}
Write-Output '{"phase":"private-backup-acl-verified"}'
if($Mode -eq 'backup'){
 & node scripts/activate-budget-additions.cjs backup $BackupDirectory
 exit $LASTEXITCODE
}
# Capture only the normal HabitCents server; never stop preview or unrelated listeners.
$budgetListeners=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
$budgetOldProcess=$null
$budgetNodePath=(Get-Command node -ErrorAction Stop).Source
if($budgetListeners.Count){
 $budgetOwners=@($budgetListeners.OwningProcess | Select-Object -Unique)
 if($budgetOwners.Count -ne 1){throw 'The local application listener is ambiguous.'}
 $budgetApp=Get-CimInstance Win32_Process -Filter "ProcessId=$($budgetOwners[0])"
 if($budgetApp.Name -ne 'node.exe' -or ([string]$budgetApp.CommandLine).Contains('preview-server.js') -or ([string]$budgetApp.CommandLine) -notmatch '(?<!preview-)server\.js'){throw 'The port-3000 process is not the verified application server.'}
 $budgetOldProcess=Get-Process -Id $budgetOwners[0]
 $budgetOldStarted=$budgetOldProcess.StartTime.ToUniversalTime().Ticks
 $budgetNodePath=$budgetApp.ExecutablePath
}
# The script uses its own short database write locks and verifies data before COMMIT.
& node scripts/activate-budget-additions.cjs apply $BackupDirectory
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& node scripts/activate-budget-additions.cjs verify $BackupDirectory
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($budgetOldProcess){
 $budgetCurrent=Get-Process -Id $budgetOldProcess.Id -ErrorAction Stop
 if($budgetCurrent.StartTime.ToUniversalTime().Ticks -ne $budgetOldStarted){throw 'The server process changed; database migration succeeded but reload stopped.'}
 $budgetCurrentListeners=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop)
 if($budgetOldProcess.Id -notin $budgetCurrentListeners.OwningProcess){throw 'The server listener changed; database migration succeeded but reload stopped.'}
 Stop-Process -Id $budgetOldProcess.Id -ErrorAction Stop
 $budgetOldProcess.WaitForExit(5000) | Out-Null
}
$budgetHandler=[Net.Http.HttpClientHandler]::new()
$budgetHandler.AllowAutoRedirect=$false
$budgetHttp=[Net.Http.HttpClient]::new($budgetHandler)
$budgetHttp.Timeout=[TimeSpan]::FromSeconds(4)
try{
 $budgetAppStarted=$false
 # A development watcher may restart the process on its own.
 Start-Sleep -Milliseconds 700
 if(-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)){
  $budgetNewProcess=Start-Process -FilePath $budgetNodePath -ArgumentList 'server.js' -WorkingDirectory $budgetWorkspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $BackupDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $BackupDirectory 'server.stderr.log') -PassThru
  $budgetNewProcess.Id | Set-Content -LiteralPath (Join-Path $BackupDirectory 'server.pid')
 }
 for($budgetAttempt=0;$budgetAttempt -lt 15;$budgetAttempt++){
  try{
   $budgetLogin=$budgetHttp.GetAsync('http://127.0.0.1:3000/login').GetAwaiter().GetResult()
   $budgetEndpoint=$budgetHttp.GetAsync('http://127.0.0.1:3000/api/budget/additions?month=2024-01').GetAwaiter().GetResult()
   if([int]$budgetLogin.StatusCode -eq 200 -and [int]$budgetEndpoint.StatusCode -eq 302 -and [string]$budgetEndpoint.Headers.Location -match '^/login(?:\?|$)'){$budgetAppStarted=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 1000
 }
 if(-not $budgetAppStarted){throw 'Migration succeeded, but local server readiness could not be verified.'}
 Write-Output '{"phase":"local-app-reloaded","loginReady":true,"newRouteRegistered":true,"authenticatedTestWrites":false}'
}finally{$budgetHttp.Dispose();$budgetHandler.Dispose()}
