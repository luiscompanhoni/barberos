/** Gera um único CMD de diagnóstico; não instala ferramentas nem publica código. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verificarHostWindows } from "./identidade-windows.mjs";

export function gerarDiagnostico(destino, impressaoServidor, chavePublicaServidor) {
  const conferirHost = impressaoServidor !== undefined || chavePublicaServidor !== undefined;
  const verificacaoHost = conferirHost ? verificarHostWindows(impressaoServidor, chavePublicaServidor) : "";
  const argumentosHost = conferirHost ? "-o HostKeyAlgorithms=ssh-ed25519 -o UserKnownHostsFile=known_hosts " : "";
  // ASCII mantém o Python válido mesmo em máquinas com outra página de códigos.
  const python = readFileSync(fileURLToPath(new URL("./inspecionar-vps.py", import.meta.url)), "utf8")
    .replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const cabecalho = String.raw`@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Barberos - consulta sem deploy
echo Este diagnostico consulta as copias locais conhecidas e a VPS.
echo Nao instala, nao publica e nao solicita chave ou senha no chat.
echo Pode levar alguns minutos. Aguarde o resultado.
set "BB_OUT=%USERPROFILE%\Barberos-Diagnostico-%RANDOM%-%RANDOM%"
if exist "%BB_OUT%" goto :pasta_ocupada
mkdir "%BB_OUT%"
if errorlevel 1 goto :sem_pasta
set "BB_SSH=%SystemRoot%\System32\OpenSSH\ssh.exe"
if not exist "%BB_SSH%" set "BB_SSH=%ProgramFiles%\Git\usr\bin\ssh.exe"
set "BB_GIT=%ProgramFiles%\Git\cmd\git.exe"
> "%BB_OUT%\RESULTADO.txt" echo Diagnostico Barberos: consulta somente de leitura.
>> "%BB_OUT%\RESULTADO.txt" echo Nenhum deploy, backup ou migracao foi executado.
>> "%BB_OUT%\RESULTADO.txt" echo Consulta limitada as tres pastas conhecidas; outras copias podem existir.
if exist "%BB_GIT%" call :repo "%USERPROFILE%\Documents\Codex\2026-10-21\new-chat-2\barberos"
if exist "%BB_GIT%" call :repo "%USERPROFILE%\Documents\Codex\2026-10-21\new-chat-2\barberos-estudio"
if exist "%BB_GIT%" call :repo "%USERPROFILE%\Documents\Codex\2026-10-21\new-chat-2\barberos-integrado-studio"
if not exist "%BB_GIT%" >> "%BB_OUT%\RESULTADO.txt" echo Git nao encontrado no caminho conhecido; copias nao consultadas.
if not exist "%BB_SSH%" goto :sem_ssh
${verificacaoHost}"%SystemRoot%\System32\more.com" +__LINHAS__ "%~f0" > "%BB_OUT%\consulta.py"
pushd "%BB_OUT%"
if errorlevel 1 goto :sem_pasta
"%BB_SSH%" -T -p 22 -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o PermitLocalCommand=no -o ClearAllForwardings=yes -o ForwardAgent=no -o RemoteCommand=none ${argumentosHost}root@179.236.244.156 "python3 - --base-dir /opt/barberos --project barberos" < "%BB_OUT%\consulta.py" > "%BB_OUT%\vps.json.tmp" 2> "%BB_OUT%\erro-privado.tmp"
set "BB_SSH_CODIGO=%ERRORLEVEL%"
popd
if not "%BB_SSH_CODIGO%"=="0" goto :ssh_falhou
move /y "%BB_OUT%\vps.json.tmp" "%BB_OUT%\vps.json" >nul
>> "%BB_OUT%\RESULTADO.txt" echo SSH autenticado; inventario em vps.json. Conferir bloqueios do inventario.
goto :limpar
:ssh_falhou
set "BB_MOTIVO=Consulta nao concluida; detalhes privados foram omitidos."
"%SystemRoot%\System32\findstr.exe" /C:"Host key verification failed" /C:"REMOTE HOST IDENTIFICATION HAS CHANGED" "%BB_OUT%\erro-privado.tmp" >nul
if not errorlevel 1 set "BB_MOTIVO=Identidade do servidor ainda nao validada no SSH deste Windows."
"%SystemRoot%\System32\findstr.exe" /C:"REMOTE HOST IDENTIFICATION HAS CHANGED" "%BB_OUT%\erro-privado.tmp" >nul
if not errorlevel 1 set "BB_MOTIVO=A identidade SSH difere de um registro anterior; ela nao foi substituida automaticamente."
"%SystemRoot%\System32\findstr.exe" /C:"Permission denied" "%BB_OUT%\erro-privado.tmp" >nul
if not errorlevel 1 set "BB_MOTIVO=Autenticacao nao concluida com as identidades disponiveis. Isso nao prova que a chave cadastrada esta errada."
"%SystemRoot%\System32\findstr.exe" /C:"Connection refused" "%BB_OUT%\erro-privado.tmp" >nul
if not errorlevel 1 set "BB_MOTIVO=Conexao recusada antes da autenticacao."
"%SystemRoot%\System32\findstr.exe" /C:"timed out" "%BB_OUT%\erro-privado.tmp" >nul
if not errorlevel 1 set "BB_MOTIVO=Tempo limite de conexao; acesso nao validado."
>> "%BB_OUT%\RESULTADO.txt" echo %BB_MOTIVO%
goto :limpar
:sem_ssh
>> "%BB_OUT%\RESULTADO.txt" echo Cliente SSH nao localizado; nenhuma ferramenta foi instalada.
:limpar
del /q "%BB_OUT%\consulta.py" "%BB_OUT%\vps.json.tmp" "%BB_OUT%\erro-privado.tmp" >nul 2>nul
del /q "%BB_OUT%\host-candidato.tmp" "%BB_OUT%\impressao.tmp" >nul 2>nul
echo.
type "%BB_OUT%\RESULTADO.txt"
echo.
echo Resultado salvo em "%BB_OUT%"
echo Envie RESULTADO.txt e, se existir, vps.json nesta conversa.
echo Eles contem caminhos e metadados operacionais; nao publique em lugar aberto.
start "" "%SystemRoot%\explorer.exe" "%BB_OUT%"
pause
exit /b 0
:repo
>> "%BB_OUT%\RESULTADO.txt" echo.
>> "%BB_OUT%\RESULTADO.txt" echo Copia: %~1
if not exist "%~1\.git" goto :repo_ausente
"%BB_GIT%" --no-optional-locks -c core.fsmonitor=false -C "%~1" rev-parse HEAD >> "%BB_OUT%\RESULTADO.txt" 2>nul
"%BB_GIT%" --no-optional-locks -c core.fsmonitor=false -C "%~1" branch --show-current >> "%BB_OUT%\RESULTADO.txt" 2>nul
"%BB_GIT%" --no-optional-locks -c core.fsmonitor=false -C "%~1" status --short >> "%BB_OUT%\RESULTADO.txt" 2>nul
exit /b
:repo_ausente
>> "%BB_OUT%\RESULTADO.txt" echo Pasta Git nao encontrada; nao foi criada ou alterada.
exit /b
:pasta_ocupada
echo Pasta de resultado ja existe. Nada foi sobrescrito; abra este arquivo novamente.
pause
exit /b 1
:sem_pasta
echo Nao foi possivel criar a pasta de resultado no perfil do usuario.
pause
exit /b 1
`;
  const linhas = cabecalho.split("\n").length - 1;
  const conteudo = (cabecalho.replace("__LINHAS__", String(linhas)) + python).replace(/\r?\n/g, "\r\n");
  writeFileSync(resolve(destino), conteudo, { flag: "wx" });
  return { linhasCabecalho: linhas };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Informe o destino do CMD, fora do repositório.");
  const arquivoPublico = process.argv[4];
  if (arquivoPublico !== undefined && !arquivoPublico.endsWith(".pub")) throw new Error("O arquivo de identidade deve ser público, com extensão .pub.");
  gerarDiagnostico(process.argv[2], process.argv[3], arquivoPublico === undefined ? undefined : readFileSync(arquivoPublico, "utf8"));
  console.log("Diagnóstico Windows gerado; nenhuma consulta foi executada.");
}
