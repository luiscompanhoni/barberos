# Publicação e recuperação segura

Este é o procedimento vigente para app, PostgreSQL, proxy, Evolution, backup e worker do Estúdio. Implementação local não comprova implantação. Publicação, parada de produção e liberação após incidente exigem autorização específica do dono, com revisão, janela e responsáveis. Nunca restaurar automaticamente um banco antigo sobre gravações novas.

## Antes de publicar

Conferir revisão/imagem instalada, Compose real, volumes e histórico/checksums das migrações. Exigir CI Linux da nova revisão e ensaio Linux/Docker do backup e recuperação. Mocks no Windows não comprovam symlink, `O_NOFOLLOW`, Docker ou filesystem da VPS.

Medir banco, mídias e todos os filesystems. A reserva cresce com dump, clone PostgreSQL/índices/WAL, arquivo de mídia, materialização, criptografia temporária e margem. Não depender de compressão nem apagar dados/backups/imagem anterior para forçar aprovação. Revisar cada SQL pendente: uma lista fechada não autoriza automaticamente migração nova pelo nome “aditiva”.

Conferir cópia externa restaurável e cofre de configuração/segredos, código e imagens. Banco e mídia não bastam para reconstruir o host. Estimar a janela com o ensaio: ingresso, app, Evolution, worker e backup ficam parados durante cópia prévia/migração. Não prometer indisponibilidade zero.

## Sequência e falhas

O publicador grava `recuperacao-pendente.json` fora do banco antes de isolar. O marcador persiste se o processo cair e impede repetir a publicação sem revisão humana. Exige banco sem porta publicada, só na rede prevista, nenhum container de outro projeto nessa rede e nenhuma conexão cliente após parar os containers do projeto. Mantém apenas o banco. Conexão desconhecida bloqueia, não é terminada cegamente. O isolamento pressupõe acesso administrativo host/Docker controlado.

Com escritores parados: backup, restauração isolada, comparação dos dados/schema/mídia e ensaio da migração. Só depois migra o banco real. O app novo sobe com todos os efeitos externos bloqueados. O ingresso volta após saúde interna/controles; worker, backup posterior e controles finais são conferidos. Evolution anterior só retorna ao terminar. Sucesso registra revisão e remove marcador.

| Falha | Estado seguro | Continuação |
|---|---|---|
| Antes do isolamento | Instalação preservada | Resolver preflight; sem migração |
| Após isolamento, sem iniciar migração | Retorno à mesma imagem/schema, com todos os efeitos externos bloqueados e conferidos | Proxy pode voltar; auxiliares ficam pausados. Conferir registro antes de retomá-los |
| Durante/depois de iniciar migração | Containers do projeto, exceto banco, parados; marcador permanece | Recuperação manual; sem banco ou imagem anterior automática |
| Parada/controle não confirmado | Estado incerto registrado, sem sucesso | Conferir host/conexões e impedir ingresso antes de avançar |

Rollback sem migração reaplica todo `CONTROLES_PUBLICACAO`, mesmo se `.env` antigo permitia envios/IA. Mensagens operacionais, execução de IA, campanhas, push, cobrança/emissão automáticas e Meta permanecem bloqueados, maquininha manual. A exceção já autorizada de códigos de login solicitados pelos próprios clientes permanece conforme `OTP_PROVIDER`; esse controle não significa zero mensagens. O lote Pix continua sem ação de envio no contrato compilado. Pagamentos manuais não são autorizados por uma publicação nem ficam bloqueados apenas pelo flag de emissão automática. Exige imagem e flags do container. É retorno restrito, não retomada de todos os serviços. Depois de iniciar uma migração, leitura do Prisma anterior não prova escrita compatível e não autoriza retorno.

## Recuperar após migração ou restaurar dados

1. Preservar operação, marcador, imagens/configuração e banco pós-falha. Não editar `_prisma_migrations`, checksums ou usar `migrate resolve` sem diagnóstico específico.
2. Isolar ingresso e todos os escritores: app, cron/jobs externos, Evolution/webhooks, worker e backup. Rever conexões, redes e portas. Efeitos em voo podem ter concluído no fornecedor depois da parada.
3. Restaurar **dump + `.manifesto.json` + `.studio.tar.gz`** para banco e volume novos. `backup.sh restaurar` recusa destino existente e não troca produção. Cópias antigas sem manifesto não passam no novo verificador; somente inspeção isolada por plano próprio, sem prova retroativa inventada.
4. Comparar todas as tabelas/linhas, migrações, colunas, constraints, índices, triggers, funções, privilégios, enums e definições de sequência. Conferir `last_value/is_called` restaurados contra os blocos `SEQUENCE SET` do próprio dump autenticado pelo SHA; formato desconhecido ou sequência sem estado falha fechada. Esses valores não transacionais não são comparados ao snapshot ou à fonte viva. Sondas UPDATE/DELETE/TRUNCATE da auditoria só no restaurado, com rollback; o ensaio sintético também confere o próximo ID.
5. Materializar mídia em volume novo e conferir referência/hash. Não extrair sobre o volume vivo nem trocar só o banco mantendo mídia de outra geração.
6. Validar app sem ingresso/credenciais externas, com `BARBEROS_QUARENTENA_RESTAURACAO=true`, transportes simulados e rotinas bloqueadas. Quarentena não substitui isolamento. Para escrita funcional, liberar temporariamente só a cópia isolada, sem rede externa e com fornecedores falsos. Testar agenda/comanda/fechamento/estorno/folha; `SELECT 1`/`findFirst` não bastam.
7. Reconciliar eventos desde o backup: pagamentos, links, estornos, Pix, mensagens e origem. Consultar resultados incertos sem repetir cobrança/transferência. Preservar dados novos e preferir corrigir para frente quando necessário.
8. Apresentar plano concreto ao dono: banco/volume/imagem/revisão, hashes, testes, diferenças, responsáveis, janela e bloqueios mantidos. Aprovação de recuperação não ativa Pix, IA ou envios.
9. Após troca aprovada, conferir internamente schema/imagem/flags e abrir ingresso gradualmente. Retomar auxiliares separadamente com filas/idempotência conferidas. Retirar quarentena e arquivar marcador/registro só após aceite explícito. Remover marcador sozinho não recupera nada; manter os dados anteriores pela retenção aprovada.

## Manifesto, espaço e cópia externa

`backup-manifesto.py` mantém uma transação exportadora: `pg_dump --snapshot` e leituras SHA-256 por tabela importam o **mesmo snapshot**. Dados passam em streaming; manifesto guarda hashes, contagens e metadados, sem linhas pessoais. Troca de valor com mesma contagem falha. Mídias são pareadas ao dump e materializadas antes de declarar sucesso.

O grupo estrutural `enums` confere esquema/nome e a sequência dos labels pela ordem semântica do PostgreSQL; OIDs e números internos de ordenação não são persistidos, pois podem mudar no restore. Alterar um label não default deve falhar mesmo com a tabela que usa o enum vazia. A prova local renomeia esse label somente no restauro sintético, exige rejeição, reverte e compara novamente.

O aceite do publicador exige os oito grupos estruturais: colunas, constraints, índices, triggers, funções, sequências, enums e privilégios. O ensaio Linux/Docker usa o verificador empacotado na imagem, com enum não default, tabela vazia, valor trocado sem mudar a contagem, sequência alterada, trigger removido, auditoria imutável, mídia obrigatória e escrita real entre exportação do snapshot e dump. A implementação dos testes não substitui sua execução aprovada no CI da revisão.

A leitura dos estados de sequência reconhece os comandos produzidos por [`dumpSequenceData` do PostgreSQL16](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/bin/pg_dump/pg_dump.c), nos blocos `SEQUENCE SET`. Não executa SQL extraído do arquivo; usa apenas nome escapado, inteiro decimal e booleano para consultas de conferência no banco restaurado.

Manifestos anteriores sem `enums` não certificam essa estrutura. Os conjuntos de grupos precisam corresponder nos dois lados; não há fallback que ignore o grupo. Preserve os backups antigos e use o procedimento/leitor da versão correspondente para inspeção isolada, sem atribuir uma validação que não foi feita. Uma nova publicação exige gerar backup com comparador e manifesto compatíveis e validar sua restauração antes da migração.

Diferenças de CHECK só passam por comparador restrito de associatividade AND/OR, preservando folhas/precedência. Expressão desconhecida falha fechada; não é provador geral SQL. Roles/configuração do cluster não voltam só com dump; validar grants/owners no destino.

O backup mede espaço de dados por montagem somente leitura para `stat/statvfs`, sem copiar PostgreSQL físico vivo nem acessar socket Docker. Reserva dump, clone e criptografia. Dump, manifesto e mídias são criptografados para cópia externa; falha conserva arquivos locais. Senha/configuração precisam de cofre separado. Sem bucket, backup local pode passar, mas não protege contra perda da VPS.

## Atualização de folha com versões

As migrações da estabilização têm lista nominal fechada; não liberar por prefixo, quantidade de pastas ou aparência de alteração “aditiva”. Comparar nomes/checksums com o inventário atual, conferir contagens de conflitos sem expor pessoas e aplicar primeiro à restauração isolada. Índices novos podem falhar por duplicatas; não escolher nem apagar registros automaticamente.

A retificação conserva o fechamento anterior e permite uma substituta ativa. Isso muda a semântica das antigas chaves únicas e pode gravar estados que o binário anterior não conhece. Depois de iniciar a migração, manter a regra de quarentena e recuperação manual, ainda que tabelas/colunas tenham sido apenas acrescentadas. Após uma retificação, não retornar automaticamente ao aplicativo antigo; corrigir para frente com código compatível ou apresentar restauração coerente anterior às novas gravações, com reconciliação e aprovação específicas. Não usar `migrate resolve`, editar checksums ou remover a original para facilitar o retorno.

## Aceite para futura publicação

- Testes locais novos e suíte Linux/Docker da nova revisão aprovados; CI antigo não valida código alterado.
- Ensaio com escritor concorrente comprova snapshot único; valor trocado, trigger perdido, manifesto trocado e mídia ausente falham.
- Falhas durante/depois da migração mantêm instalação fechada; falha sem migração retorna com todos os bloqueios.
- Capacidade real por filesystem, janela e plano apresentados ao dono.
- Restore atual da VPS e da cópia externa comprovados separadamente. Testes locais não certificam esses arquivos.
