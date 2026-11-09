# Publicação e teste acompanhado do atendimento

Ygor autorizou merge, deploy e ativação para testes em 08/11/2026. Este documento descreve o procedimento; o resultado real deve ser conferido nos registros cifrados e em `/api/saude`.

## Ordem

1. Integrar a `main` atual, preservar as correções financeiras e exigir CI aprovado para o commit exato.
2. Usar `consultar-vps.yml` e conferir imagem instalada, capacidade e ausência de recuperação pendente.
3. Publicar com `publicar.yml`: backup/restauração antes e depois, ensaio das migrações, HTTPS e controles bloqueados. As duas migrações novas apenas expandem o esquema; não cancelam contratos nem modificam preços.
4. Executar `ativar-atendimento.yml` para o mesmo commit. A imagem ASR usa faster-whisper, modelo base público fixado, transcrição local e teste HTTP com áudio sintético. O worker não publica porta, exige token e tem limites de CPU/memória.
5. A ativação exige publicação concluída, revisão instalada correspondente, credencial de IA existente e Evolution conectada. Faz uma chamada técnica curta, limitada a 32 tokens de saída e sem dados de clientes, para verificar a resposta do modelo existente. Não contrata nem troca provedor/modelo. A leitura de imagens usa a IA existente; testes de conversa consomem essa IA.
6. A flag `WHATSAPP_ATENDIMENTO_TESTE_EQUIPE=true` autoriza somente respostas solicitadas por números de usuários **DONO ou GERENTE ativos**. O bot deve estar ligado na configuração. `HUMANO`, opt-out e transferência continuam valendo. O bloqueio geral permanece ligado; campanhas/templates e contatos externos não recebem exceção.
7. A mesma ativação marca os dois Business confirmados por nome e preços R$ 97/R$ 156 como venda somente pela equipe, preservando os demais campos. Configuração e auditorias são gravadas em uma transação. Divergência impede o lote.

## Teste de Ygor

Enviar uma mensagem nova ao WhatsApp da barbearia a partir do número cadastrado como dono ou gerente: perguntar preços, horários, boleto, plano Business, prêmio e pedir uma pessoa. Testar áudio curto, foto e figurinha. Em conversa já assumida pela equipe, devolver ao bot pelo painel antes do teste. A agenda permanece em transição: horários dependem de conferência no Cash Barber.

Áudio com mais de dois minutos, baixa confiança ou timeout transfere para a equipe. Imagem isolada permite consulta, sem executar ações só por conteúdo visual. Não enviar dados de cartão no chat.

## Interrupção e recuperação

Desligar `botAtivo` pelo painel interrompe o atendimento automático. Para retirar o teste interno no servidor, recriar apenas o app com os arquivos `composeAtual` registrados na publicação, sem o override `atendimento-teste.json`; isso restaura os controles bloqueados. Não apagar as colunas novas nem executar migração reversa. As imagens anteriores, volumes, backups e arquivos privados ficam preservados. A publicação seguinte também redefine a flag de teste para falso.

Reativação de 20 clientes, créditos de indicação, notificações, cobrança automática e migração financeira continuam sujeitos aos seus próprios testes e conferências. Esta ativação não dispara campanhas.

## Verificação

Checks do projeto: `npm run check`, `npm run check:publicacao`, testes Python de publicação e CI Linux com banco descartável. A imagem ASR executa testes Python e smoke HTTP com fala sintética durante o build, repetido sob os limites do servidor antes da ativação. O registro cifrado deve confirmar revisão, equipe autorizada, conexão e ativação; não contém chaves nem números.

Sugestão de quatro ciclos adicionais de revisão pelo escopo financeiro e conversacional. Prompt: “Revise em quatro ciclos: (1) identidade e restrição ao teste interno; (2) faturas, créditos, concorrência e auditoria; (3) mídia, transferência e retomada humana; (4) deploy, backup, recuperação e integração. Registre severidade/local/evidência, confira correções com os checks pertinentes e não dispare campanhas.”

## Retomada por capacidade

A tentativa `42540222787`, revisão `102a3911fd6b38c635af9cf9cb7718e04f0796db`, parou em `preservar`, antes de isolar escritores ou migrar. O inventário posterior confirmou app e banco saudáveis, 3.964.219.392 bytes livres e nenhum cache privado recuperável. A reserva de clone, WAL, dump e restauração permanece obrigatória.

O fluxo de arquivamento conserva os mesmos três workers históricos e IDs exatos; a imagem saudável esperada foi atualizada conforme inventário para `a2a78e0a4ab504fa65cb72c9c21130e05a261c2b4134bc3b41532fc407a187d6`. Cada alvo exige cópia com checksum, Docker Load e render isolado antes de descarregar somente sua tag. Containers, volumes, backups, configurações e cópia comprimida permanecem.

A restauração reutiliza o verificador OCI existente, que valida a cadeia de índice, manifesto, configuração e layers, incluindo a identidade retornada pelo Docker clássico ou containerd. A opção `retomar` do arquivamento reutiliza somente uma preparação ainda incompleta com checksum, identidade e preservação reconferidos; não cria outra cópia nem repete uma conclusão.

A prova técnica de IA é empacotada com o SDK do lockfile e enviada por stdin ao container. Ela não exige que o standalone do Next mantenha `@anthropic-ai/sdk` como pacote externo. O teste sintético verifica GET de metadados, a mensagem limitada a 32 tokens e rejeição de chave, sem expor credenciais. O procedimento operacional atual importa helpers da release publicada e não reescreve seu pacote. Modelo, cliente e autenticação do bot permanecem os mesmos. A ativação continua recusada se a prova real não responder.

`retomar-atendimento.yml` atende exclusivamente essa revisão interrompida. Exige o registro exato anterior ao isolamento, ausência de recuperação pendente, mesma imagem/compose/backup, as mesmas duas migrações pendentes e reserva suficiente. Preserva o registro em `operacao-interrompida-preservar.json` e executa o publicador original, sem pular backup, restauração ou ensaio. Recusa segunda retomada. A ativação pode selecionar o SHA efetivamente publicado, conferido novamente pelo script instalado.

Para revisão posterior, sugiro 4 ciclos: identidade e preservação do arquivamento; recusa de retomada após isolamento; backup/ensaio/recuperação; integração e ativação restrita. Prompt: “Revise estes quatro ciclos, com evidência por arquivo e checks reais; corrija achados e termine verificando integração, sem ampliar ações externas.”
