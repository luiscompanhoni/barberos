# Plano de implementação da oferta Dezembro Grátis

> **Execução:** superpowers:subagent-driven-development. As etapas usam caixas de seleção.

**Objetivo.** Fazer o fluxo da oferta com cartão, limites de uso e fidelidade, operável e verificável em homologação.

**Arquitetura.** A adesão transacional reutiliza cadastro, assinatura e regras de benefícios. O cartão entra no simulador do contrato de recorrência, sem fatura inicial. Uma visão autenticada acompanha os estados.

**Stack.** Next.js, Prisma, PostgreSQL, Vitest e Vercel agent-browser.

**Especificação.** `docs/superpowers/specs/2026-11-22-oferta-dezembro-design.md`.

## Restrições globais

- Tudo na worktree e branch de crescimento. Banco só local com backup. Nenhuma API paga, cobrança real ou deploy.
- Fuso America/Sao_Paulo. Dezembro de 2026 grátis, seis ciclos pagos a partir de janeiro de 2027, moeda em centavos.
- Vagas e usos via configuração, ausentes por padrão. Aceite versionado. Payroll, CashBarber e gateways de clientes existentes preservados.

## Focos de revisão

- Dois clientes no mesmo instante pela última vaga.
- Mesmo cliente em duas abas, inclusive com adesão normal concorrente.
- Agendamento de mais de um serviço cruza o teto grátis.
- Cartão/termo inválidos ou versão divergente não geram vaga ou compromisso.
- Cálculo nos extremos de cancelamento, arrependimento e seis meses completos.

### Task 1: Contrato, checkout e operação da oferta

**Arquivos.** `src/lib/oferta-dezembro/`, `src/app/c/(area)/dezembro-gratis/`, `src/app/api/cliente/oferta-dezembro/`, `src/app/(app)/assinaturas/dezembro-gratis/`, regras de assinatura/agenda que aplicam cobertura e cancelamento, testes `oferta-dezembro*.test.ts`, docs `oferta-dezembro-gratis.md`. O coordenador aplica o bloco de schema. A tarefa tem migração exclusiva.

**Interface.** A página do cliente é `/c/dezembro-gratis`. A página da gestão é `/assinaturas/dezembro-gratis`. A lógica fica em torno da adesão ligada à assinatura e compartilha as travas já usadas para cliente e plano.

- [x] Escrever e rodar testes de calendário, elegibilidade, multa, recusas de forma/termo e limites.
- [x] Validar titular, cartão de homologação, elegibilidade e quota em uma transação; manter idempotência e gravar os termos aceitos. Expor cronograma e registrar cancelamento sem efeito financeiro externo.
- [x] Integrar limite grátis a agendamento e consumo. Preservar caminhos de cancelamento no fim da fidelidade e bloquear desvios por rotas regulares quando necessário.
- [x] Entregar checkout móvel, estado do contrato e visão de vagas/adesões da gestão.
- [x] Rodar testes, lint, tipos, migração local com backup e agent-browser em 390×844. Documentar as etapas que dependem de Ygor.
