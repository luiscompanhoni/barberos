# Revisão das anotações — quatro ciclos em 09/11/2026

Revisão local da implementação sobre `28422c5`, no diretório
`work/barberos-ajustes-anotacoes-20261109`. Inclui as 14 anotações e a entrada comum por perfil.
Não inclui publicação, operação financeira, mensagem externa ou ativação de IA/campanhas.

## Ciclo 1 — acesso, sessão e identidade

**R1 · P2 · Corrigido.** Uma conta CLIENTE ativa com ficha excluída ou ausente ainda podia entrar
por senha e manter sessão; o OTP também aceitava a ficha excluída antes de limpar credenciais legadas.
Locais: `src/lib/auth/acesso.ts`, `otp.ts` e `sessao.ts`.

Prova anterior: cinco regressões falharam. Correção: verificar existência e exclusão da ficha no login
por senha, emissão/consumo de código e revalidação da sessão. A prova do celular ainda pode vincular
um cliente importado legítimo; não restaura ficha excluída nem promove CLIENTE para equipe.
Verificação: 58 testes focados passaram, incluindo preservação das credenciais ao rejeitar o OTP.

Também conferidos: origem HTTP, redirecionamentos locais, papel atual do banco, versões de sessão,
cadastro público, logout e leitura dos cookies antigos. Login social continua indisponível porque
os aplicativos dos provedores não foram cadastrados.

## Ciclo 2 — agenda, dinheiro, concorrência e auditoria

**R2 · P1 · Corrigido.** Uma resposta atrasada do gateway podia cancelar ou confirmar uma cobrança
nova gravada no mesmo registro de antecipação. Local: `src/lib/agenda/antecipado.ts`.

Prova anterior em PostgreSQL: segurar a consulta de cancelamento, concluir outra consulta, emitir a
substituta simulada e liberar a primeira. A asserção da cobrança nova falhou. Correção: toda atualização
condicional confere `gatewayId`, valor, estado PENDENTE e ausência de claim. A confirmação recebida
na emissão também leva essa prova. A resposta antiga já não altera a nova tentativa.

**R3 · P1 · Corrigido.** Receber/creditar a antecipação não usava as mesmas travas da abertura e
do cancelamento da comanda. Local: `src/lib/agenda/antecipado.ts`.

Correção: travar ciclo do cliente e barbeiro, reler pagamento, agenda e comanda, conferir o contexto
e só então aplicar/creditar. A exclusão posterior do cliente não impede registrar um recebimento
comprovado. Cancelamento não gera crédito se o pagamento já estiver aplicado à comanda.
Verificação concorrente: recebimento e abertura simultâneos deixam um pagamento e saldo devido zero.

**R4 · P2 · Corrigido.** Cancelamento confirmado pelo provedor mudava o estado sem evento de auditoria.
Local: `src/lib/agenda/antecipado.ts`. Agora alteração e evento são atômicos. Consultas repetidas e
respostas antigas não duplicam o evento. Emissão e recebimento registram o identificador do provedor.

Conferidos ainda: duração do grupo, exclusão mútua na agenda, preço esperado, cobertura de plano,
titularidade, valores inteiros em centavos, BRL, instante recebido, recusa comprovada, cancelamento
incerto e ausência de estorno implícito. O bot legado continua sujeito à confirmação da equipe;
a confirmação direta é exclusiva do app com sessão e vínculo válidos.

## Ciclo 3 — permissões, interface e preservação

**R5 · P2 · Corrigido.** Cadastro por conversa confiava só na autorização anterior à transação.
Locais: `src/lib/clientes/conversa.ts` e `src/app/api/conversas/route.ts`.

Prova anterior em PostgreSQL: recepcionista desativada ainda cadastrava o contato. Agora a transação
trava e relê usuário, atividade, papel de balcão e versão da sessão. Casos de desativação, revogação
e troca para BARBEIRO são rejeitados sem auditoria de sucesso. Telefone, consentimento e nome existentes
continuam preservados. O fluxo não cria acesso de equipe nem envia mensagem.

**R6 · P2 · Corrigido.** Durante a confirmação do horário, Voltar e retirar prêmio ainda podiam mudar
a seleção mostrada enquanto o servidor salvava a anterior. Local: `src/components/cliente/AgendarTela.tsx`.
Os controles ficam bloqueados e a navegação também verifica a trava síncrona.

Prova visual com banco local deliberadamente ocupado: Voltar e Confirmando ficaram desabilitados.
Depois da falha controlada, a lista foi recarregada. Com a trava liberada, Corte + Barba foram
confirmados diretamente para 60 minutos/R$ 90, em 11/11 às 14h, sem emissão de cobrança.

**R7 · P3 · Corrigido.** A troca de etapa deixava o foco no documento e as buscas de horário/preço
não anunciavam seu estado. Mesmo componente: foco no título de cada etapa, estados de carregamento
anunciados e orientação para conferir os horários após falha. Um novo horário limpa o erro anterior.
Verificação no navegador: foco passou a Quando?/Tudo certo? na navegação entre etapas.

Também revisados: controles de seleção por teclado, nomes acessíveis, modal, pesquisa com resposta
antiga descartada, posição dos planos, abas da agenda, menu, roleta e isolamento dos temas ao CRM.
Indicadores continuam sujeitos à permissão de resultado e distinguem produção de caixa recebido.

## Ciclo 4 — integração, migração e recuperação

**R8 · P2 · Corrigido.** Domínios independentes ou subdomínios HTTP podiam receber um cookie sem
compartilhamento e entrar em ciclo de redirecionamento. Locais: `src/lib/dominios.ts` e `auth/sessao.ts`.

Prova anterior: emissão de sessão aceitava dois domínios independentes. Agora a escrita do cookie
recusa configuração incompatível com erro explícito. Mesmo host/protocolo, inclusive portas distintas,
e site com seu subdomínio HTTPS são aceitos. Cinco combinações de configuração e a recusa antes da
escrita do cookie têm testes. O exemplo local foi corrigido para o mesmo host.

A migração é aditiva: coluna anulável e única `emissaoChave`; não muda valores, status, identidade ou
histórico. Conferidos leitores, emissão, consulta, cancelamento, aplicação na comanda e claims órfãos.
Um claim sem resposta permanece em conferência; recuperar exige prova do provedor e auditoria,
sem limpar a reserva ou gerar cobrança substituta por tentativa.

Retorno de versão preserva coluna e dados. Uma versão antiga que ignore o claim só pode voltar
com a emissão bloqueada; preferir correção compatível. Não restaurar backup antigo sobre operações novas.
Ver o procedimento em [ajustes e recuperação](ajustes-anotacoes-2026-11-09.md#recuperação).

## Verificações finais

Banco exclusivo: `127.0.0.1:55549/barberos_anotacoes_teste_20261109`, dados fictícios.
Gateways falsos; os scripts novos recusam outro banco e bloqueiam rede.

Todos os comandos terminaram com saída 0:

| Verificação | Resultado |
|---|---|
| `npm run check` | Lint, regras locais, tipos, unitários e build aprovados |
| Unitários | 2.116 aprovados; 80 pulados; 236 arquivos aprovados e 8 pulados |
| `npm run teste:agenda:cliente` | 15 verificações aprovadas |
| `npm run teste:anotacoes` | 26 verificações aprovadas |
| `npm run teste:login` | 13 verificações aprovadas |
| `npm run teste:antecipado` | 18 verificações aprovadas |
| `npm run teste:checkout` | 55 verificações aprovadas, com Pagar.me/Celcash falsas |

O primeiro check encontrou duas fixtures antigas de sessão CLIENTE sem ficha. As fixtures agora têm
cliente ativo vinculado, mantendo a finalidade dos testes de versão e a rejeição de contas excluídas.
Os 69 testes focados de acesso passaram; depois o check completo foi repetido até o build aprovado.

### Restauração e migração

Backup sintético `backup-local-revisao.dump`, restaurado com `pg_restore --exit-on-error` em
`barberos_anotacoes_revisao_restore_20261109`, na mesma instância descartável 55549.
SHA-256: `5FE9A4833C978C9653C6D169DC44271B3AC065497B78D79E17D22C4ED1B89B6B`.

As contagens e hashes completos das **124 tabelas públicas** coincidiram entre origem e restauração.
Também coincidiram as duas sequências públicas. O snapshot tem 88 migrações, 32 clientes, 66 agendamentos,
368 eventos de auditoria e 28 antecipações, incluindo sete claims de falhas deliberadamente simuladas.

Somente na cópia restaurada, uma transação reproduziu o schema anterior e aplicou o SQL real da
migração. Conferidos valores/linhas legadas, claim inicialmente nulo e recusa efetiva de claims duplicados.
O rollback desse ensaio devolveu os sete claims; a comparação das 124 tabelas voltou a coincidir integralmente.
A origem não sofreu downgrade. Isso comprova recuperação local, não backup da VPS.

Evidências privadas: `outputs/revisao-anotacoes-20261109/`, com os logs dos comandos, hashes das tabelas,
SQL do ensaio, dump, comparação das sequências, screenshot e relatório HTML.

## Limites e pendências

- Cadastrar e homologar Google, Facebook e Apple nas contas administrativas antes de ativar login social.
- CI Linux, versão instalada e backup/restauração da VPS ficam para uma publicação autorizada.
- A prova local não homologa contratos, credenciais ou respostas dos gateways em produção.
- O tema automático usa faixas fixas de São Paulo (00–06/06–18/18–24), não o nascer do sol real.
- Não foram alterados os bloqueios de produção nem executados pagamentos ou mensagens reais.

As quatro rodadas foram concluídas; os oito achados estão corrigidos e as verificações acima passaram.
Não houve commit, push, CI Linux, deploy ou acesso ao banco de produção nesta rodada.
Pela fronteira de autenticação/dinheiro,
recomenda-se uma próxima revisão independente de três ciclos antes de publicar:

> Revise a versão candidata em 3 ciclos: autenticação e domínios; concorrência e prova de recebimento;
> migração, restauração e retorno de versão. Rode npm run check, teste:agenda:cliente, teste:anotacoes,
> teste:login, teste:antecipado e teste:checkout em banco local descartável. Registre divergências.
> Não publique nem ative envios, IA paga, campanhas ou pagamentos.
