# Usa chaves descartaveis. Nao conecta a servidor nem le credenciais existentes.
param([string]$Fonte = (Join-Path $PSScriptRoot 'conectar-github-windows.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null
$erros = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Fonte, [ref]$tokens, [ref]$erros)
if ($erros.Count) { throw 'Sintaxe invalida no assistente' }
foreach ($f in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($f.Extent.Text))
}
function Exigir([bool]$Condicao, [string]$Descricao) { if (-not $Condicao) { throw $Descricao } }
function Gerar-Teste([string]$Executavel, [string]$Chave, [string]$Senha = '') {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executavel
    $info.Arguments = '-q -t ed25519 -C "teste-descartavel" -N "' + $Senha + '" -f "' + $Chave + '"'
    $info.UseShellExecute = $false
    $p = [Diagnostics.Process]::Start($info)
    try {
        if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'Geracao excedeu o prazo' }
        Exigir ($p.ExitCode -eq 0) 'Falha ao gerar fixture'
    } finally { $p.Dispose() }
}
$raiz = Join-Path ([IO.Path]::GetTempPath()) ('barberos-chave-teste-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($raiz) | Out-Null
$clientes = 0
try {
    foreach ($cliente in @('C:\Windows\System32\OpenSSH\ssh-keygen.exe', 'C:\Program Files\Git\usr\bin\ssh-keygen.exe')) {
        if (-not (Test-Path -LiteralPath $cliente)) { continue }
        $clientes++
        $pasta = Join-Path $raiz ('cliente-' + $clientes)
        [IO.Directory]::CreateDirectory($pasta) | Out-Null
        $chave = Join-Path $pasta 'chave com espacos [teste]'
        Gerar-Teste $cliente $chave
        $hash = (Get-FileHash -LiteralPath $chave).Hash
        $acl = Get-Acl -LiteralPath $chave
        $dono = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        $todos = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($todos, 'Read', 'Allow'))
        Set-Acl -LiteralPath $chave -AclObject $acl
        Proteger-Arquivo $chave
        $depois = Get-Acl -LiteralPath $chave
        Exigir ($depois.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $dono) 'Proprietario alterado'
        $permitidos = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
        foreach ($r in $depois.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            Exigir ($permitidos -contains $r.IdentityReference.Value) 'ACL permite terceiro'
        }
        Exigir ((Get-FileHash -LiteralPath $chave).Hash -eq $hash) 'Chave privada foi alterada'
        $pub = Ler-PublicaDaChave $cliente $chave
        Exigir ($pub -cmatch '^ssh-ed25519 [A-Za-z0-9+/]{68}$') 'Identidade publica invalida'
        $pubPath = $chave + '.pub'
        $pubOriginal = [IO.File]::ReadAllText($pubPath)
        Conferir-Publica $pubPath $pub
        Exigir ([IO.File]::ReadAllText($pubPath) -ceq $pubOriginal) 'Publica valida alterada'
        [IO.File]::WriteAllText($pubPath, 'arquivo publico antigo de teste')
        Conferir-Publica $pubPath $pub
        $copias = @(Get-ChildItem -LiteralPath $pasta | Where-Object { $_.Name.Contains('.antes-correcao-') })
        Exigir ($copias.Count -eq 1) 'Backup publico ausente'
        Exigir ([IO.File]::ReadAllText($copias[0].FullName) -ceq 'arquivo publico antigo de teste') 'Backup publico incorreto'
        Conferir-Publica $pubPath $pub
        Exigir (@(Get-ChildItem -LiteralPath $pasta | Where-Object { $_.Name.Contains('.antes-correcao-') }).Count -eq 1) 'Reexecucao duplicou backup'
        Exigir ((Get-FileHash -LiteralPath $chave).Hash -eq $hash) 'Reparo publico alterou privada'
        Write-Host ('PASS: permissoes, proprietario, leitura e reparo publico; cliente ' + $cliente)

        $invalida = Join-Path $pasta 'arquivo invalido'
        [IO.File]::WriteAllText($invalida, 'sentinela-sem-chave')
        Proteger-Arquivo $invalida
        $falhou = $false
        try { [void](Ler-PublicaDaChave $cliente $invalida) }
        catch { $falhou = $_.Exception.Message.StartsWith('BB-CHAVE-FORMATO:') -and -not $_.Exception.Message.Contains('sentinela') }
        Exigir $falhou 'Formato invalido nao foi identificado com seguranca'
        Exigir ([IO.File]::ReadAllText($invalida) -ceq 'sentinela-sem-chave') 'Arquivo invalido foi alterado'
        $criptografada = Join-Path $pasta 'chave com senha'
        Gerar-Teste $cliente $criptografada 'senha-da-fixture'
        Proteger-Arquivo $criptografada
        $hashSenha = (Get-FileHash -LiteralPath $criptografada).Hash
        $falhou = $false
        try { [void](Ler-PublicaDaChave $cliente $criptografada) }
        catch { $falhou = $_.Exception.Message.StartsWith('BB-CHAVE-SENHA:') }
        Exigir $falhou 'Chave criptografada nao foi identificada'
        Exigir ((Get-FileHash -LiteralPath $criptografada).Hash -eq $hashSenha) 'Chave criptografada foi alterada'
        Write-Host 'PASS: formato invalido e chave com senha preservados e identificados'
    }
    Exigir ($clientes -gt 0) 'Nenhum OpenSSH encontrado para testar'
    Write-Host ('CONCLUIDO: ' + $clientes + ' clientes SSH; nenhuma conexao remota executada.')
} finally { Remove-Item -LiteralPath $raiz -Recurse -Force }
