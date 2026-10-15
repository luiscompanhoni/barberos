# Pendências do BarberOS

Lista de trabalho combinada em 14/10/2026. Os números são os da lista original (1 a 41). Cada item diz o que
**já existe** no sistema e o que **falta**. Itens já concluídos ficam no fim, só para registro.

Legenda: 🟡 parcial (falta o que está listado) · ⬜ não começado · 👤 depende de ação sua (fora do código)

---

## Fase A: lançamento (meta do item 40)

Entrega: base migrada e validada, pagamentos funcionando, permissões, app funcionando, WhatsApp preparado, roleta
rastreável e o primeiro grupo de clientes pronto para entrar. Jogos, IA e financeiro pessoal só depois disto.

### A0. Abertos desta semana
- [ ] Achar a causa do 404 em appblackbarber.com (preciso do link exato que deu erro). 👤
- [ ] Merge do PR #2 (README, CEP da Pagar.me, página 404 em português) e deploy (`bash scripts/deploy.sh root@IP`). 👤
- [ ] Conferir `WHATSAPP_NUMERO_PUBLICO` no `.env` do servidor (botão do WhatsApp na página 404 e na vitrine). 👤
- [ ] Confirmar `PAGAMENTOS_PROVIDER` no servidor: vazio = modo simulado (nada é cobrado de verdade). 👤

### 1. Migração CashBarber → BarberOS (prioridade máxima) 🟡
Já existe: scripts de importação de cadastro (serviços, barbeiros, planos, produtos), clientes (telefone, CPF,
e-mail, nascimento; telefone repetido vira um cadastro só), assinantes, histórico (agendamentos com barbeiro,
comandas e pagamentos, horários futuros) e mensalidades pagas. Rodar de novo não duplica. Telefone é único no
banco; cada cliente tem ID interno. Última visita e frequência saem do histórico importado.

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
Objetivo: fechar por mês faturamento, despesas e lucro com o que de fato entrou e saiu. Fontes:
- **CashBarber:** tudo o que já existe lá entra no BarberOS, conferido tópico por tópico. Já entram clientes,
  assinantes, histórico, as entradas das Movimentações e as mensalidades. Faltam as saídas: despesas, contas
  a pagar e sangria/suprimento do caixa.
- **Celcash (Celcoin):** o dinheiro que realmente entrou, com as taxas, os estornos e as saídas (saques e
  transferências). Cobre o que faltar no CashBarber.
- **Stone (depois):** extrato bancário. Fecha o veredito de faturamento, despesa e lucro.
- **Dinheiro em espécie:** não tem fonte externa. Só o fechamento do caixa.

Decidido com o dono (15/10):
- **Celcash:** acesso pela chave de API.
- **CashBarber:** acesso pelo login do painel.
- **Período:** todo o histórico.
- **Credenciais:** ficam como segredo do ambiente da sessão na nuvem, nunca no chat nem no projeto:
  `CELCASH_GALAX_ID`, `CELCASH_GALAX_HASH`, `CELCASH_AMBIENTE=producao`, `CASHBARBER_EMAIL` e
  `CASHBARBER_SENHA`. Uma sessão nova lê os segredos.
- **Dados pessoais baixados:** ficam fora do projeto (scratchpad da sessão).

O que já se sabe (para a próxima sessão):
- **Celcash API v2** (`https://api-celcash.celcoin.com.br/v2`, responde daqui). Token como em
  `src/lib/pagamentos/celcash.ts`. Endpoints:
  - Extrato: `GET /company/balance/movements` (escopo `balance.read`).
  - Saldo: `balance/get-balance`.
  - Transações: `GET /transactions` (escopo `transactions.read`).
  - Taxas: `fees/list`. Chargebacks: `chargebacks/list`. Antecipações: `antecipation/list`.
  - A documentação (docs-celpayments.celcoin.com.br) não mostra os campos: ver a resposta real com a
    chave, pedindo só escopos de leitura.
- **CashBarber:**
  - O painel (`painel.cashbarber.com.br`) é um app React que fala com `https://api.cashbarber.com.br`.
  - Login: `POST /api/auth/login` com `{ email, password, captchaToken }`. O token vem do reCAPTCHA
    Enterprise, então entrar pelo navegador (Chromium/Playwright já instalado).
  - Pode pedir verificação em duas etapas (`/api/auth/mfa/verify`).
  - Depois do login, achar os endpoints dos relatórios no próprio app.
  - O painel usa a Galax Pay (Celcash) para cobrar as assinaturas.

Etapas:
- [ ] Baixar do CashBarber todo o histórico (cadastros, agendamentos, movimentações com entradas e saídas,
      faturamento, despesas e contas a pagar, caixa) e comparar, tópico por tópico, com o que já está no BarberOS.
- [ ] Importar o que falta, sem duplicar, incluindo despesas e as saídas do caixa.
- [ ] Sincronizar o extrato e as transações da Celcash no BarberOS: guardar cada movimento, e o servidor
      atualiza todo dia.
- [ ] Tela "Resultado do mês", lado a lado:
      - o faturamento registrado por forma;
      - o que caiu na Celcash;
      - as taxas, os estornos, as saídas e as despesas;
      - o lucro, com as divergências marcadas.
- [ ] Stone: importar o extrato bancário na mesma tela.

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
- [ ] LGPD ⬜: termos de uso, política de privacidade, consentimento e pedido de exclusão/exportação dos dados.

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
- [ ] 25. Avaliação anônima do atendimento ⬜: nota + comentário (atendimento, corte, ambiente, pontualidade),
      anônima para o barbeiro, ligada ao atendimento para a administração, média por profissional.
- [ ] 24. Outros jogos ⬜: motor único de recompensas (prêmio, probabilidade, custo, validade, resgate, antifraude),
      depois raspadinha e baú. A roleta atual é a base.
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
  - "Baixou o app": o app ainda não é instalável (sem PWA), então conta quem entrou na área do cliente.
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
