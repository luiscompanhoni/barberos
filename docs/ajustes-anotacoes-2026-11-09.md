# Ajustes das anotações — 09/11/2026

Implementação local sobre 28422c5, sem publicação, migração de produção ou ativação de transportes.
Os dados da homologação são fictícios. O ritmo do bot já existente na base foi preservado.

## Escopo entregue

1. Acesso único em `SITE_URL/entrar`, para todos os perfis. Senha e código usam o papel atual do banco;
   cadastro público continua criando somente CLIENTE. O cadastro de profissional e sua promoção continuam
   protegidos. As entradas antigas encaminham ao mesmo formulário.
2. Agenda do cliente: serviços múltiplos → profissional compatível → dia/horário livre → confirmação,
   sem aprovação da recepção. Seleção pela superfície do cartão, com contorno amarelo, duração e preço.
   A confirmação mostra o total e oferece antecipação opcional se já houver provedor configurado.
3. Posição dos planos editável no cadastro; posição menor aparece primeiro, seguida do preço para empates.
4. Cadastro de cliente por celular em Conversas, com normalização, reuso da identidade e auditoria.
   Não concede acesso, não envia mensagem, não altera nome ou consentimento existentes.
5. Pesquisa de conversas por nome ou telefone, sem respostas antigas substituírem consultas recentes.
6. Agentes junto de Estúdio em Criações.
7. Agenda abre diretamente pelo menu; Agenda, Meu dia e Semana ficam na própria área da agenda,
   conforme o vínculo e as permissões do usuário.
8. Data centralizada no cabeçalho da recepção em telas largas; controles empilham em telas pequenas.
9. Alternância das visualizações próxima dos filtros da agenda.
10. Indicadores integrados ao Financeiro no Painel do dono, com prioridades de ação. Permissões de
    resultado e distinção entre produção e caixa permanecem obrigatórias.
11. Claro, escuro, espacial e automático no rodapé da gestão. Automático usa São Paulo: 00–06h espacial,
    06–18h claro, 18–24h escuro. São faixas fixas explícitas, não cálculo astronômico do nascer do sol.
    A preferência é local por navegador; cliente e barbeiro preservam a identidade Black.
12. Manter pagamento apresenta a operação existente. Trocar forma só é permitido depois do cancelamento
    comprovado. Resultado incerto permanece em conferência; nenhuma nova cobrança é liberada por timeout.
13. Prévia visual da roleta no começo da configuração.
14. Botão central da roleta conserva a posição durante hover/clique; a animação só altera a escala.
15. Primeiro acesso sem vínculo de equipe é CLIENTE. O caminho de entrada não concede função profissional.

## Antecipação e preservação

O pagamento antecipado soma o grupo inteiro (inclusive adicionais pagos de um corte coberto por plano),
mantém um único pagamento na comanda e credita o valor uma única vez se o horário for cancelado.
Alterar o grupo com emissão pendente ou recebida exige conferência; não recalcula uma cobrança em aberto.

A migração aditiva `20261109220000_antecipado_emissao_segura` acrescenta `emissaoChave`, anulável e única,
em `pagamentos_antecipados`. Não reescreve valores, datas, identidade, status ou folhas históricas.
O claim e sua auditoria são gravados antes da chamada ao gateway. Timeout ou retorno monetário divergente
mantêm a tentativa reservada; não há repetição automática. Pedidos Pagar.me usam a referência como chave
de idempotência. Uma recusa só libera repetição se todas as tentativas estiverem definitivamente recusadas,
sem recebimento. Celcash exige transação única, valor e instante efetivo; pagamento externo ou data ausente
nunca viram comprovação automática.

### Recuperação

Antes de eventual publicação: conferir revisão e espaço, manter bloqueios, restaurar backup de banco e
configuração em ambiente isolado, validar schema/contagens e somente então migrar.

Se houver `emissaoChave` preenchida: preservar a linha e o evento `reservar_pagamento_antecipado`.
Conferir no provedor a referência `ag-<agendamentoId>-<chave>`, titularidade, moeda BRL, valor esperado,
identificador, estado e instante efetivo. Persistir conciliação auditável somente com prova suficiente;
resultado desconhecido continua bloqueado. Não limpar claim, gerar substituta, estornar ou repetir Pix
para tentar resolver uma incerteza.

Retorno de aplicação: conservar a coluna e os dados. Uma versão antiga que ignore o claim não pode
voltar com emissão de pagamentos ativa: bloquear o endpoint no ambiente de recuperação ou usar correção
compatível. Não remover a coluna, não restaurar banco antigo sobre novas operações e não apagar auditoria.
O ensaio de restauração local usa somente o banco descartável nominal; não comprova backup de produção.

## Dependências externas

Google, Facebook e Apple não foram ativados: o dono confirmou que ainda não há aplicativos cadastrados.
Não foram inventadas credenciais nem aceitos termos em seu nome. Consulte [preparação do login social](login-social-cadastro.md).
O acesso por celular/senha/código permanece disponível e sujeito aos bloqueios de transporte vigentes.

## Validação

Banco exclusivo: PostgreSQL local em 127.0.0.1:55549, `barberos_anotacoes_teste_20261109`, com seed fictício.
Os testes novos recusam outro banco; gateways e WhatsApp são simulados. Nenhuma chamada financeira real.

- `npm run check`: lint, regras locais, tipos, unitários e build.
- `npm run teste:agenda:cliente`: identidade, disponibilidade, concorrência, grupos e legado.
- `npm run teste:anotacoes`: identidade do contato, auditoria, grupo, concorrência, cancelamento e emissão incerta.
- `npm run teste:login`, `npm run teste:antecipado`, `npm run teste:checkout`: regressões dos fluxos existentes.

### Resultado da implementação anterior à revisão

`npm run check` terminou com saída 0 depois dos últimos ajustes visuais: lint, regras locais, tipos,
2.105 testes unitários aprovados (80 pulados; 236 arquivos aprovados e 8 pulados) e build de produção.
Os cinco comandos de fluxo acima também terminaram sem falhas no banco descartável, com gateways falsos.

No navegador local, foram conferidos acesso de dono e cliente pelo formulário comum, temas, data da agenda,
posição editável dos planos, cadastro e pesquisa de conversas, indicadores no Financeiro e teste visual da
roleta. O centro do botão foi mantido durante o giro. No celular, Corte + Barba foram confirmados diretamente
para 60 minutos e R$ 90; a antecipação foi apresentada como opcional. Nenhuma cobrança foi emitida nessa
conferência visual. Não houve estouro horizontal na tela de confirmação testada.

O backup sintético foi restaurado com `pg_restore --exit-on-error` em
`barberos_anotacoes_restore_20261109`. O snapshot anterior à conferência visual tinha 124 tabelas,
88 migrações, 19 clientes, 20 agendamentos, 191 eventos de auditoria e 8 antecipações (2 claims em conferência).
Contagens e hash das colunas anteriores coincidiram. A migração foi ensaiada dentro de uma transação na
cópia restaurada, preservando as linhas e colunas anteriores; índice único verificado e rollback concluído,
com os claims originais intactos. Isso comprova recuperação local, não o backup da VPS.

Não houve commit, push, CI Linux, deploy ou migração de produção.

## Revisão formal em quatro ciclos

Concluída em 09/11, com oito achados corrigidos. O check final passou com 2.116 testes unitários;
os cinco fluxos passaram com 127 verificações registradas. Novo backup sintético restaurado, 124 tabelas
comparadas integralmente e migração/rollback ensaiados preservando sete claims de emissão em conferência.
[Achados por ciclo, provas, logs, limites e recuperação](revisao-anotacoes-4-ciclos-2026-11-09.md).

## Preparação da publicação autorizada

O CI Linux inclui os fluxos `teste:agenda:cliente` e `teste:anotacoes` em banco efêmero nominal na porta 55549,
com role exclusiva sem criação de bancos e gateways simulados. As guardas dos testes foram preservadas.
`teste:todos` exige `DATABASE_URL_ANOTACOES` para esses dois fluxos, sem fallback para o banco genérico;
o destino deve ser o banco nominal em `127.0.0.1:55549`, migrado e com seed sintético.
O publicador aceita nominalmente a migração aditiva `20261109220000_antecipado_emissao_segura`;
variações do nome e migrações não revisadas continuam bloqueadas por teste.
A troca continua condicionada à conferência da imagem instalada, espaço, backup restaurado e ensaio no clone.
Os controles de publicação também desativam o teste interno de atendimento e a mídia, além dos bloqueios gerais.

O dono autorizou a manutenção nominal dos renderizadores `102a391` e `d10b3b1` para obter reserva de disco.
`renderizadores-autorizados.json` fixa somente esses dois IDs, tags e RootFS, vinculados ao app instalado `28422c5`.
O workflow `arquivar-renderizadores-vps.yml` reutiliza o protocolo de arquivo autenticado, preserva o catálogo
histórico de apps e exige CI da main aprovado. Uma imagem por operação: cópia preservada na VPS, restauração
em executor Linux sem a imagem preexistente, conferência de identidade e render sintético de vídeo e áudio
sem rede. A remoção recebe somente a prova exata de arquivo/alvo/hash/bytes; versões atual e anterior,
ASR, bancos, volumes, mídias e backups continuam fora dos alvos. Parar quando houver espaço suficiente.
