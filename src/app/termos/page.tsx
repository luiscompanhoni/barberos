import type { Metadata } from "next";
import Link from "next/link";
import { Contato, PaginaLegal, Secao } from "@/components/lgpd/PaginaLegal";
import { configuracao } from "@/lib/agenda/carregar";
import { controlador, VERSAO_TERMOS } from "@/lib/lgpd/textos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Termos de uso" };

/** Termos de uso do site e do aplicativo. Mudou algo relevante? Suba VERSAO_TERMOS em lib/lgpd/textos.ts. */
export default async function Termos() {
  const [c, cfg] = await Promise.all([controlador(), configuracao()]);
  return (
    <PaginaLegal titulo="Termos de uso" versao={VERSAO_TERMOS} controlador={c}>
      <p>
        Estes termos valem para o site, o aplicativo e o WhatsApp de atendimento de {c.nomeFantasia}. Ao criar a conta ou
        usar esses canais, você concorda com eles e com a <Link className="text-ouro underline" href="/privacidade">Política de privacidade</Link>.
      </p>
      <Secao t="1. Sua conta">
        <ul className="list-disc space-y-1 pl-5">
          <li>A conta é pessoal e ligada ao seu celular. Mantenha a senha em segredo; o que for feito com ela é de sua responsabilidade.</li>
          <li>Informe dados verdadeiros. Menores de 18 anos usam a conta com autorização do responsável.</li>
          <li>Você pode excluir a conta quando quiser, em Meus dados, depois de encerrar planos, pagamentos em aberto e horários marcados.</li>
        </ul>
      </Secao>
      <Secao t="2. Agendamentos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Horários pelo aplicativo ou pelo WhatsApp precisam de {cfg.antecedenciaMinimaMin} minutos de antecedência e podem ser marcados até {cfg.janelaAgendamentoDias} dias à frente.</li>
          <li>Se não puder vir, cancele ou remarque com antecedência pelo aplicativo ou pelo WhatsApp. Faltas repetidas podem limitar novos agendamentos.</li>
          <li>Horário pago antes e cancelado vira saldo para usar na barbearia, conforme as regras mostradas no pagamento.</li>
        </ul>
      </Secao>
      <Secao t="3. Planos de assinatura">
        <ul className="list-disc space-y-1 pl-5">
          <li>Cada plano mostra antes da contratação o preço, os serviços incluídos, os dias e as regras de uso.</li>
          <li>A cobrança é recorrente, no meio de pagamento escolhido, até o cancelamento. Com pagamento em atraso, o uso do plano fica suspenso.</li>
          <li>Você cancela pelo aplicativo, em Plano. O que já foi pago vale até o fim do ciclo.</li>
        </ul>
      </Secao>
      <Secao t="4. Pagamentos, saldo e prêmios">
        <ul className="list-disc space-y-1 pl-5">
          <li>Pagamentos online são processados por empresas de pagamento; seus termos também se aplicam.</li>
          <li>Saldo, cashback, indicações e prêmios dos jogos são pessoais, não viram dinheiro e têm a validade mostrada no aplicativo.</li>
          <li>Os resultados dos jogos são sorteados pelo sistema. Em caso de fraude, uso de várias contas ou abuso, a barbearia pode cancelar prêmios e benefícios.</li>
        </ul>
      </Secao>
      <Secao t="5. Mensagens">
        <p>
          Lembretes de horário, avisos de pagamento e respostas ao que você perguntou fazem parte do serviço. Clientes também
          recebem mensagens de divulgação da barbearia; você desliga quando quiser em Meus dados ou respondendo PARAR.
        </p>
      </Secao>
      <Secao t="6. Uso correto">
        <p>Não use os canais para fins ilegais, para se passar por outra pessoa ou para atrapalhar o sistema. A barbearia pode suspender contas que façam isso.</p>
      </Secao>
      <Secao t="7. Mudanças e contato">
        <p>Estes termos podem mudar; avisamos no aplicativo quando a mudança for relevante. Dúvidas:</p>
        <Contato c={c} />
        <p>Vale a legislação brasileira, incluindo o Código de Defesa do Consumidor.</p>
      </Secao>
    </PaginaLegal>
  );
}
