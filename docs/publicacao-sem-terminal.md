# Preparação de atualizações sem PowerShell

O fluxo preparado usa GitHub Actions para testar uma versão identificada por commit, produzir um pacote sem configuração privada e, quando houver acesso autorizado, consultar a VPS. A publicação em produção **ainda não está habilitada**: faltam acesso efetivo, inspeção da instalação e validação do backup/rollback. Não há um botão de deploy funcional nesta entrega parcial.

## Código atual e preservação

A main consultada em 31/10/2026 aponta para `5e45f3fbe90110680f8a55b917d213f2865a23cd`, com LGPD, Next.js 16.4.1 e correções de acessos, checklist, reuniões, presença e bônus. O CI desse commit passou: [execução 40980751488](https://github.com/luiscompanhoni/barberos/actions/runs/40980751488).

A integração Studio já resolvida sobre a main anterior foi reaproveitada por patch, sem conflitos, numa cópia separada. As cópias anteriores e o ZIP entregue ao Windows foram preservados. Os arquivos exclusivos do Windows posteriores àquela transferência não estão acessíveis nesta sessão; não foram declarados equivalentes ao GitHub.

O commit tem data local de 29/10 às 21h16; o GitHub registra o último push em 30/10 às 00h36 UTC (29/10 às 21h36 em São Paulo). Uma atualização feita apenas no Windows ou diretamente na VPS não pode ser identificada por esses registros.

## O que está implementado

- Workflow **Preparar atualização (sem publicar)**, acionado manualmente e restrito à main. Executa testes portáveis em Windows, instalação, lint, tipos, testes, build, migrações, fluxos e restauração de backup sintético em Linux. Não publica a aplicação nem executa o deploy antigo. As etapas novas ainda não foram executadas no GitHub.
- Pacote `codigo.tar.gz` com arquivos do commit, manifesto `versao.json`, lista/checksums das migrações e SHA-256. A preparação recusa alterações pendentes, arquivos novos não commitados, arquivos especiais, destinos existentes e alguns padrões conhecidos de credenciais. O exame automatizado não substitui a revisão de segredos.
- Consulta opcional à VPS via SSH, com identidade de host previamente validada, chave temporária protegida e remoção ao terminar. Sem criação de chaves SSH, instalação, firewall, backup, migração, reinício ou deploy.
- Relatório de CPU, memória, disco, serviços, imagens, revisão declarada, caminhos Compose, volumes, migrações e metadados de backups. Não lê conteúdo de `.env`, logs de aplicações ou dados de clientes. A mera presença de backup não é tratada como restauração comprovada.
- Override de produção do Studio em `deploy/docker-compose.estudio.producao.yml`, preparado para revisão, ainda não ativado. Worker em rede interna, sem porta pública, 0,75 CPU, 2 GB de RAM e volumes separados.
- Identificação futura da imagem pelo argumento `VCS_REF` e por `/api/saude` em `revisao`. Quando o build não recebeu um SHA válido, retorna `null`; não inventa a versão instalada.

## Configuração única necessária para a consulta pelo GitHub

Um administrador do repositório deve criar/configurar o ambiente `producao` no GitHub, preferencialmente restrito à main e com revisores para futuras publicações. A conexão desta sessão tem leitura/escrita de código, mas a API devolveu HTTP 403 para segredos e runners; nenhum segredo foi criado ou alterado.

| Campo | Tipo | Uso |
|---|---|---|
| `VPS_HOST` | Variável do ambiente | Endereço real da VPS; referência conhecida `179.236.244.156` |
| `VPS_USER` | Variável do ambiente | Usuário autorizado; referência fornecida `root` |
| `VPS_PORT` | Variável opcional | Porta SSH; padrão 22 |
| `VPS_DIR` | Variável opcional | Diretório instalado `/opt/barberos`, confirmado pelo console |
| `VPS_PROJECT` | Variável opcional | Projeto Compose `barberos`, confirmado pelo console |
| `VPS_SSH_KEY` | Segredo do ambiente | Chave existente, previamente validada para esta VPS |
| `VPS_KNOWN_HOSTS` | Segredo do ambiente | Identidade SSH do servidor, conferida por canal confiável |

Não enviar esses valores ao chat. A impressão digital da chave do cliente é diferente da identidade do servidor. Não confiar automaticamente no resultado de `ssh-keyscan`, não desabilitar a verificação do host e não gerar outra chave para contornar recusa de conexão. Uma chave criptografada exige um agente de autenticação apropriado; o executor atual é não interativo.

GitHub Actions pode permitir o acesso SSH que esta sessão de nuvem não oferece, mas isso **ainda não foi testado**. Falta de conectividade ou autorização continuará sendo um bloqueio, sem alterações automáticas no servidor.

## Primeiro diagnóstico pelo Windows, sem PowerShell

Foi preparado um único arquivo `Diagnostico-Barberos.cmd`, gerado por `scripts/publicacao/diagnostico-windows.mjs`. Ao abrir com duplo clique, consulta os estados Git das três pastas conhecidas e tenta o inventário da VPS pelo cliente SSH já instalado. Usa as identidades/configuração disponíveis no Windows, sem copiar a chave da nuvem, criar uma chave ou aceitar uma identidade de host desconhecida. Não altera código local nem arquivos no servidor.

O resultado é salvo numa pasta nova `Barberos-Diagnostico-...` no perfil do usuário, aberta ao terminar. `RESULTADO.txt` e, quando a consulta conclui, `vps.json` permitem identificar o bloqueio sem compartilhar segredos. Os relatórios incluem caminhos e metadados operacionais; compartilhar privadamente. Se a autenticação ou identidade do host ainda não estiver configurada, o diagnóstico para com essa indicação. Isso não significa que a chave cadastrada na Hostinger esteja errada.

O usuário executou o diagnóstico no Windows e retornou o inventário das três cópias. A tentativa SSH chegou à verificação da identidade do servidor, sem autenticação comprovada. O primeiro diagnóstico agrupa identidade desconhecida e identidade alterada na mesma mensagem; não concluir que basta aceitar uma chave nova.

Para conferir a identidade, usar o console autenticado da Hostinger: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Isso mostra a impressão digital pública do servidor, não uma senha nem uma chave privada. Somente depois de receber esse valor por esse canal, o gerador pode receber a impressão como terceiro argumento. Nunca preencher esse parâmetro com o resultado do próprio `ssh-keyscan`.

A variante compara todas as impressões recebidas com a esperada antes de iniciar a consulta SSH. Usa ED25519, verificação estrita e um `known_hosts` separado na pasta nova do diagnóstico. Preserva os arquivos SSH anteriores e recusa qualquer divergência. A confirmação da identidade não comprova que a chave do usuário autentica, nem concede controle do Windows a esta sessão na nuvem.

Se a coleta automática da chave pública falhar, obter a própria chave pelo console autenticado: `cat /etc/ssh/ssh_host_ed25519_key.pub`. Somente o arquivo `.pub`; nunca o arquivo privado de mesmo nome sem essa extensão. O gerador aceita opcionalmente esse arquivo público como quarto argumento: valida o formato binário ED25519 e calcula SHA-256, exigindo igualdade com a impressão previamente conferida. Descarta comentários antes de gerar o CMD. Nesse modo, a chave pública já conferida é incorporada ao `known_hosts` separado e a consulta de rede por `ssh-keyscan` é dispensada; a verificação estrita da conexão SSH permanece obrigatória. Uma chave pública de servidor não concede acesso de login.

O usuário executou a variante com impressão conferida, mas a coleta/validação da chave pública falhou antes da autenticação. A mensagem original não identifica qual etapa falhou; não inferir divergência de chave nem causa de rede. A chave pública foi depois recebida pelo console, conferida pelo SHA-256 e incorporada à variante sem coleta por rede. Essa variante chegou à autenticação, sem login por chave concluído. O diagnóstico não configura publicação, não faz backup e não substitui a verificação de restauração.

Em 01/11/2026, uma captura confirmou login SSH interativo do Windows como root, com a identidade estrita do servidor e autenticação por senha habilitada no cliente. O usuário já tem acesso ao terminal da VPS. Não repetir os diagnósticos anteriores. Esse acesso não concede controle do Windows à sessão na nuvem nem configura autenticação para execuções automáticas; a continuação precisa de um executor local ou de uma automação com credencial própria validada. Senhas e chaves privadas permanecem fora do chat.

## Uso após revisão e integração do código

No GitHub: **Actions → Preparar atualização (sem publicar) → Run workflow**, usando `main`. Deixe a consulta da VPS desmarcada até os acessos seguros estarem configurados. O pacote fica no artefato da execução, retido por um dia. Esse fluxo não depende do VS Code, da extensão Codex nem de PowerShell no computador do dono.

A consulta opcional mostra somente um resumo de capacidade na execução. O relatório detalhado fica temporariamente no executor e é removido ao terminar; não é publicado como artefato de um repositório público. Segredos e conteúdo bruto de erros SSH não são impressos.

O workflow só ficará disponível depois que seus arquivos forem revisados e integrados ao GitHub. Não foi enviado ou executado no GitHub nesta preparação. Nada foi contratado. Antes de ativar execuções recorrentes, confirmar franquia e cobrança da conta GitHub; esta entrega não habilita APIs pagas nem armazenamento externo.

## O que falta para o deploy por aprovação

1. Validar acesso e identidade do servidor por um ambiente autorizado; confirmar configuração real e versão em execução. As recusas TCP na nuvem ocorreram antes da autenticação e não demonstram chave inválida.
2. Comparar a versão instalada e as migrações aplicadas com o manifesto. Confirmar divergências do Windows que ainda não chegaram ao GitHub. Não repetir uma atualização que já estiver instalada e funcionando.
3. Medir capacidade para app, PostgreSQL, mídia, render, backups e build. Os limites de 2 GB/0,75 CPU do worker não comprovam capacidade disponível. Apresentar previamente qualquer necessidade de VPS maior, armazenamento ou processamento separado.
4. Preservar imagem, código e configuração anterior; fazer backup consistente de banco e mídias, validar restauração isolada e definir rollback. Nenhum desses passos foi executado na VPS nesta retomada.
5. Adequar o caminho de publicação à instalação inspecionada: manter configuração/volumes, preparar build antes da troca, bloquear se backup falhar, aplicar somente migrações pendentes, aguardar saúde estável e testar os fluxos. A entrada de produção do script antigo está bloqueada antes de conectar, pelos riscos de backup condicional, remoção de código e limpeza de imagens. Esse bloqueio não implementa rollback.
6. Apresentar o conteúdo final, testes, migrações, custo e recuperação; publicar somente após aprovação. Não restaurar banco automaticamente com perda de gravações posteriores.

## Verificações locais

`npm run check:publicacao` executa os testes Node portáveis de pacote, preservação de trabalho, segredos, argumentos SSH, identidade e limpeza de credenciais temporárias. O teste substitui a chamada ao processo SSH; não exige executável POSIX nem Python e não comprova login real. Permissões POSIX são verificadas apenas no Linux; ACLs do Windows não foram validadas aqui.

`npm run check:publicacao:servidor` acrescenta os testes Python de inventário, sintaxe do Python incorporado no CMD, backup de mídias e bloqueio do deploy legado. A divisão não dispensa esses testes: a preparação no CI exige ambos os sistemas. O ensaio `scripts/publicacao/teste-backup-container.py` exercita dump/restauração reais com PostgreSQL e mídias fictícias em container descartável, sem portas públicas. Os testes não usam produção; commits de fixtures são descartáveis.

As correções e pendências posteriores aos três ciclos locais estão em [revisão de 01/11](correcoes-revisao-2026-11-01.md). A comparação do Windows encontrou diferenças ainda não integradas; contagem de arquivos não substitui a revisão dos patches.

As verificações completas e limitações desta retomada ficam em [evidências de 31/10](evidencias-operacao-2026-10-31.md). Preparação local, configuração salva, execução de Actions e publicação em produção são estados distintos.

Sugestão de revisão, ainda não executada: quatro ciclos, pelo risco de dados e publicação. Pedido copiável: “Revise em 4 ciclos esta versão: preservação/segredos; integração Studio e LGPD; migrações/render/capacidade; operação/backup/rollback. Registre achados e checks. Não publique nem gere custos.”
