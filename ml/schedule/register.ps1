# 작업 스케줄러 등록 (한 번만 실행. 다시 실행하면 덮어쓴다)
#   막차존 수집     : 매일 20:55 → ml\schedule\collect.cmd (21:00 부터 01:30 까지 모으고 저절로 끝)
#   막차존 재학습   : 매주 월요일 09:00 → ml\schedule\retrain.cmd (더 나을 때만 새 모델 활성화)
# 노트북 배터리로도 돌고, 그 시각에 컴퓨터가 꺼져 있었으면 켜진 뒤 바로 시작한다.
# 지우기: Unregister-ScheduledTask -TaskPath "\막차존\" -TaskName "수집" -Confirm:$false  (재학습도 같은 방법)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew

$tasks = @(
  @{ Name = "수집";   Cmd = "collect.cmd"; Trigger = New-ScheduledTaskTrigger -Daily -At "20:55" },
  @{ Name = "재학습"; Cmd = "retrain.cmd"; Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "09:00" }
)
foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute (Join-Path $here $t.Cmd) -WorkingDirectory $here
  Register-ScheduledTask -TaskPath "\막차존\" -TaskName $t.Name -Action $action -Trigger $t.Trigger `
    -Settings $settings -Description "lasttrain-zone ML ($($t.Cmd))" -Force | Out-Null
  $info = Get-ScheduledTaskInfo -TaskPath "\막차존\" -TaskName $t.Name
  Write-Output ("등록: \막차존\{0} → 다음 실행 {1}" -f $t.Name, $info.NextRunTime)
}
