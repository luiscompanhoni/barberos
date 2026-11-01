/** O valor deve vir do console autenticado da Hostinger, nunca do próprio keyscan. */
import { createHash } from "node:crypto";

export function validarImpressaoServidor(impressao) {
  if (typeof impressao !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(impressao)) {
    throw new Error("Informe somente a impressão SHA256 pública conferida no console da Hostinger.");
  }
  return impressao;
}

export function validarChavePublicaServidor(chave, impressao) {
  validarImpressaoServidor(impressao);
  if (typeof chave !== "string" || /[\r\n]/.test(chave.trim())) {
    throw new Error("Informe somente uma linha de chave pública ED25519 do servidor.");
  }
  const partes = chave.trim().split(/[ \t]+/);
  if (partes[0] !== "ssh-ed25519" || !/^[A-Za-z0-9+/]{68}$/.test(partes[1] || "")) {
    throw new Error("Formato de chave pública ED25519 inválido; nenhum conteúdo foi exibido.");
  }
  const blob = Buffer.from(partes[1], "base64");
  if (blob.length !== 51 || blob.toString("base64") !== partes[1] || blob.readUInt32BE(0) !== 11
    || blob.subarray(4, 15).toString("ascii") !== "ssh-ed25519" || blob.readUInt32BE(15) !== 32) {
    throw new Error("Estrutura de chave pública ED25519 inválida.");
  }
  const calculada = "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
  if (calculada !== impressao) throw new Error("A chave pública não corresponde à impressão previamente conferida na Hostinger.");
  // Comentários podem conter caracteres de shell. O CMD recebe apenas o tipo e o blob canônico.
  return "ssh-ed25519 " + partes[1];
}

export function verificarHostWindows(impressao, chavePublica) {
  const esperada = validarImpressaoServidor(impressao);
  if (chavePublica !== undefined) {
    const chave = validarChavePublicaServidor(chavePublica, esperada);
    return String.raw`> "%BB_OUT%\known_hosts" echo 179.236.244.156 ${chave}
if errorlevel 1 goto :host_arquivo_falhou
>> "%BB_OUT%\RESULTADO.txt" echo Identidade publica do console conferida previamente pela impressao SHA256.
>> "%BB_OUT%\RESULTADO.txt" echo O SSH verificara essa identidade durante a conexao; registros anteriores foram preservados.
goto :host_conferido
:host_arquivo_falhou
>> "%BB_OUT%\RESULTADO.txt" echo Nao foi possivel gravar o arquivo local da identidade publica. SSH nao iniciado.
goto :limpar
:host_conferido
`;
  }
  return String.raw`set "BB_KEYSCAN=%BB_SSH:\ssh.exe=\ssh-keyscan.exe%"
set "BB_KEYGEN=%BB_SSH:\ssh.exe=\ssh-keygen.exe%"
if not exist "%BB_KEYSCAN%" goto :host_sem_ferramentas
if not exist "%BB_KEYGEN%" goto :host_sem_ferramentas
set "BB_HOST_ETAPA=consulta da chave publica por ssh-keyscan"
"%BB_KEYSCAN%" -T 10 -p 22 -t ed25519 179.236.244.156 > "%BB_OUT%\host-candidato.tmp" 2> "%BB_OUT%\erro-privado.tmp"
if errorlevel 1 goto :host_nao_consultado
set "BB_HOST_ETAPA=calculo da impressao publica por ssh-keygen"
"%BB_KEYGEN%" -E sha256 -lf "%BB_OUT%\host-candidato.tmp" > "%BB_OUT%\impressao.tmp" 2> "%BB_OUT%\erro-privado.tmp"
if errorlevel 1 goto :host_nao_consultado
set "BB_HOST_VALIDADO="
for /f "usebackq tokens=2" %%H in ("%BB_OUT%\impressao.tmp") do (
  if not "%%H"=="${esperada}" goto :host_divergente
  set "BB_HOST_VALIDADO=sim"
)
set "BB_HOST_ETAPA=leitura do resultado da impressao publica"
if not defined BB_HOST_VALIDADO goto :host_nao_consultado
set "BB_HOST_ETAPA=gravacao do arquivo local de identidade"
move "%BB_OUT%\host-candidato.tmp" "%BB_OUT%\known_hosts" >nul
if errorlevel 1 goto :host_nao_consultado
>> "%BB_OUT%\RESULTADO.txt" echo Identidade ED25519 confere com a impressao fornecida pelo console da Hostinger.
>> "%BB_OUT%\RESULTADO.txt" echo Identidades e configuracao SSH anteriores foram preservadas.
goto :host_conferido
:host_divergente
>> "%BB_OUT%\RESULTADO.txt" echo IDENTIDADE DIVERGENTE: a conexao SSH nao foi iniciada. Conferir o servidor pelo console da Hostinger.
goto :limpar
:host_sem_ferramentas
>> "%BB_OUT%\RESULTADO.txt" echo Ferramentas de verificacao do cliente SSH nao localizadas. Nada foi instalado.
goto :limpar
:host_nao_consultado
>> "%BB_OUT%\RESULTADO.txt" echo Nao foi possivel conferir a identidade publica. A conexao SSH nao foi iniciada.
>> "%BB_OUT%\RESULTADO.txt" echo Etapa: %BB_HOST_ETAPA%.
goto :limpar
:host_conferido
`;
}
