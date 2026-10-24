param(
 [Parameter(Mandatory=$true)][int]$TargetProcessId,
 [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference='Stop'
# This is an explicitly authorized, temporary pause. No process is killed/restarted.
$activationListener=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop
if($TargetProcessId -notin $activationListener.OwningProcess){throw 'The verified port-3000 server changed; stopping before writes.'}
$activationProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if($activationProcess.Name -ne 'node.exe' -or ([string]$activationProcess.CommandLine).Contains('preview-server.js') -or ([string]$activationProcess.CommandLine) -notmatch '(?<!preview-)server\.js'){throw 'The process is not the verified application server.'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HabitCentsActivationPause {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
 [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
 [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
}
'@
$activationHandle=[HabitCentsActivationPause]::OpenProcess(0x0800,$false,$TargetProcessId)
if($activationHandle -eq [IntPtr]::Zero){throw 'Cannot safely pause the application; no migrations attempted.'}
$activationSuspended=$false
$activationExitCode=1
$activationPreviousPause=$env:HABITCENTS_WRITE_PAUSE
try {
 if([HabitCentsActivationPause]::NtSuspendProcess($activationHandle) -ne 0){throw 'Application pause failed; no migrations attempted.'}
 $activationSuspended=$true
 Write-Output '{"phase":"local-application-paused"}'
 $env:HABITCENTS_WRITE_PAUSE='suspended-local-server'
 & node scripts/activate-reviewed.cjs apply $BackupDirectory
 $activationExitCode=$LASTEXITCODE
} finally {
 if($null -eq $activationPreviousPause){Remove-Item Env:HABITCENTS_WRITE_PAUSE -ErrorAction SilentlyContinue}else{$env:HABITCENTS_WRITE_PAUSE=$activationPreviousPause}
 if($activationSuspended){
  if([HabitCentsActivationPause]::NtResumeProcess($activationHandle) -ne 0){throw 'Application resume failed; manual resume is required.'}
  Write-Output '{"phase":"local-application-resumed"}'
 }
 [HabitCentsActivationPause]::CloseHandle($activationHandle) | Out-Null
}
exit $activationExitCode
