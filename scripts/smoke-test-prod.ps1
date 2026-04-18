#!/usr/bin/env pwsh
# PhenoSage production smoke test.
# Run after every deploy. Exits non-zero if any check fails.
#
# Usage:
#   pwsh scripts/smoke-test-prod.ps1
#   pwsh scripts/smoke-test-prod.ps1 -Base "https://pheno-sage-web.vercel.app"

[CmdletBinding()]
param(
  [string]$Base = "https://pheno-sage-web.vercel.app"
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$tests = @(
  @{ m='GET';  p='/';                                e=@(200,307,308); note='Landing renders' },
  @{ m='GET';  p='/auth';                            e=@(200);         note='Auth page renders' },
  @{ m='GET';  p='/dashboard';                       e=@(200,307,308); note='Dashboard reachable' },
  @{ m='GET';  p='/grows';                           e=@(200,307,308); note='Grows reachable' },
  @{ m='GET';  p='/assistant';                       e=@(200,307,308); note='Assistant reachable' },
  @{ m='GET';  p='/settings';                        e=@(200,307,308); note='Settings reachable' },
  @{ m='GET';  p='/api/health';                      e=@(200);         note='Health endpoint OK' },
  @{ m='POST'; p='/api/chat';                        e=@(401);         note='Chat blocks unauth' },
  @{ m='POST'; p='/api/uploads/sign';                e=@(401);         note='Uploads blocks unauth' },
  @{ m='GET';  p='/api/plants/abc/timeline';         e=@(401);         note='Timeline blocks unauth' },
  @{ m='GET';  p='/api/plants/abc/analysis/latest';  e=@(401);         note='Analysis blocks unauth' },
  @{ m='GET';  p='/api/internal/cron/daily-summary'; e=@(401);         note='Cron blocks unauth' },
  @{ m='GET';  p='/api/internal/cron/daily-summary'; e=@(401); h=@{Authorization='Bearer wrong'}; note='Cron blocks bad secret' },
  @{ m='GET';  p='/api/nonexistent-route';           e=@(404);         note='404 for unknown route' }
)

$results = foreach ($t in $tests) {
  $headers = if ($t.h) { $t.h } else { @{} }
  try {
    $r = Invoke-WebRequest -Uri "$Base$($t.p)" -Method $t.m `
      -UseBasicParsing -MaximumRedirection 0 -SkipHttpErrorCheck `
      -Headers $headers -ErrorAction Stop
    $code = [int]$r.StatusCode
  } catch {
    $code = 'ERR'
  }
  $ok = $t.e -contains $code
  [PSCustomObject]@{
    Method   = $t.m
    Path     = $t.p
    Status   = $code
    Expected = ($t.e -join ',')
    OK       = $ok
    Note     = $t.note
  }
}

# --- Security headers ---
Write-Host "`n=== Security headers (root) ===" -ForegroundColor Cyan
$root = Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -SkipHttpErrorCheck
$secHeaders = @{
  'Strict-Transport-Security' = $true   # required
  'X-Frame-Options'           = $true
  'X-Content-Type-Options'    = $true
  'Referrer-Policy'           = $true
  'Permissions-Policy'        = $true
  'Content-Security-Policy'   = $false  # recommended but not required
}
$secFail = 0
foreach ($h in $secHeaders.Keys) {
  $v = $root.Headers[$h]
  if ($v) {
    Write-Host ("  OK   {0}: {1}" -f $h, ($v -join '; '))
  } elseif ($secHeaders[$h]) {
    Write-Host ("  FAIL {0}: <missing>" -f $h) -ForegroundColor Red
    $secFail++
  } else {
    Write-Host ("  WARN {0}: <missing> (recommended)" -f $h) -ForegroundColor Yellow
  }
}

# --- Secret leak scan ---
Write-Host "`n=== Secret leak scan ===" -ForegroundColor Cyan
$leakPages = '/','/auth','/dashboard','/grows','/assistant','/settings'
$leaks = 0
foreach ($p in $leakPages) {
  $c = (Invoke-WebRequest -Uri "$Base$p" -UseBasicParsing -SkipHttpErrorCheck).Content
  if ($c -match 'sk-[A-Za-z0-9]{20,}')        { Write-Host "  FAIL OpenAI key in $p" -ForegroundColor Red; $leaks++ }
  if ($c -match 'service_role')               { Write-Host "  FAIL service_role in $p" -ForegroundColor Red; $leaks++ }
  if ($c -match 'SUPABASE_SERVICE_ROLE_KEY')  { Write-Host "  FAIL service-role var in $p" -ForegroundColor Red; $leaks++ }
}
if ($leaks -eq 0) { Write-Host "  OK   No secrets leaked in HTML" }

# --- Results table ---
Write-Host "`n=== Endpoint smoke tests ===" -ForegroundColor Cyan
$results | Format-Table Method,Path,Status,Expected,OK,Note -AutoSize

$pass = ($results | Where-Object OK).Count
$fail = $results.Count - $pass
Write-Host "Endpoints: $pass passed, $fail failed."
Write-Host "Security:  $secFail required headers missing, $leaks secret leaks."

if ($fail -gt 0 -or $secFail -gt 0 -or $leaks -gt 0) {
  Write-Host "`nFAILED" -ForegroundColor Red
  exit 1
}
Write-Host "`nPASSED" -ForegroundColor Green
exit 0
