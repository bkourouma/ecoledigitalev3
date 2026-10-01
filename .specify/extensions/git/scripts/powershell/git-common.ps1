#!/usr/bin/env pwsh
# Git-specific common functions for the git extension.
# Extracted from scripts/powershell/common.ps1 — contains only git-specific
# branch validation and detection logic.

function Test-HasGit {
    param([string]$RepoRoot = (Get-Location))
    try {
        if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { return $false }
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
        git -C $RepoRoot rev-parse --is-inside-work-tree 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Get-SpecKitEffectiveBranchName {
    param([string]$Branch)
    if ($Branch -match '^([^/]+)/([^/]+)$') {
        return $Matches[2]
    }
    return $Branch
}

function Test-FeatureBranch {
    param(
        [string]$Branch,
        [bool]$HasGit = $true
    )

    # For non-git repos, we can't enforce branch naming but still provide output
    if (-not $HasGit) {
        Write-Warning "[specify] Warning: Git repository not detected; skipped branch validation"
        return $true
    }

    $raw = $Branch
    $Branch = Get-SpecKitEffectiveBranchName $raw

    # Accept sequential prefix (3+ digits) but exclude malformed timestamps
    # Malformed: 7-or-8 digit date + 6-digit time with no trailing slug (e.g. "2026031-143022" or "20260319-143022")
    $hasMalformedTimestamp = ($Branch -match '^[0-9]{7}-[0-9]{6}-') -or ($Branch -match '^(?:\d{7}|\d{8})-\d{6}$')
    $isSequential = ($Branch -match '^[0-9]{3,}-') -and (-not $hasMalformedTimestamp)
    if (-not $isSequential -and $Branch -notmatch '^\d{8}-\d{6}-') {
        [Console]::Error.WriteLine("ERROR: Not on a feature branch. Current branch: $raw")
        [Console]::Error.WriteLine("Feature branches should be named like: 001-feature-name, 1234-feature-name, or 20260319-143022-feature-name")
        return $false
    }
    return $true
}

# Specs directory (relative to the repo root, or absolute).
# Priority: SPECIFY_SPECS_DIR env var > "specs_dir" in .specify/init-options.json > "specs".
function Get-SpecsDir {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $setting = 'specs'
    if (-not [string]::IsNullOrWhiteSpace($env:SPECIFY_SPECS_DIR)) {
        $setting = $env:SPECIFY_SPECS_DIR.Trim()
    } else {
        $opts = Join-Path (Join-Path $RepoRoot '.specify') 'init-options.json'
        if (Test-Path -LiteralPath $opts -PathType Leaf) {
            try {
                $cfg = (Get-Content -LiteralPath $opts -Raw) | ConvertFrom-Json
                $value = $cfg.specs_dir
                if (($value -is [string]) -and (-not [string]::IsNullOrWhiteSpace($value))) {
                    $setting = $value.Trim()
                }
            } catch { }
        }
    }
    if (-not [System.IO.Path]::IsPathRooted($setting)) {
        $setting = Join-Path $RepoRoot $setting
    }
    return [System.IO.Path]::GetFullPath($setting)
}
