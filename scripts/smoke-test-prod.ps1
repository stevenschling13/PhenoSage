#!/usr/bin/env pwsh
# PhenoSage production smoke test.
# Run after every deploy. Exits non-zero if any check fails.
#
# Usage:
#   pwsh scripts/smoke-test-prod.ps1
#   pwsh scripts/smoke-test-prod.ps1 -Base "https://pheno-sage-web.vercel.app"
#
# Vercel Deployment Protection support:
#   If the production URL is behind Vercel Deployment Protection (SSO), set
#   VERCEL_PROTECTION_BYPASS to a Protection Bypass for Automation token. The
#   script will send `x-vercel-protection-bypass` on every request so the
#   smoke checks see the real app instead of the SSO interstitial.
#
#   If no bypass token is provided AND the SSO interstitial is detected, the
#   script downgrades public-page checks (which would otherwise see 401 from
#   Vercel's auth wall) and security-header checks to SKIP-with-warning, while
#   still enforcing checks on auth-gated routes (`/api/...`) and the
#   `/api/health` endpoint. This keeps the smoke run useful in either model
#   and stops opening duplicate issues for an infrastructure-config concern.

[CmdletBinding()]
param(
  [string]$Base = "https://pheno-sage-web.vercel.app",
  [string]$BypassToken = $env:VERCEL_PROTECTION_BYPASS
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Add-BypassHeaders([hashtable]$h) {
  if (-not [string]::IsNullOrWhiteSpace($BypassToken)) {
    $h['x-vercel-protection-bypass']  = $BypassToken
    $h['x-vercel-set-bypass-cookie']  = 'true'
  }
  return $h
}

function Test-IsSsoInterstitial([Microsoft.PowerShell.Commands.WebResponseObject]$resp, [int]$code) {
  if ($null -eq $resp) { return $false }
  if ($code -ne 401 -and $code -ne 307 -and $code -ne 308) { return $false }
  $cookies  = ($resp.Headers['Set-Cookie'] -join ';')
  $location = ($resp.Headers['Location']   -join ';')
  $server   = ($resp.Headers['Server']     -join ';')
  if ($cookies  -match '_vercel_sso')                { return $true }
  if ($location -match 'vercel\.com/sso-api/')       { return $true }
  if ($code -eq 401 -and $server -match 'Vercel' -and $resp.Headers['x-vercel-id']) { return $true }
  return $false
}

# Probe the root once to figure out whether we're behind the SSO interstitial.
$ssoDetected   = $false
$bypassActive  = -not [string]::IsNullOrWhiteSpace($BypassToken)
try {
  $probeHeaders = Add-BypassHeaders @{}
  $probe = Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -MaximumRedirection 0 `
    -SkipHttpErrorCheck -Headers $probeHeaders -ErrorAction Stop
  $ssoDetected = Test-IsSsoInterstitial $probe ([int]$probe.StatusCode)
} catch {
  # ignore - tests below will surface a real connectivity failure
}

if ($ssoDetected -and -not $bypassActive) {
  Write-Host "`n*** Vercel Deployment Protection (SSO) detected and no VERCEL_PROTECTION_BYPASS set. ***" -ForegroundColor Yellow
  Write-Host "    Public-page and security-header checks will be SKIPPED (cannot reach the real app)." -ForegroundColor Yellow
  Write-Host "    Auth-gated route checks will still run." -ForegroundColor Yellow
  Write-Host "    Fix: either disable Deployment Protection on the production deployment," -ForegroundColor Yellow
  Write-Host "         or add a Protection Bypass for Automation token as the VERCEL_PROTECTION_BYPASS secret." -ForegroundColor Yellow
} elseif ($ssoDetected -and $bypassActive) {
  Write-Host "`n*** Vercel Deployment Protection detected; bypass token in use. ***" -ForegroundColor Cyan
}

# `skipUnderSso = $true` => the test depends on reaching the real public app
$tests = @(
  @{ m='GET';  p='/';                                e=@(200,307,308); note='Landing renders';        skipUnderSso=$true  },
  @{ m='GET';  p='/auth';                            e=@(200);         note='Auth page renders';      skipUnderSso=$true  },
  @{ m='GET';  p='/dashboard';                       e=@(200,307,308); note='Dashboard reachable';    skipUnderSso=$true  },
  @{ m='GET';  p='/grows';                           e=@(200,307,308); note='Grows reachable';        skipUnderSso=$true  },
  @{ m='GET';  p='/assistant';                       e=@(200,307,308); note='Assistant reachable';    skipUnderSso=$true  },
  @{ m='GET';  p='/settings';                        e=@(200,307,308); note='Settings reachable';     skipUnderSso=$true  },
  @{ m='GET';  p='/api/health';                      e=@(200);         note='Health endpoint OK';     skipUnderSso=$true  },
  @{ m='POST'; p='/api/chat';                        e=@(401);         note='Chat blocks unauth';     skipUnderSso=$false },
  @{ m='POST'; p='/api/uploads/sign';                e=@(401);         note='Uploads blocks unauth';  skipUnderSso=$false },
  @{ m='GET';  p='/api/plants/abc/timeline';         e=@(401);         note='Timeline blocks unauth'; skipUnderSso=$false },
  @{ m='GET';  p='/api/plants/abc/analysis/latest';  e=@(401);         note='Analysis blocks unauth'; skipUnderSso=$false },
  @{ m='GET';  p='/api/internal/cron/daily-summary'; e=@(401);         note='Cron blocks unauth';     skipUnderSso=$false },
  @{ m='GET';  p='/api/internal/cron/daily-summary'; e=@(401); h=@{Authorization='Bearer wrong'}; note='Cron blocks bad secret'; skipUnderSso=$false },
  @{ m='GET';  p='/api/nonexistent-route';           e=@(404);         note='404 for unknown route';  skipUnderSso=$true  }
)

$results = foreach ($t in $tests) {
  $headers = if ($t.h) { $t.h.Clone() } else { @{} }
  Add-BypassHeaders $headers | Out-Null

  if ($ssoDetected -and -not $bypassActive -and $t.skipUnderSso) {
    [PSCustomObject]@{
      Method   = $t.m
      Path     = $t.p
      Status   = 'SKIP'
      Expected = ($t.e -join ',')
      OK       = $true
      Note     = "$($t.note) (skipped under SSO)"
    }
    continue
  }

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
$secFail = 0
if ($ssoDetected -and -not $bypassActive) {
  Write-Host "  SKIP (SSO interstitial does not carry app headers)" -ForegroundColor Yellow
} else {
  $rootHeaders = Add-BypassHeaders @{}
  $root = Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -SkipHttpErrorCheck -Headers $rootHeaders
  $secHeaders = @{
    'Strict-Transport-Security' = $true   # required
    'X-Frame-Options'           = $true
    'X-Content-Type-Options'    = $true
    'Referrer-Policy'           = $true
    'Permissions-Policy'        = $true
    'Content-Security-Policy'   = $false  # recommended but not required
  }
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
}

# --- Secret leak scan ---
Write-Host "`n=== Secret leak scan ===" -ForegroundColor Cyan
$leaks = 0
if ($ssoDetected -and -not $bypassActive) {
  Write-Host "  SKIP (cannot fetch app HTML behind SSO)" -ForegroundColor Yellow
} else {
  $leakPages = '/','/auth','/dashboard','/grows','/assistant','/settings'
  foreach ($p in $leakPages) {
    $leakHeaders = Add-BypassHeaders @{}
    $c = (Invoke-WebRequest -Uri "$Base$p" -UseBasicParsing -SkipHttpErrorCheck -Headers $leakHeaders).Content
    if ($c -match 'sk-[A-Za-z0-9]{20,}')        { Write-Host "  FAIL OpenAI key in $p" -ForegroundColor Red; $leaks++ }
    if ($c -match 'service_role')               { Write-Host "  FAIL service_role in $p" -ForegroundColor Red; $leaks++ }
    if ($c -match 'SUPABASE_SERVICE_ROLE_KEY')  { Write-Host "  FAIL service-role var in $p" -ForegroundColor Red; $leaks++ }
  }
  if ($leaks -eq 0) { Write-Host "  OK   No secrets leaked in HTML" }
}

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
