# Pendências do BarberOS

Lista de trabalho combinada em 14/10/2026 e atualizada em 29/10/2026. Os números são os da lista original (1 a 41). Cada item diz o que
**já existe** no sistema e o que **falta**. Itens já concluídos ficam no fim, só para registro.

Legenda: 🟡 parcial (falta o que está listado) · ⬜ não começado · 👤 depende de ação sua (fora do código)

---

## Fase A: lançamento (meta do item 40)

Entrega: base migrada e validada, pagamentos funcionando, permissões, app funcionando, WhatsApp preparado, roleta
rastreável e o primeiro grupo de clientes pronto para entrar. Jogos, IA e financeiro pessoal só depois disto.

### A0. Abertos desta semana

- [ ] Publicar a etapa de aplicativo instalável e notificações (implementada em 28/10), configurar VAPID definitivo e validar instalação/envio em Android e iPhone físicos. Central, preferências, inscrição, revogação e transporte simulado implementados; nenhum push real foi enviado nesta entrega. [Guia de ativação](app-notificacoes.md).
- [ ] Achar a causa do 404 em appblackbarber.com (preciso do link exato que deu erro). 👤
- [x] PRs #1 a #8 mesclados na `main` (último em 28/10), com o CI verde.
- [ ] Conferir a versão no ar depois do deploy (`bash scripts/deploy.sh root@IP`): rodar `backup.sh agora`,
      reconectar a Evolution (entregue/lida), revisar a matriz de permissões e ligar os jogos que forem usar. 👤
- [ ] Conferir `WHATSAPP_NUMERO_PUBLICO` no `.env` do servidor (botão do WhatsApp na página 404 e na vitrine). 👤
- [ ] Confirmar `PAGAMENTOS_PROVIDER` no servidor: vazio = modo simulado (nada é cobrado de verdade). 👤

### 1. Migração CashBarber → BarberOS (prioridade máxima) 🟡
Já existe: scripts de importação de cadastro (serviços, barbeiros, planos, produtos), clientes (telefone, CPF,
e-mail, nascimento; telefone repetido vira um cadastro só), assinantes, histórico (agendamentos com barbeiro,
comandas e pagamentos, horários futuros) e mensalidades pagas. Rodar de novo não duplica. Telefone é único no
banco; cada cliente tem ID interno. Última visita e frequência saem do histórico importado.
Reimportar o histórico atualiza as reservas (atendida, cancelada ou sumida do CashBarber) e `--sem-lembretes`
segura os lembretes do BarberOS enquanto o CashBarber ainda manda os dele. As mensalidades que o CashBarber não
trouxe vêm direto do extrato da Celcash (`scripts/importar-mensalidades-celcash.ts`), sem duplicar.

Feito: `scripts/relatorio-migracao.ts` confere o banco e, com os CSVs do CashBarber, mostra quem ficou de fora.
Relatório na tela e em CSV:
- totais e dados completos;
- histórico, última visita por faixa e frequência;
- assinaturas;
- possíveis duplicados;
- incompletos.

Falta:
- [ ] Backup completo do CashBarber antes de qualquer alteração. 👤
- [ ] Rodar o relatório em produção com os CSVs do CashBarber e conferir a contagem (meta ~1.700 com histórico). 👤
- [ ] Revisar os assinantes sem vínculo e os possíveis duplicados que o relatório listar. 👤
- [ ] Vencimento e situação do plano dos assinantes vindos do CashBarber (hoje o vencimento é estimado pela adesão).
- [ ] Créditos/saldos do CashBarber: não são importados. Ver se existem e trazer como saldo.
- [ ] Serviço de cada atendimento antigo: o relatório não informa, entra como "Atendimento (CashBarber)".

### 9. Estorno só com autorização do dono: ✅ feito (ver "Concluídos")

### 10. Sistema geral de permissões: ✅ feito (ver "Concluídos")

### 11. Log de auditoria: ✅ feito (ver "Concluídos")

### 12. Erro de cartão 🟡
Já existe: correção do CEP de cobrança da Pagar.me (com hífen, todo cartão falhava). Está no PR #2.

Falta:
- [ ] Confirmar se era esse o erro (mensagem ou print do erro que aparecia). 👤
- [ ] Testar no ambiente de teste da Pagar.me: crédito, parcelado, recusado, pagamento duplicado, timeout,
      cancelamento. Débito: na maquininha.

### 13. Conciliação de pagamentos 🟡
Já existe: conciliação por dia e meio de recebimento, com taxas e prazos, líquido esperado, data prevista e situação
"conferido"/"divergente".

Falta:
- [ ] Buscar o que caiu direto da adquirente/banco (hoje o valor recebido é digitado).
- [ ] Situação por venda: aprovado, pendente, recusado, estornado, divergente.
- [ ] Alerta automático de divergência.

#### 13b. Conciliação completa: CashBarber + Celcash + Stone 🟡
Objetivo: fechar por mês faturamento, despesas e lucro com o que de fato entrou e saiu. Dinheiro em espécie não tem
fonte externa: só o fechamento do caixa.

Feito (14/10):
- **Extrato da Celcash dentro do BarberOS:**
  - Cada movimento é guardado uma vez e classificado: recebimento, taxa, antecipação, tarifa, estorno,
    transferência entre contas da empresa ou pagamento a terceiro.
  - O histórico inteiro é puxado pelo painel, e a rotina atualiza os últimos dias (no máximo 1x por hora).
- **Extrato da Stone:** o CSV sobe em Financeiro → Resultado. Cada linha entra uma vez, a tarifa vira taxa à parte
  e o repasse da Celcash conta como transferência.
- **Regras por nome:** por exemplo, CELESC → energia e sócio → retirada. Valem na Stone e na Celcash; "lembrar
  para esse nome" cria a regra e reaplica.
- **Resultado do mês**, com Celcash e Stone:
  - recebido por forma;
  - taxas, incluindo a da maquininha, estimada pelas taxas da conciliação;
  - despesas por categoria;
  - retiradas fora do lucro;
  - divergências de cartão, Pix e mensalidades.
- **Mensalidades da Celcash:** importador do que o CashBarber não trouxe, pareando com o que já veio de lá.
- **Acesso:** despesas e lucro só com a permissão "lucro", que fica desligada por padrão.

Falta:
- [ ] Saídas do CashBarber (despesas, contas a pagar, sangria/suprimento) não são importadas. Ver se ainda fazem
      falta depois do extrato da Stone.
- [ ] Rodar a sincronização da Celcash e subir o extrato da Stone em produção, todo o histórico, e conferir mês a
      mês. 👤
- [ ] Revisar a classificação das saídas e criar as regras por nome que faltarem. 👤

### 14. WhatsApp API oficial 🟡
Já existe: integração com a Cloud API da Meta (webhook assinado), modelos de código e de aviso, saída por "PARAR",
camada de envio separada (`src/lib/whatsapp/canal.ts`: oficial, Evolution ou simulador).

Falta:
- [ ] Decidir: oficial ou Evolution (QR code). O sistema não pode depender de uma sessão de QR code. 👤
- [x] Status de entrega por mensagem (entregue, lida, falhou): gravado pelo webhook da API oficial e da Evolution;
      aparece nas conversas (✓✓) e no funil das campanhas.
- [ ] Opt-in explícito e modelos de campanha aprovados na Meta. 👤
- [ ] Custo por campanha.

### 5. Antifraude da roleta: ✅ feito (ver "Concluídos")

### 4. Funil da campanha da roleta: ✅ feito (ver "Concluídos")

### 6. +1 giro na tela inicial: ✅ feito (ver "Concluídos")
- [ ] Testar num iPhone e num Android de verdade (já testado com tela de iPhone e Android emulada no Chromium). 👤

### 7. Home do cliente 🟡
Feito: nova ordem com plano em aberto no topo, giros e prêmios da roleta, próximos horários, agendar, saldo e
indicação, plano e histórico. Partes vazias não aparecem.

Falta:
- [ ] Loja (depende do item 20).

### 2. Segmentação da base para lançamento: ✅ feito (ver "Concluídos")

### 3. Painel de capacidade antes de cada campanha: ✅ feito (ver "Concluídos")

### 41. Motor de comissões: ✅ feito (ver "Concluídos")

### Outros itens da fase A (vindos dos blocos anteriores)
- [ ] 36. Backups: criar o bucket fora do servidor e preencher `BACKUP_S3_*` e `BACKUP_SENHA` (ver README). 👤
- [ ] 38. Homologação: criar o DNS `homolog.appblackbarber.com` e rodar `deploy.sh ... homolog` (ver README). 👤
- [x] LGPD (27/10): `/privacidade` e `/termos` (dados do controlador vêm do `.env`: `EMPRESA_RAZAO_SOCIAL`, `EMPRESA_CNPJ`,
      `EMPRESA_EMAIL_PRIVACIDADE` opcionais), aceite no cadastro e aviso para quem já tinha conta, "Meus dados" no app
      (mensagens de divulgação, cópia dos dados em JSON, exclusão imediata com anonimização), exclusão de candidato pela
      gestão e retenção de 12 meses das candidaturas. Falta: 👤 informar razão social e CNPJ; revisão jurídica do texto.

---

## Fase B: crescimento (depois do lançamento)

- [ ] 17. Recuperação de clientes antigos 🟡: as automações "chamar de volta" e "hora de voltar" já existem. Falta:
      campanhas diferentes por faixa (60–90, 90–180, +180), ofertas diferentes, métrica recuperados ÷ acionados.
- [ ] 8. Indicação ligada à roleta 🟡: o link/código individual, quem indicou, quem entrou e o prêmio após o 1º corte
      já existem. Falta: oferecer "indique e ganhe outro giro" depois do giro, prêmio em giro e o funil (agendou,
      compareceu).
- [ ] 15. Humanização do chatbot 🟡: o bot já responde preço, agenda, assinatura, cancelar, remarcar, serviços e
      barbeiros, e passa para humano. Falta: ajustar o tom da marca Black com conversas reais, localização e
      promoções, menos repetição.
- [ ] 18. Cancelamento de plano 🟡: motivo, pausa, desconto, gerente, fim do ciclo e painel de retenção já existem.
      Falta: mudança de data de cobrança e downgrade de plano.
- [ ] 16. Aba de prospecção / CRM comercial ⬜: pipeline Lead → Contatado → Interessado → Agendado → Compareceu →
      Cliente → Assinante, origem, responsável, último contato, próxima ação, valor potencial, follow-up automático.
- [ ] 20. Loja no app ⬜: produtos e estoque já existem na comanda. Falta: vitrine, carrinho, pagamento, retirada no
      balcão e recomendações pelo que o cliente compra.
- [ ] 19. Foto do cliente ⬜: envio pelo cliente ou pela recepção, compressão, consentimento, aparece no
      perfil/agendamento. A foto dos barbeiros já existe e serve de base.
- [ ] 25. Avaliação interna do atendimento 🟡: implementada em desenvolvimento para primeira visita, com nota/comentário, identidade exclusiva do dono, médias por profissional em lotes de cinco e recompensa idempotente. Falta publicar e configurar o jogo/canal real; recorrência além da primeira visita permanece futura. Ver [guia da equipe](evolucao-equipe.md).
- [x] 24. Outros jogos: ✅ feito (ver "Concluídos").
- [ ] 39. Analytics do produto ⬜: módulos usados, cliques, abandono, erros, telas mais acessadas.
- [ ] 37. Monitor de saúde 🟡: o `/api/saude` já existe. Falta: painel técnico (banco, pagamentos, WhatsApp,
      automações, erros) e alerta automático quando algo parar.

## Fase C: plataforma e IA

- [ ] 23. White-label 🟡: o nome da barbearia já é configurável. Falta: logo, cores, mensagens e regras
      configuráveis, e separar o que é da Black do que é da plataforma (várias barbearias).
- [ ] 26. Banco de barbeiros para contratação ⬜: cadastro de candidatos e pipeline
      Candidato → Triagem → Entrevista → Teste → Aprovado → Contratado.
- [ ] 29. Agente de crescimento ⬜: cruza agenda, CRM, capacidade, churn, assinaturas e ticket e recomenda ações.
      As "leituras automáticas" dos Indicadores são o começo disso.
- [ ] 27. Agentes de conteúdo ⬜: imagens, vídeos, calendário de conteúdo, histórico de criativos.
- [ ] 28. Agente gestor de tráfego ⬜: CTR, CPC, CPL, agendamentos, comparecimentos, receita, ROAS (caixa por real
      investido).

## Fase D: financeiro pessoal do barbeiro (produto separado)

- [ ] 34. Renda do BarberOS no financeiro pessoal ⬜: produção, comissão, produtos, bônus e descontos já estão no RH
      ("Meus números" e folha). Falta mandar isso para o financeiro pessoal.
- [ ] 35. Previsão de renda ⬜: agenda futura + histórico.
- [ ] 30. Dashboard financeiro pessoal ⬜.
- [ ] 32. Score de saúde financeira, explicando o porquê ⬜.
- [ ] 33. IA financeira com metas e plano mensal ⬜.
- [ ] 31. Conexão bancária via Open Finance (provedor autorizado, consentimento, nunca guardar senha) ⬜. Exige
      segurança bem acima do resto do sistema.

---

## Concluídos

- **9. Estorno só com autorização do dono:** a recepção pede; o dono recebe no WhatsApp e no painel (cliente, valor,
  venda, motivo, quem pediu), aprova ou recusa; tudo vai para a auditoria; a recepção não consegue estornar sozinha.
- **21. Separação de ambientes:** site (`appblackbarber.com`: vitrine, área do cliente e pagamentos) e painel
  (`painel.appblackbarber.com`: equipe), com logins separados; página do painel aberta no site vai para o painel e
  vice-versa; o barbeiro vê só o menu dele.
- **22. Domínio oficial:** domínio, SSL automático (Caddy), `www` e endereço antigo redirecionando. E-mail no domínio
  só se precisar.
- **25 (parte). Checklist da equipe:** tarefas por função, link sem login, pontos e faixas.
- **5. Antifraude da roleta:**
  - Um cliente por telefone e um ID por prêmio.
  - Validade e situação (a retirar, concluído, expirado); não entrega duas vezes.
  - Registro de quem entregou o brinde.
  - Custo interno de cada brinde (copiado no giro).
  - Relatório custo × faturamento com retorno por real e saldo da roleta em aberto.
- **6. +1 giro na tela inicial:**
  - Giro esperando aparece em destaque na tela inicial, com "Girar agora".
  - Depois de resgatar o prêmio, vem "Agendar para resgatar".
  - Brinde a retirar fica na tela inicial com "Agendar para resgatar".
- **41. Motor de comissões:**
  - Nomes novos: Receita de Assinaturas, Receita Distribuível e Créditos de Atendimento.
  - A Receita Distribuível considera só mensalidades pagas, desconta os estornos do período e deixa as taxas com a
    barbearia.
  - Avulso calculado sobre o valor efetivamente cobrado, com desconto e estorno proporcionais.
  - Comissão diferenciada (+pp) separada para assinaturas e avulsos, com motivo, quem autorizou e vigência. O que já
    valeu não se apaga, e mês com folha fechada não muda sem reabrir a folha.
  - Relatório com todos os campos e, num mês inteiro, salário, bônus, descontos e total a pagar.
  - Ajustes antigos convertidos sem mudar o percentual de ninguém.
  - Estorno feito depois do mês fechado desconta no mês em que foi feito (igual ao resumo financeiro).
- **36. Backups:**
  - Todo dia às 03h, com **restauração de teste** num banco separado (tabelas, última migração e contagens conferidas).
  - Backup obrigatório antes de cada deploy (se falhar, o deploy para).
  - Cópia criptografada fora do servidor (S3: Backblaze B2, Cloudflare R2...).
  - Painel do dono: Configurações → Backups e alerta se atrasar ou falhar. Restauração documentada no README.
- **38. Homologação:**
  - Banco e sistema próprios no mesmo VPS (`homolog.appblackbarber.com`, com senha e fora do Google).
  - Trava no código: WhatsApp, pagamentos e maquininha sempre simulados; faixa "HOMOLOGAÇÃO" em todas as telas.
  - Cópia da produção **anonimizada** para testar (`scripts/homolog-copiar-producao.sh`).
- **4. Funil da campanha da roleta:**
  - Cada mensagem de campanha tem um link próprio (`/c/r/<código>`, sem login).
  - Campanha da roleta: o link dá 1 giro de presente; o prêmio fica no número do cliente e a página leva para agendar.
  - Funil por campanha: enviadas → entregues → lidas → abriram o link → giraram → ganharam → abriram o app → têm conta
    → agendaram → compareceram → resgataram, com % e o faturado nas comandas desses atendimentos.
  - Entregue/lida vêm do WhatsApp (API oficial e Evolution); clique só conta em navegador de verdade.
  - "Baixou o app": o indicador continua contando quem entrou na área do cliente; não mede instalações. A instalação PWA foi implementada em 28/10, com publicação e validação física ainda pendentes. Não reinterpretar o histórico como instalações confirmadas.
- **2. Segmentação da base:** tela Campanhas com o tamanho de cada grupo (0–30, 31–60, 61–90, 91–180, +180 dias,
  assinante, ex-assinante, perdido, novo e quem nunca veio) e quantos podem receber. Campanha por segmentos, liberada
  em lotes, com limite diário; a primeira sugerida é para quem veio nos últimos 60 dias. Mostra enviados, quem marcou
  depois e quem pediu para parar.
- **3. Capacidade antes da campanha:** vagas e horas livres nos próximos 3, 7 e 14 dias por barbeiro, com os horários
  ociosos e "capacidade para ~X novos agendamentos". O lote sugerido sai dessa capacidade.
- **Qualidade:**
  - CI no GitHub (`.github/workflows/ci.yml`) a cada push na main e em cada PR: tipos, lint, testes unitários,
    migrações num banco limpo (e se o schema bate com elas), os 16 testes de fluxo (`npm run teste:todos`) e build.
  - Páginas de erro em português (`error.tsx` e `global-error.tsx`) com um código que aparece no log do servidor
    (`[erro] codigo=...`).
  - Exemplos de domínio no README, `.env.example` e `deploy/` trocados por `appblackbarber.com`.
- **10. Sistema geral de permissões:**
  - Papéis: dono (proprietário), gerente (administrador), recepção e barbeiro. O dono cria acessos de gerente e muda
    o papel de quem já tem acesso.
  - Gerente: o que a recepção faz + serviços, barbeiros, produtos, planos, horários de todos, roleta e configurações.
  - Matriz de permissões (Configurações → Permissões, só o dono): estorno, desconto, saldo, assinatura, caixa,
    comissão, folha, exclusão e resultado, por papel. O padrão mantém o que já valia, com uma exceção: excluir conta
    a pagar e estornar despesa paga agora precisam da permissão "excluir" (a recepção fazia).
  - O servidor confere cada ação; a tela esconde o que a pessoa não pode. Toda mudança vai para a auditoria.
- **11. Log de auditoria:**
  - Tela **Auditoria** (só o dono) com filtro por período, pessoa e tipo, agrupada por dia.
  - Alterações de serviço, plano, produto, barbeiro, cliente, configuração, acesso, desconto de comanda, ficha do
    funcionário, regras de comissão e roleta guardam o antes → depois só dos campos que mudaram (ex.: "preço:
    R$ 65,00 → R$ 50,00").
  - IP e aparelho de quem fez, em toda ação feita pelo painel ou pelo site (rotinas automáticas ficam sem).
  - Bloqueio no banco: o registro não pode ser alterado, apagado nem truncado, nem por script.
- **Item 18 (quase todo):** ver Fase B.
- **24. Jogos de recompensa:**
  - Motor único para Roleta Black, caixas-surpresa (Black, Gold e Legend) e Raspadinha Black. Os quatro vêm criados e
    desligados; o dono ou o gerente liga e ajusta cada um em `/jogos`.
  - Jogadas por atendimento (com valor mínimo), indicação, renovação do plano, aniversário e grátis a cada N dias.
    Cada evento libera uma vez só.
  - Prêmios com chance (total de 100%), raridade, estoque, limite por mês e custo. Tipos: crédito, brinde, serviço
    grátis, desconto e "não foi dessa vez". Há simulação antes de publicar.
  - Antifraude: sorteio no servidor gravado antes da animação, trava por cliente e a mesma jogada ao atualizar a
    página.
  - Caminho do prêmio: disponível → reservado (agendou) → utilizado (validado na comanda). Horário cancelado
    devolve, vencido expira, e só a gerência cancela, com motivo.
  - Campanha pode dar uma jogada de presente em qualquer jogo. O endereço antigo da roleta continua funcionando.
- **Serviço adicional na comanda** (fora da lista): sobrancelha junto do corte, por exemplo. Conta na comissão, no
  plano e nos relatórios, sem ocupar horário na agenda.
