$ErrorActionPreference = 'Stop'
function Proteger-Arquivo([string]$Caminho) {
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($usuario)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($usuario, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
        $regra = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
        $acl.AddAccessRule($regra)
    }
    Set-Acl -LiteralPath $Caminho -AclObject $acl
}

$raiz = Join-Path $env:RUNNER_TEMP ('barberos-chave-teste-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($raiz) | Out-Null
try {
    foreach ($cliente in @('C:\Windows\System32\OpenSSH\ssh-keygen.exe', 'C:\Program Files\Git\usr\bin\ssh-keygen.exe')) {
        if (-not (Test-Path -LiteralPath $cliente)) { Write-Host ('AUSENTE: ' + $cliente); continue }
        $chave = Join-Path $raiz ([guid]::NewGuid().ToString('N'))
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $cliente
        $info.Arguments = '-q -t ed25519 -C "teste-descartavel" -N "" -f "' + $chave + '"'
        $info.UseShellExecute = $false
        $processo = [Diagnostics.Process]::Start($info)
        if (-not $processo.WaitForExit(15000)) { $processo.Kill(); throw 'Keygen nao concluiu' }
        if ($processo.ExitCode -ne 0) { throw 'Geracao falhou' }
        Write-Host ('GERACAO_OK: ' + $cliente)
        try { Proteger-Arquivo $chave; Write-Host 'ACL_OK' }
        catch { Write-Host ('ACL_FALHOU: ' + $_.Exception.GetType().FullName + ' | ' + $_.Exception.Message); continue }
        try {
            $pub = ((& $cliente -y -P 'barberos-nao-interativo' -f $chave 2>$null) -join "`n").Trim()
            if ($LASTEXITCODE -ne 0 -or $pub -cnotmatch '^ssh-ed25519 [A-Za-z0-9+/]{68}(?: [^\r\n]*)?$') { throw 'Publica derivada invalida' }
            Write-Host 'DERIVACAO_OK'
        } catch { Write-Host ('DERIVACAO_FALHOU: ' + $_.Exception.GetType().FullName + ' | ' + $_.Exception.Message) }
    }
} finally { Remove-Item -LiteralPath $raiz -Force -Recurse }
