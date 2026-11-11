# Quadro operacional de migração das assinaturas

Implementação local de 08/11/2026. A página `/migracao-assinaturas` e a API `/api/migracao-assinaturas` são exclusivas de dono e gerente. A disponibilização depende da publicação e da migration do modelo `MigracaoAssinatura`; a entrega local não aplica o banco de produção.

## O que faz

- Mostra inventário local com paginação de 100 contratos, filtro por etapa e pelo responsável pela última conferência. A leitura não grava controles.
- Inclui contratos Celcash, Cash Barber, contratos sem origem identificada e contratos que já tenham controle. Preserva históricos cancelados e os distingue de contratos passíveis de migração.
- Mostra totais, contratos cancelados, registros sem controle e conclusões declaradas pela gerência. Esses totais não representam automaticamente assinantes adimplentes nem cobertura completa do Cash Barber.
- Permite iniciar um controle único por assinatura, preservar o identificador legado e registrar conferência gerencial com versão, responsável, referência interna e auditoria na mesma transação.
- Usa a trava comum da assinatura e bloqueio da linha para evitar alteração concorrente do contrato durante o registro. A atualização exige a versão e o preço/plano/ciclo/vencimento exibidos. Retry idêntico da última gravação retorna o resultado sem duplicar auditoria.
- Mantém as etapas A conferir → Pronto → Convite registrado → Início registrado → Meio de pagamento conferido → Legado conciliado → Concluído por conferência gerencial. Ajuda, Adiado e Não contatar interrompem o percurso; retomada passa por A conferir. Conclusões não são reabertas por este fluxo.

## Evidência e limites

Todas as evidências deste quadro são identificadas como `MANUAL_GERENCIA`, com quem conferiu e quando. Marcar uma confirmação não equivale a consultar API, receber webhook, executar migração ou comprovar envio de uma mensagem. Os estados Convite/Início são registros de acompanhamento humano.

Para avançar, a gerência precisa conferir contrato, titular, preço, ciclo já pago, vencimento e rota segura. As etapas finais exigem vínculo ao titular/contrato no destino, consentimento aplicável, interrupção da recorrência antiga e uma única próxima cobrança. A conclusão também exige que a assinatura local já esteja efetivamente ligada ao identificador de destino, tenha início do ciclo pago conciliado e não esteja cancelada. Vínculos ambíguos, origem desconhecida ou múltiplos contratos vigentes do mesmo cliente bloqueiam o avanço para conferência específica.

O quadro **não cria, cancela, cobra, troca cartão ou envia mensagens**, nem altera o cadastro da assinatura. Não transfere tokens entre provedores. A execução financeira depende da rota segura e dos procedimentos de migração documentados em `migracao-assinaturas-novembro-2026.md`, com conferência nos dois provedores.

Pagamentos históricos Celcash sem contrato local não aparecem como assinaturas migráveis por inferência. Devem passar pela conciliação existente no Financeiro; só depois o contrato correto entra no controle. Preservar origem, vínculo e período pago.

Guarde nos campos apenas o identificador do contrato e o código da conferência interna, como `REV-2026-001`. Não copie PAN, CVV, senha, OTP, tokens, CPF, extratos ou links de pagamento. O formulário não oferece um campo livre para anexar conversas ou documentos. A referência de evidência aceita códigos curtos e recusa URLs, números longos e padrões usuais de credenciais.

## Conferência da base CashBarber

Exporte a lista completa de clientes e a lista de contratos na mesma data de corte, incluindo todas as situações, e anote a data e os totais do painel. Para cada contrato, guarde o identificador de origem, titular, plano e preço contratados, situação, datas do ciclo, último pagamento confirmado, próximo vencimento e eventual fim de acesso. Se o CSV de assinantes só trouxer nome, plano, situação e data de criação, consulte o detalhe do contrato ou um relatório complementar. Compare o pagamento e os estornos com o extrato do gateway ou comprovante identificado. A data de cadastro, a data do recebimento e o vencimento são campos distintos.

Em um banco restaurado para conferência, execute `npx tsx scripts/relatorio-migracao.ts --clientes=Clientes.csv --assinantes=Assinantes.csv --saida=<pasta-privada>`. O comando só lê o banco. A lista de clientes precisa de `Nome` e `Telefone`. A de assinantes precisa de `Cliente`, `Plano` e `Status`, com `CPF` ou `Telefone` para conferir o titular, `ID da assinatura` ou `ID do contrato` para rastrear a origem, além de `Próximo vencimento` e `Último pagamento`. Datas aceitas em `DD/MM/AAAA` ou `AAAA-MM-DD`. Campos ausentes ou divergentes ficam em revisão. Os CSVs de conferência identificam cada registro pela posição no arquivo e pelos IDs disponíveis. O console mostra totais, motivos e o SHA-256 de cada arquivo. Mantenha fontes e resultados em pasta privada fora do Git.

Use as listas de pendências e os registros locais sem correspondência para conferir os dois sentidos. A soma dos registros sem divergências e dos registros com pendência deve bater com o total de cada exportação. Os totais por situação da origem contam linhas, inclusive possíveis duplicatas. Para fechar a quantidade de inadimplentes, concilie cada ciclo vencido, confirme o status do pagamento e remova duplicidades por contrato. A situação atual também precisa de uma extração da data de corte. Homônimos, telefones compartilhados e estados de origem desconhecidos ficam para conferência. O script aponta diferenças de cadastro, plano, status e datas disponíveis. Preço contratado, eventual fim de acesso, validade de comprovantes e destino da cobrança continuam sujeitos à verificação do contrato e do provedor antes da virada.

## Pagamentos por ciclo na Celcoin

Para uma conferência somente por arquivos, exporte os clientes do CashBarber e os relatórios de contratos e transações da Celcoin. Use o mesmo dia de corte para as fontes. Nas transações, filtre por vencimento e inclua todos os estados. O relatório de assinaturas do CashBarber pode acompanhar a conferência, mas as linhas do Relatório 19 sem ID e sem documento ou telefone ficam como totais declarados.

```sh
npx tsx scripts/conferir-cashbarber-celcoin.ts --clientes=Clientes.csv --assinaturas-cashbarber=Relatorio19.csv --contratos=ContratosCelcoin.csv --transacoes=TransacoesCelcoin.csv --data-corte=AAAA-MM-DD --saida=conferencia-privada.json
```

O comando lê os arquivos e salva a conferência com os hashes, as referências de origem e as pendências por linha. Ele não acessa a rede nem altera o banco. O vínculo de titular exige nome completo coincidente e CPF ou celular válido, sem conflito entre os identificadores. As transações são agrupadas pelo ID exato do contrato e vencimento. Captura, compensação e Pix pago confirmam o pagamento do ciclo se o valor e o titular corresponderem. Pagamento registrado por fora exige comprovante. Estorno, duplicidade, situação desconhecida e conflito de identidade ficam em revisão. A data do status é usada para o corte, não como data de crédito na conta.

Um ciclo vencido no relatório não autoriza suspender o cliente. Antes de migrar, confira vínculos do mesmo titular, pendências de ciclos anteriores, plano e próximo vencimento. Trate ausência de uma cobrança no recorte como falta de evidência. Preserve os arquivos e o relatório privado fora do Git.

## Cadência preparada

`proximoPassoMigracao` calcula o próximo passo sem despacho ou rotina habilitada. Para utilizá-la operacionalmente, fornecer histórico comprovado dos contatos desta migração e a última comunicação global do cliente; o cadastro antigo, isoladamente, não comprova permissão de marketing.

- D0, quando a rota estiver pronta; D+2; D+5 oferecendo equipe/ligação humana; eventual aviso em 19/11.
- Até quatro contatos no período, com no mínimo 48 horas desde o último contato global. Não comprimir contatos para quem entrar tarde.
- Conclusão, recusa, exclusão, atendimento humano, Ajuda, Adiado e Não contatar encerram a recomendação automática. Em 21/11 ou depois, a função encaminha o processo para revisão humana das exceções.
- Sem confirmação de rota, canal, permissão e evento correspondente, não ativar um emissor nem usar a venda de nova assinatura como migração improvisada.

## Publicação e reversão

Aplicar a migration aditiva antes de publicar os leitores/escritores do quadro. Aplicação anterior pode continuar funcionando sem consultar a tabela nova. A reversão de aplicativo remove o acesso ao quadro e preserva controles/auditoria; não apagar registros e não reativar cobranças como rollback. Confirmar backup recuperável e procedimento de publicação do projeto antes da produção.

## Verificação local

Os testes `migracao-assinaturas-regras`, `migracao-assinaturas-servico` e `migracao-assinaturas-rota` cobrem avanço por evidência, impedimentos, históricos cancelados, mudanças concorrentes, retry, permissões, entradas e cadência. São provas unitárias com banco/provedores simulados; não demonstram portabilidade real, cancelamento remoto ou ausência de duplicidade nas contas de produção. A verificação do banco limpo e a homologação física da interface ficam para o fluxo de integração/publicação.
