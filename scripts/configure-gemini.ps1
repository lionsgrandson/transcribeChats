$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
$examplePath = Join-Path $root '.env.example'

if (-not (Test-Path $envPath)) {
    if (-not (Test-Path $examplePath)) { throw '.env.example is missing.' }
    Copy-Item $examplePath $envPath
}

$secureKey = Read-Host 'Gemini API key' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }

if ([string]::IsNullOrWhiteSpace($key) -or $key.Length -lt 20) {
    throw 'Gemini API key is empty or does not look valid.'
}

$content = [IO.File]::ReadAllText($envPath)
function Set-EnvValue([string]$Text, [string]$Name, [string]$Value) {
    $pattern = '(?m)^\s*' + [regex]::Escape($Name) + '\s*=.*$'
    $replacement = "$Name=$Value"
    if ([regex]::IsMatch($Text, $pattern)) { return [regex]::Replace($Text, $pattern, $replacement, 1) }
    if ($Text.Length -gt 0 -and -not $Text.EndsWith("`n")) { $Text += "`r`n" }
    return $Text + $replacement + "`r`n"
}

$content = Set-EnvValue $content 'GEMINI_API_KEY' $key
$content = Set-EnvValue $content 'GEMINI_MODEL' 'gemini-3.8-flash'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($envPath, $content, $utf8NoBom)
Write-Host '[OK] Gemini API key saved to .env without printing it.'
Write-Host '[OK] Gemini will be used first; Ollama remains the fallback.'
