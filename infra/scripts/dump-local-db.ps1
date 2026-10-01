# Dump the local Postgres DB (with demo data) for restore on the VPS.
#
# Usage (from the repo root in PowerShell):
#   .\infra\scripts\dump-local-db.ps1
#
# Output: infra/scripts/dumps/ecoledigitale-YYYYMMDD-HHMMSS.dump  (custom format)
#
# Then SCP the file to the server and run restore-db-on-server.sh:
#   scp <dump> deployer@147.93.44.169:/tmp/ecoledigitale.dump
#   ssh deployer@147.93.44.169 "/opt/ecoledigitale/infra/scripts/restore-db-on-server.sh /tmp/ecoledigitale.dump"

param(
    [string]$DbHost     = "localhost",
    [int]   $DbPort     = 5432,
    [string]$DbName     = "dbecoledigitale",
    [string]$DbUser     = "postgres",
    [string]$DbPassword = $env:PGPASSWORD
)

$ErrorActionPreference = "Stop"

if (-not $DbPassword) {
    throw "Mot de passe Postgres requis : definir PGPASSWORD ou passer -DbPassword."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$dumpDir  = Join-Path $repoRoot "infra\scripts\dumps"
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dumpFile  = Join-Path $dumpDir "ecoledigitale-$timestamp.dump"

$env:PGPASSWORD = $DbPassword
try {
    Write-Host "Dumping $DbName from $DbHost`:$DbPort -> $dumpFile"
    pg_dump `
        --host=$DbHost `
        --port=$DbPort `
        --username=$DbUser `
        --dbname=$DbName `
        --format=custom `
        --no-owner `
        --no-privileges `
        --file="$dumpFile"

    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }

    $size = (Get-Item $dumpFile).Length / 1MB
    Write-Host ("Dump complete: {0} ({1:N1} MB)" -f $dumpFile, $size)
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  scp `"$dumpFile`" deployer@147.93.44.169:/tmp/ecoledigitale.dump"
    Write-Host "  ssh deployer@147.93.44.169 `"/opt/ecoledigitale/infra/scripts/restore-db-on-server.sh /tmp/ecoledigitale.dump`""
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
