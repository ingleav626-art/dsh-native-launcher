<#
  每核频率/性能采样：在被节流的进程跑动期间，找出「正在跑它的那个核」并看该核的
  % Processor Performance / % Processor Utility / Processor Frequency。

  判据：
    被节流相 %Processor Performance 掉到 ~25% → 降频（P-state 压制）
    被节流相 %Processor Performance 仍 ~100% 但吞吐掉 4 倍 → 换了核型（E-core）

  用法：pwsh -File tools/probe/counter-sample.ps1 -Seconds 50 -Out <文件>
#>
param([int]$Seconds = 50, [int]$IntervalMs = 1000, [string]$Out = "$PSScriptRoot\out\counters.log")

$counters = @(
  '\Processor Information(*)\% Processor Time',
  '\Processor Information(*)\% Processor Performance',
  '\Processor Information(*)\% Processor Utility',
  '\Processor Information(*)\Processor Frequency'
)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
$n = [int]($Seconds * 1000 / $IntervalMs)
for ($i = 0; $i -lt $n; $i++) {
  $t = Get-Date -Format 'HH:mm:ss'
  $s = Get-Counter -Counter $counters -MaxSamples 1 -ErrorAction SilentlyContinue
  if (-not $s) { Start-Sleep -Milliseconds $IntervalMs; continue }
  $byCore = @{}
  $tot = @{}
  foreach ($x in $s.CounterSamples) {
    if ($x.Path -notmatch '\(([^)]+)\)\\(.+)$') { continue }
    $inst = $Matches[1]
    $name = $Matches[2]
    if ($inst -eq '_Total') { $tot[$name] = $x.CookedValue; continue }
    if (-not $byCore.ContainsKey($inst)) { $byCore[$inst] = @{} }
    $byCore[$inst][$name] = $x.CookedValue
  }
  $busy = $byCore.GetEnumerator() | Sort-Object { [double]$_.Value['% Processor Time'] } -Descending | Select-Object -First 1
  $line = if ($busy) {
    't={0} busy={1} cpu={2:N1} perf={3:N1} util={4:N1} freq={5:N0} | total perf={6:N1} util={7:N1} cpu={8:N1}' -f `
      $t, $busy.Key, $busy.Value['% Processor Time'], $busy.Value['% Processor Performance'], $busy.Value['% Processor Utility'], $busy.Value['Processor Frequency'], `
      $tot['% Processor Performance'], $tot['% Processor Utility'], $tot['% Processor Time']
  } else { "t=$t (无样本)" }
  Add-Content -Path $Out -Value $line -Encoding UTF8
  Write-Output $line
  Start-Sleep -Milliseconds $IntervalMs
}
