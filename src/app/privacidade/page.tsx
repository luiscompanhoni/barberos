import type { Metadata } from "next";
import Link from "next/link";
import { Contato, PaginaLegal, Secao } from "@/components/lgpd/PaginaLegal";
import { controlador, VERSAO_TERMOS } from "@/lib/lgpd/textos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Política de privacidade" };

/** Politica de privacidade (LGPD). Mudou algo relevante? Suba VERSAO_TERMOS em lib/lgpd/textos.ts. */
export default async function Privacidade() {
  const c = await controlador();
  return (
    <PaginaLegal titulo="Política de privacidade" versao={VERSAO_TERMOS} controlador={c}>
      <p>
        Esta política explica quais dados pessoais a barbearia trata quando você usa o site, o aplicativo, o WhatsApp de
        atendimento e o balcão, para que servem, com quem são compartilhados e como você exerce seus direitos pela Lei Geral
        de Proteção de Dados (Lei 13.709/2018).
      </p>
      <Secao t="1. Quem é o responsável pelos seus dados">
        <p>O controlador dos dados é:</p>
        <Contato c={c} />
        <p>Pedidos sobre seus dados podem ser feitos por esses contatos ou direto no aplicativo, em <Link className="text-ouro underline" href="/c/privacidade">Meus dados</Link>.</p>
      </Secao>
      <Secao t="2. Quais dados tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-zinc-900">Cadastro:</b> nome, celular (WhatsApp) e senha (guardada criptografada). Quando você informa: e-mail, CPF (exigido para algumas cobranças), data de nascimento, como conheceu a barbearia e preferências de corte.</li>
          <li><b className="text-zinc-900">Atendimentos:</b> horários marcados, serviços, barbeiro, comandas, produtos, pagamentos, assinatura, saldo, indicações e prêmios dos jogos.</li>
          <li><b className="text-zinc-900">Conversas:</b> as mensagens trocadas com o WhatsApp da barbearia, incluindo o atendimento automático.</li>
          <li><b className="text-zinc-900">Dados técnicos:</b> endereço IP e tipo de aparelho registrados nas ações feitas no site, para segurança.</li>
        </ul>
        <p>Não pedimos dados sensíveis (saúde, religião, biometria). Dados de cartão são digitados direto no ambiente do processador de pagamentos; a barbearia não guarda o número do cartão.</p>
      </Secao>
      <Secao t="3. Para que usamos e com qual base legal">
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-zinc-900">Prestar o serviço que você pediu</b> (agendar, lembrar do horário, atender, cobrar o plano e os pagamentos): execução de contrato.</li>
          <li><b className="text-zinc-900">Guardar registros de vendas e pagamentos</b>: cumprimento de obrigação legal (fiscal e contábil).</li>
          <li><b className="text-zinc-900">Segurança, prevenção a fraudes</b> (inclusive nos jogos e prêmios) e melhoria do atendimento: legítimo interesse.</li>
          <li><b className="text-zinc-900">Mensagens de divulgação para clientes</b> (promoções, campanhas, convites para voltar, aniversário): legítimo interesse da barbearia em falar com quem já é cliente. Você pode desligar quando quiser em Meus dados ou respondendo PARAR no WhatsApp, e não recebe mais.</li>
        </ul>
      </Secao>
      <Secao t="4. Com quem compartilhamos">
        <p>Só com quem ajuda a prestar o serviço, e só o necessário:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>processadores de pagamento (Pix, cartão e assinatura), para cobrar;</li>
          <li>o provedor de envio de mensagens do WhatsApp, para falar com você;</li>
          <li>o serviço de inteligência artificial que responde no atendimento automático do WhatsApp (Anthropic, com servidores nos Estados Unidos), que recebe o texto das conversas para responder, quando esse atendimento está ligado;</li>
          <li>o provedor de servidores onde o sistema e as cópias de segurança criptografadas ficam guardados.</li>
        </ul>
        <p>Não vendemos seus dados. Autoridades recebem dados apenas quando a lei obriga.</p>
      </Secao>
      <Secao t="5. Por quanto tempo guardamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Enquanto sua conta existir. Ao excluir a conta, nome, celular, e-mail, CPF, nascimento, preferências e conversas são apagados na hora.</li>
          <li>Atendimentos, vendas e pagamentos continuam no histórico da barbearia <b className="text-zinc-900">sem identificar você</b>, pelo prazo das obrigações fiscais e contábeis.</li>
          <li>Registros de segurança (quem fez o quê e quando) são guardados para prevenção a fraudes e não podem ser alterados.</li>
          <li>Cópias de segurança são substituídas automaticamente com o tempo.</li>
          <li>Candidaturas às vagas de trabalho seguem o aviso da própria vaga; sem autorização para futuras oportunidades, são apagadas em até 12 meses.</li>
        </ul>
      </Secao>
      <Secao t="6. Seus direitos">
        <p>
          Você pode confirmar se tratamos seus dados, acessar e baixar uma cópia, corrigir, pedir a exclusão, revogar o
          as mensagens de divulgação, saber com quem compartilhamos e se opor a um tratamento. No aplicativo,
          em <Link className="text-ouro underline" href="/c/privacidade">Meus dados</Link>, você baixa seus dados, liga ou desliga as
          mensagens e exclui a conta sozinho. Pelos contatos do item 1, respondemos em até 15 dias. Você também pode
          reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </Secao>
      <Secao t="7. Cookies e armazenamento no aparelho">
        <p>
          Usamos só o cookie necessário para manter você conectado e preferências guardadas no seu aparelho (como som dos
          jogos). Não usamos cookies de publicidade nem de rastreamento de terceiros.
        </p>
      </Secao>
      <Secao t="8. Segurança">
        <p>Acesso por senha ou código, conexão criptografada (HTTPS), senhas guardadas com criptografia, acesso da equipe por permissão e registro de auditoria das ações sensíveis.</p>
      </Secao>
      <Secao t="9. Mudanças nesta política">
        <p>Quando houver mudança relevante, avisamos no aplicativo e pedimos seu aceite de novo.</p>
      </Secao>
    </PaginaLegal>
  );
}
