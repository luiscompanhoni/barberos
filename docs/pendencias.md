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

Falta:
- [ ] Backup completo do CashBarber antes de qualquer alteração. 👤
- [ ] Conferência antes/depois em produção: total de clientes no CashBarber × no BarberOS (meta ~1.700 com histórico).
- [ ] Relatório consolidado da migração: importados, duplicados unidos, dados incompletos (sem telefone, sem
      nascimento, sem histórico), erros. Hoje cada script só imprime os números da própria execução.
- [ ] Assinantes: a ligação é pelo nome (o relatório do CashBarber não traz telefone). Revisar os que ficaram de fora.
- [ ] Vencimento e situação do plano dos assinantes vindos do CashBarber (hoje o vencimento é estimado pela adesão).
- [ ] Créditos/saldos do CashBarber: não são importados. Ver se existem e trazer como saldo.
- [ ] Serviço de cada atendimento antigo: o relatório não informa, entra como "Atendimento (CashBarber)".

### 9. Estorno só com autorização do dono: ✅ feito (ver "Concluídos")

### 10. Sistema geral de permissões 🟡
Já existe: papéis Dono, Recepção, Barbeiro e Cliente, com limites fixos no código (ex.: barbeiro só mexe na própria
agenda; recepção pede estorno, só o dono aprova; RH e resumo financeiro só o dono).

Falta:
- [ ] Papel Gerente/Administrador.
- [ ] Matriz de permissões por ação: estorno, desconto, alteração de comissão, saldo, assinatura, caixa, folha,
      exclusão de dados.

### 11. Log de auditoria 🟡
Já existe: tabela `auditoria` com usuário, data/hora e dados em mais de 60 tipos de ação (caixa, comandas, estornos, RH,
roleta, agenda, links, senhas...).

Falta:
- [ ] Tela para o dono consultar o log (filtro por pessoa, data, tipo).
- [ ] Valor anterior → novo em todas as alterações (ex.: "R$ 65 → R$ 50").
- [ ] IP/dispositivo nas ações críticas.
- [ ] Log que não pode ser apagado (bloqueio no banco).

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

### 14. WhatsApp API oficial 🟡
Já existe: integração com a Cloud API da Meta (webhook assinado), modelos de código e de aviso, saída por "PARAR",
camada de envio separada (`src/lib/whatsapp/canal.ts`: oficial, Evolution ou simulador).

Falta:
- [ ] Decidir: oficial ou Evolution (QR code). O sistema não pode depender de uma sessão de QR code. 👤
- [ ] Status de entrega por mensagem (enviada, entregue, lida, falhou).
- [ ] Opt-in explícito e modelos de campanha aprovados na Meta. 👤
- [ ] Custo por campanha.

### 5. Antifraude da roleta 🟡
Já existe: giro por cliente (telefone único), ID por prêmio, validade, status (a retirar, concluído, expirado),
sorteio no servidor, limite mensal por prêmio, registro de quem entregou o brinde.

Falta:
- [ ] Custo interno de cada prêmio.
- [ ] Relatório: custo da campanha × faturamento gerado.

### 4. Funil da campanha da roleta ⬜
Hoje ficam registrados o giro, o prêmio, o atendimento e o valor gasto, mas não a origem.

Falta:
- [ ] Rastrear: mensagem enviada → entregue → clique → landing → giro → prêmio → abriu o app → criou conta →
      agendou → compareceu → resgatou → quanto gastou.
- [ ] Dashboard de conversão do funil.

### 6. +1 giro na tela inicial ⬜
- [ ] Mostrar o giro/prêmio pendente na tela inicial do cliente, com "Girar agora" e depois "Agendar para resgatar".
- [ ] Testar o fluxo inteiro em iPhone e Android.

### 7. Home do cliente 🟡
Já existe: próximos horários (remarcar/cancelar), plano, lista de espera, saldo e indicação; menu com Agendar,
Planos, Roleta, Saldo e Perfil.

Falta:
- [ ] Reorganizar: próximo horário, "Agendar", prêmios/giros, saldo, plano, indicação, loja e histórico, sem excesso.

### 2. Segmentação da base para lançamento ⬜
Hoje: os indicadores mostram base ativa/sumindo/perdida, e a automação "chamar de volta" manda até 15 por rodada.

Falta:
- [ ] Segmentos automáticos com tamanho de cada grupo: 0–30, 31–60, 61–90, 91–180, +180 dias, assinante,
      ex-assinante, perdido, novo.
- [ ] Campanha por segmento, em lotes, com limite diário de envio. Primeira campanha: só quem veio nos últimos 60 dias.

### 3. Painel de capacidade antes de cada campanha ⬜
Hoje: o painel mostra o tempo livre de hoje e os indicadores mostram a ocupação passada.

Falta:
- [ ] Horários livres nos próximos 3, 7 e 14 dias, por barbeiro, com os horários ociosos.
- [ ] Sugestão "capacidade para ~X novos agendamentos", usada para limitar o lote da campanha.

### 41. Motor de comissões 🟡
Já existe: o pote de assinaturas faz exatamente a conta pedida: só mensalidades pagas, sem taxas, divididas pelas
fichas dos atendimentos de plano; % base mais adicional ou % diferenciado por barbeiro. Também já existem comissão
de avulso por serviço (% ou fixo, com exceção por barbeiro), comissão de produtos por faixa e folha que congela ao
fechar. As mudanças de configuração vão para a auditoria.

Falta:
- [ ] Trocar os nomes: Pote → Receita de Assinaturas, valor a distribuir → Receita Distribuível,
      Fichas → Créditos de Atendimento.
- [ ] Adicional do avulso separado do adicional da assinatura (+pp por barbeiro).
- [ ] Registrar motivo, quem autorizou, início e fim de cada adicional.
- [ ] Relatório com: receita de assinaturas, créditos, receita atribuída ao barbeiro, % base, adicional, comissão de
      assinatura, de avulsos e de produtos, bônus/descontos/ajustes e total.
- [ ] Conferir: estorno de mensalidade depois do período fechado.

### Outros itens da fase A (vindos dos blocos anteriores)
- [ ] 36. Backups 🟡: o diário (03h, 14 dias, no próprio VPS) já existe. Falta backup antes de cada deploy, cópia fora
      do servidor e um teste de restauração.
- [ ] LGPD ⬜: termos de uso, política de privacidade, consentimento e pedido de exclusão/exportação dos dados.
- [ ] 38. Ambiente de teste separado (homologação) ⬜: nunca testar na base real.
- [ ] Testes automáticos no GitHub a cada PR (testes, lint, build) ⬜.
- [ ] Página de erro interno (500) em português ⬜.
- [ ] Trocar no README os exemplos `blackbarber.com.br` pelos domínios reais ⬜.

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
- **Item 18 (quase todo):** ver Fase B.
