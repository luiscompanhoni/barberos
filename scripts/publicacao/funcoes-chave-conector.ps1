function Exigir-ArquivoNormal([string]$Caminho) {
    if (Test-Path -LiteralPath $Caminho) {
        $item = Get-Item -LiteralPath $Caminho -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Link inesperado; arquivo preservado.'
        }
        if ($item.PSIsContainer) { throw 'Arquivo esperado; diretorio preservado.' }
    }
}

function Proteger-Arquivo([string]$Caminho) {
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().User
    try {
        # Le somente o dono e persiste somente a DACL. Nao solicita auditoria/SACL.
        $dono = [IO.File]::GetAccessControl($Caminho, [Security.AccessControl.AccessControlSections]::Owner)
        $permitidos = @($usuario.Value, 'S-1-5-18', 'S-1-5-32-544')
        $proprietario = $dono.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($permitidos -notcontains $proprietario) { throw 'BB-ACL-DONO: A chave pertence a outro usuario; foi preservada.' }
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($id in $permitidos) {
            $sid = [Security.Principal.SecurityIdentifier]::new($id)
            $regra = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')
            $acl.AddAccessRule($regra)
        }
        [IO.File]::SetAccessControl($Caminho, $acl)
    } catch {
        # Esta etapa so manipula metadados; nunca le o conteudo da chave privada.
        $motivo = $_.Exception.Message.Replace($Caminho, '[arquivo da chave]') -replace '[\r\n]+', ' '
        if ($motivo.Length -gt 350) { $motivo = $motivo.Substring(0, 350) }
        throw ('BB-ACL: Nao foi possivel proteger o arquivo. ' + $motivo)
    }
}

function Ler-PublicaDaChave([string]$Executavel, [string]$Caminho) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executavel
    $info.Arguments = '-y -P "" -f "' + $Caminho + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $processo = [Diagnostics.Process]::new()
    $processo.StartInfo = $info
    try {
        [void]$processo.Start()
        $processo.StandardInput.Close()
        $saida = $processo.StandardOutput.ReadToEndAsync()
        $erro = $processo.StandardError.ReadToEndAsync()
        if (-not $processo.WaitForExit(15000)) { $processo.Kill(); $processo.WaitForExit(); throw 'BB-CHAVE-TEMPO: A leitura da chave excedeu 15 segundos.' }
        $texto = $saida.Result.Trim()
        $detalhe = $erro.Result
        if ($processo.ExitCode -ne 0) {
            if ($detalhe -match 'bad permissions|unprotected private|too open') { throw 'BB-CHAVE-PERMISSOES: O OpenSSH recusou as permissoes da chave.' }
            if ($detalhe -match 'passphrase|decrypt') { throw 'BB-CHAVE-SENHA: A chave existente tem uma senha propria; ela foi preservada.' }
            if ($detalhe -match 'invalid format|libcrypto|not a key file') { throw 'BB-CHAVE-FORMATO: O OpenSSH nao reconhece o formato do arquivo existente; ele foi preservado.' }
            if ($detalhe -match 'Permission denied|Access is denied|Access denied') { throw 'BB-CHAVE-ACESSO: O Windows negou a leitura da chave.' }
            throw ('BB-CHAVE-LEITURA: O ssh-keygen terminou com codigo ' + $processo.ExitCode + '. O erro bruto nao foi exibido para proteger os dados.')
        }
        if ($texto -cnotmatch '^ssh-ed25519 [A-Za-z0-9+/]{68}(?: [^\r\n]*)?$') { throw 'BB-CHAVE-TIPO: A chave existente nao retornou uma identidade publica ED25519 valida.' }
        $partes = $texto.Split(' ')
        return $partes[0] + ' ' + $partes[1]
    } finally { $processo.Dispose() }
}

function Conferir-Publica([string]$Caminho, [string]$Publica) {
    if ($Publica -cnotmatch '^ssh-ed25519 [A-Za-z0-9+/]{68}$') { throw 'BB-PAR: Identidade publica invalida.' }
    if (Test-Path -LiteralPath $Caminho) {
        $salva = [IO.File]::ReadAllText($Caminho).Trim() -split '\s+'
        if ($salva.Count -ge 2 -and ($salva[0] + ' ' + $salva[1]) -ceq $Publica) { return }
        $copia = $Caminho + '.antes-correcao-' + [guid]::NewGuid().ToString('N')
        [IO.File]::Copy($Caminho, $copia, $false)
        Write-Host 'Arquivo publico desatualizado: copia anterior preservada; chave privada mantida.'
    }
    [IO.File]::WriteAllText($Caminho, $Publica + " barberos-github-actions`n", [Text.Encoding]::ASCII)
}
