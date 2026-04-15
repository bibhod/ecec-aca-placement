Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " ECEC Portal - Database Setup" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Check if psql is available
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    # Try common PostgreSQL install paths
    $pgPaths = @(
        "C:\Program Files\PostgreSQL\15\bin\psql.exe",
        "C:\Program Files\PostgreSQL\14\bin\psql.exe",
        "C:\Program Files\PostgreSQL\16\bin\psql.exe"
    )
    foreach ($p in $pgPaths) {
        if (Test-Path $p) {
            $env:Path += ";$(Split-Path $p)"
            Write-Host "Found PostgreSQL at: $p" -ForegroundColor Green
            break
        }
    }
}

Write-Host "Creating database 'ecec_placement'..." -ForegroundColor Yellow
Write-Host "(Enter your PostgreSQL password when prompted - default is 'ecec_secret')" -ForegroundColor Gray
Write-Host ""

$env:PGPASSWORD = "ecec_secret"

# Create database
psql -U postgres -c "CREATE DATABASE ecec_placement;" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Database created successfully!" -ForegroundColor Green
} else {
    Write-Host "Database may already exist - that's OK, continuing..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Database setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Now run start-backend.bat to start the server." -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
