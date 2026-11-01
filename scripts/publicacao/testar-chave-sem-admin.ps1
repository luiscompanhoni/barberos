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
    $argumentos = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $pasta 'testar.ps1') + '" -ExigirUsuarioComum -Fonte "' + (Join-Path $pasta 'funcoes.ps1') + '" -CompararAnterior "' + (Join-Path $pasta 'anterior.ps1') + '" -PastaTemporaria "' + $pasta + '"'
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $PSHOME 'powershell.exe'
    $info.Arguments = $argumentos
    $info.UserName = $nome
    $info.Domain = $env:COMPUTERNAME
    $info.Password = $senha
    $info.LoadUserProfile = $true
    $info.UseShellExecute = $false
    $info.WorkingDirectory = $pasta
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $processo = [Diagnostics.Process]::new()
    $processo.StartInfo = $info
    [void]$processo.Start()
    $processo.StandardInput.Close()
    $saida = $processo.StandardOutput.ReadToEndAsync()
    $erro = $processo.StandardError.ReadToEndAsync()
    if (-not $processo.WaitForExit(180000)) { $processo.Kill(); $processo.WaitForExit(); throw 'Teste sem admin excedeu o prazo' }
    Write-Host $saida.Result
    if ($processo.ExitCode -ne 0) {
        Write-Host $erro.Result
        throw ('Teste sem admin falhou: ' + $processo.ExitCode)
    }
    if ($saida.Result -notmatch 'CONCLUIDO: 2 clientes SSH') { throw 'Os dois clientes SSH precisam concluir os testes' }
} finally {
    if ($null -ne $processo) { $processo.Dispose() }
    if ($criado) { Remove-LocalUser -Name $nome }
    if (Test-Path -LiteralPath $pasta) { Remove-Item -LiteralPath $pasta -Recurse -Force }
}
