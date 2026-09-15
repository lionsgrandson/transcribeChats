$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
$examplePath = Join-Path $root '.env.example'

if (-not (Test-Path $envPath)) {
    if (-not (Test-Path $examplePath)) {
        throw '.env.example is missing.'
    }
    Copy-Item $examplePath $envPath
}

$secureToken = Read-Host 'Hugging Face READ token' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

if ($token -notmatch '^hf_[A-Za-z0-9]+$') {
    throw 'That does not look like a Hugging Face token. Expected a value starting with hf_.'
}

$content = [IO.File]::ReadAllText($envPath)

function Set-EnvValue([string]$Text, [string]$Name, [string]$Value) {
    $pattern = '(?m)^\s*' + [regex]::Escape($Name) + '\s*=.*$'
    $replacement = "$Name=$Value"
    if ([regex]::IsMatch($Text, $pattern)) {
        return [regex]::Replace($Text, $pattern, $replacement, 1)
    }
    if ($Text.Length -gt 0 -and -not $Text.EndsWith("`n")) {
        $Text += "`r`n"
    }
    return $Text + $replacement + "`r`n"
}

$content = Set-EnvValue $content 'INSTALL_DIARIZATION' 'true'
$content = Set-EnvValue $content 'ENABLE_DIARIZATION' 'true'
$content = Set-EnvValue $content 'PYANNOTE_MODEL' 'pyannote/speaker-diarization-community-1'
$content = Set-EnvValue $content 'PYANNOTE_DEVICE' 'cuda'
$content = Set-EnvValue $content 'PYANNOTE_TOKEN' $token

$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($envPath, $content, $utf8NoBom)

Write-Host '[OK] Hugging Face token saved without printing it.'
Write-Host '[OK] pyannote diarization is enabled for normal startup.'
