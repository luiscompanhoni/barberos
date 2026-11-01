# Exclusivo do runner descartavel: cria e remove um usuario comum de teste.
param([string]$Fonte, [string]$CompararAnterior)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Somente no runner Windows descartavel do GitHub Actions.' }
$nome = 'bbtest' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$pasta = Join-Path $env:RUNNER_TEMP ('barberos-sem-admin-' + [guid]::NewGuid().ToString('N'))
$criado = $false
$processo = $null
try {
    $senha = ConvertTo-SecureString ([guid]::NewGuid().ToString('N') + 'aA!9') -AsPlainText -Force
    $usuario = New-LocalUser -Name $nome -Password $senha -Description 'Fixture descartavel do conector'
    $criado = $true
    Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545').Name -Member $nome
    [IO.Directory]::CreateDirectory($pasta) | Out-Null
    $acl = [IO.Directory]::GetAccessControl($pasta, [Security.AccessControl.AccessControlSections]::Access)
    $heranca = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($usuario.SID, 'Modify', $heranca, 'None', 'Allow'))
    [IO.Directory]::SetAccessControl($pasta, $acl)
    Copy-Item -LiteralPath $Fonte -Destination (Join-Path $pasta 'funcoes.ps1')
    Copy-Item -LiteralPath $CompararAnterior -Destination (Join-Path $pasta 'anterior.ps1')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'testar-chave-windows.ps1') -Destination (Join-Path $pasta 'testar.ps1')
    $credencial = [Management.Automation.PSCredential]::new(($env:COMPUTERNAME + '\' + $nome), $senha)
    $argumentos = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $pasta 'testar.ps1') + '" -ExigirUsuarioComum -Fonte "' + (Join-Path $pasta 'funcoes.ps1') + '" -CompararAnterior "' + (Join-Path $pasta 'anterior.ps1') + '" -PastaTemporaria "' + $pasta + '"'
    $stdout = Join-Path $pasta 'stdout.log'
    $stderr = Join-Path $pasta 'stderr.log'
    $processo = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argumentos -Credential $credencial -LoadUserProfile -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    if (-not $processo.WaitForExit(180000)) { $processo.Kill(); throw 'Teste sem admin excedeu o prazo' }
    $processo.Refresh()
    Get-Content -LiteralPath $stdout
    if ($processo.ExitCode -ne 0) {
        Get-Content -LiteralPath $stderr
        throw ('Teste sem admin falhou: ' + $processo.ExitCode)
    }
    if ([IO.File]::ReadAllText($stdout) -notmatch 'CONCLUIDO: 2 clientes SSH') { throw 'Os dois clientes SSH precisam concluir os testes' }
} finally {
    if ($null -ne $processo) { $processo.Dispose() }
    if ($criado) { Remove-LocalUser -Name $nome }
    if (Test-Path -LiteralPath $pasta) { Remove-Item -LiteralPath $pasta -Recurse -Force }
}
