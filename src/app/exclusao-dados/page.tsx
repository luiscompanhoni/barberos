import type { Metadata } from "next";
import Link from "next/link";
import { Contato, PaginaLegal, Secao } from "@/components/lgpd/PaginaLegal";
import { controlador, VERSAO_TERMOS } from "@/lib/lgpd/textos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exclusão de dados" };

/** Instruções públicas de exclusão de dados, inclusive para a revisão de apps da Meta. */
export default async function ExclusaoDados() {
  const c = await controlador();
  return (
    <PaginaLegal titulo="Exclusão de dados" versao={VERSAO_TERMOS} controlador={c}>
      <p>
        Esta página explica como pedir a exclusão dos seus dados pessoais tratados pela barbearia no site, no
        aplicativo, no WhatsApp de atendimento e no Direct do Instagram. Ela também serve como instrução de exclusão
        para quem conversou com a barbearia por um aplicativo da Meta.
      </p>
      <Secao t="1. Se você tem conta no aplicativo">
        <p>
          Entre na área do cliente, abra <Link className="text-ouro underline" href="/c/privacidade">Meus dados</Link> e
          use a opção de excluir a conta. Nome, celular, e-mail, CPF, nascimento, preferências e conversas são apagados
          na hora. Atendimentos, vendas e pagamentos permanecem no histórico da barbearia sem identificar você, pelo
          prazo das obrigações fiscais e contábeis, como descrito na{" "}
          <Link className="text-ouro underline" href="/privacidade">política de privacidade</Link>.
        </p>
      </Secao>
      <Secao t="2. Se você só falou pelo Instagram ou não tem conta">
        <p>
          Se você mandou mensagem no Direct do Instagram da barbearia, ou não consegue entrar no aplicativo, peça a
          exclusão pelos contatos abaixo. Informe o nome do perfil do Instagram ou outro dado que ajude a localizar a
          conversa. Respondemos em até 15 dias e apagamos as mensagens e os identificadores do Direct associados a você,
          com as mesmas ressalvas legais do item 1.
        </p>
        <Contato c={c} />
      </Secao>
      <Secao t="3. Quem é o responsável">
        <p>O controlador dos dados é:</p>
        <Contato c={c} />
      </Secao>
    </PaginaLegal>
  );
}
