# Run from the AgentOps repository with the Mastra CLI signed in.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $project = Get-Content -LiteralPath '.mastra-project.json' -Raw | ConvertFrom-Json
    if (!$project.projectId) { throw 'The linked project ID is missing.' }
    $deployFile = '.env.mastra-deploy'
    if (Test-Path -LiteralPath $deployFile) {
        throw "Move the existing $deployFile before deploying."
    }
    $required = @('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'MISTRAL_API_KEY')
    $localSettings = Get-Content -LiteralPath '.env'
    $deploySettings = foreach ($key in $required) {
        $entry = @($localSettings | Where-Object { $_ -match "^$key=.+" })
        if ($entry.Count -ne 1) { throw "Set exactly one value for $key in .env." }
        $entry[0]
    }
    try {
        Set-Content -LiteralPath $deployFile -Value $deploySettings
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Service build failed with exit code $LASTEXITCODE." }
        npx mastra deploy --project $project.projectId --env staging --env-file $deployFile --skip-build --workers in-process
        if ($LASTEXITCODE -ne 0) { throw "Staging deploy failed with exit code $LASTEXITCODE." }
    } finally {
        if (Test-Path -LiteralPath $deployFile) { Remove-Item -LiteralPath $deployFile }
    }
} finally {
    Pop-Location
}
