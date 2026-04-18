#!/usr/bin/env pwsh
# scripts/add-vercel-preview-env.ps1
#
# Helper: copy production env vars to the preview environment for the linked
# Vercel project. Reads the value from production (via `vercel env pull`) so
# no secrets need to live in this script.
#
# Usage (from repo root):
#   pwsh -File ./scripts/add-vercel-preview-env.ps1
#
# Prereqs:
#   - vercel CLI installed and logged in
#   - repo linked to project (vercel link)

param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

$tmp = ".env.production.tmp"
vercel env pull $tmp --environment=production --yes | Out-Null

$auth = Get-Content "$env:APPDATA\com.vercel.cli\Data\auth.json" | ConvertFrom-Json
$proj = Get-Content .vercel/project.json | ConvertFrom-Json
$hdr  = @{ Authorization = "Bearer $($auth.token)"; "Content-Type" = "application/json" }
$base = "https://api.vercel.com/v10/projects/$($proj.projectId)/env?teamId=$($proj.orgId)&upsert=true"

Get-Content $tmp | Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=' } | ForEach-Object {
  $kv   = $_ -split '=', 2
  $key  = $kv[0]
  $val  = $kv[1].Trim('"')
  $body = @{ key = $key; value = $val; type = 'encrypted'; target = @('preview') } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post -Uri $base -Headers $hdr -Body $body | Out-Null
    Write-Host "ok  $key (preview)"
  } catch {
    Write-Host "err $key : $($_.Exception.Message)"
  }
}

Remove-Item $tmp -Force -ErrorAction SilentlyContinue
