import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowRight, BadgePercent, Gift, CalendarCheck, Check, Clock3, CreditCard, Crown, MapPin,
  MessageCircle, MousePointerClick, Scissors, ShieldCheck, Smartphone, type LucideIcon,
} from "lucide-react";
import { Marca } from "@/components/Marca";
import { itensDoPlano, planoEmDestaque, porDia } from "@/lib/assinaturas/itens";
import { reais } from "@/lib/cliente-api";
import { COOKIE_INDICACAO, donoDoCodigo } from "@/lib/crescimento/indicacao";
import { dadosDaVitrine } from "@/lib/vitrine";

// Planos, vagas e numero de assinantes vem do banco a cada visita.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const v = await dadosDaVitrine();
  return {
    title: `Assinatura — ${v.nomeBarbearia}`,
    description: `Assine a ${v.nomeBarbearia} e corte quantas vezes quiser. Agende pelo WhatsApp ou pelo site.`,
  };
}

/** Link para assinar: passa pelo login por codigo e ja abre o plano escolhido. */
const linkAssinar = (planoId?: string) => (planoId ? `/c/planos?plano=${planoId}` : "/c/planos");

/** Pagina publica de venda das assinaturas. */
export default async function Assine() {
  const v = await dadosDaVitrine();
  // Chegou pelo link de um amigo (/i/<codigo>)?
  const codigo = (await cookies()).get(COOKIE_INDICACAO)?.value;
  const indicador = codigo && v.indicacao.ativa ? await donoDoCodigo(codigo) : null;
  const destaque = planoEmDestaque(v.planos);
  const maisBarato = v.planos.length ? Math.min(...v.planos.map((p) => p.precoCentavos)) : null;
  const temIlimitado = v.planos.some((p) => p.servicos.some((s) => s.usosPorCiclo === null));
  const maiorDesconto = Math.max(0, ...v.planos.map((p) => p.descontoExtrasPct));

  const beneficios: { Icone: LucideIcon; titulo: string; texto: string }[] = [
    temIlimitado
      ? { Icone: Scissors, titulo: "Corte à vontade", texto: "Uma mensalidade e você corta quantas vezes quiser, respeitando o intervalo do plano." }
      : { Icone: Scissors, titulo: "Cortes garantidos", texto: "Seus cortes do mês incluídos numa mensalidade só." },
    { Icone: MessageCircle, titulo: "Agende pelo WhatsApp", texto: "Nosso atendente virtual responde a qualquer hora e marca seu horário em segundos." },
    { Icone: Smartphone, titulo: "Ou pelo site", texto: "Escolha serviço, barbeiro e horário na sua área de cliente, sem ligar pra ninguém." },
    { Icone: ShieldCheck, titulo: "Sem fidelidade", texto: "Cancele quando quiser, direto pelo site ou pelo WhatsApp. Sem multa." },
    { Icone: CreditCard, titulo: "Pagamento automático", texto: "Cartão de crédito recorrente ou Pix todo mês. Você não precisa lembrar de nada." },
    maiorDesconto > 0
      ? { Icone: BadgePercent, titulo: "Desconto nos extras", texto: `Até ${maiorDesconto}% de desconto nos serviços que não estão no seu plano.` }
      : { Icone: Crown, titulo: "Prioridade de assinante", texto: "Seus horários pelo plano ficam separados e confirmados na agenda." },
  ];

  const passos = [
    { Icone: MousePointerClick, titulo: "Escolha o plano", texto: "Veja qual combina com a sua rotina." },
    { Icone: Smartphone, titulo: "Entre com o celular", texto: "Você recebe um código no WhatsApp. Sem senha." },
    { Icone: CalendarCheck, titulo: "Pague e agende", texto: "Pix ou cartão. Ativou, já pode marcar." },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-fundo">
      {/* Topo fixo translucido */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-zinc-200/60 bg-fundo/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
          <Marca nome={v.nomeBarbearia} />
          <nav className="hidden items-center gap-8 md:flex">
            {[["#beneficios", "Benefícios"], ["#planos", "Planos"], ["#como-funciona", "Como funciona"]].map(([href, rotulo]) => (
              <a key={href} href={href} className="text-[11px] font-bold tracking-wide text-zinc-500 uppercase hover:text-zinc-900">{rotulo}</a>
            ))}
            <Link href="/c" className="text-[11px] font-bold tracking-wide text-zinc-500 uppercase hover:text-zinc-900">Área do cliente</Link>
          </nav>
          <a href="#planos" className="rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold tracking-[0.3px] text-fundo uppercase transition hover:bg-zinc-800">Assinar</a>
        </div>
      </header>

      {/* Capa */}
      <section className="relative flex min-h-[88svh] items-end pt-28">
        {v.fotoCapa ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto colocada pela barbearia em public/capa.jpg
          <img src={v.fotoCapa} alt={`Interior da ${v.nomeBarbearia}`} className="absolute inset-0 h-full w-full object-cover object-[62%_center]" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_30%,rgba(211,171,69,0.18),transparent_55%),radial-gradient(ellipse_at_20%_90%,rgba(211,171,69,0.08),transparent_50%)]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#0a0a0a_2%,rgba(10,10,10,0.88)_38%,rgba(10,10,10,0.3)_75%),linear-gradient(0deg,#0a0a0a_0%,transparent_45%)]" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-20 lg:px-8">
          <div className="entrar-suave max-w-3xl">
            {indicador && (
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-ouro/50 bg-ouro/10 px-4 py-2 text-sm">
                <Gift size={16} className="text-ouro" />
                Você foi indicado por <b>{indicador.nome.split(" ")[0]}</b>
                {v.indicacao.premioIndicadoCentavos > 0 && <> · ganha <b className="text-ouro">{reais(v.indicacao.premioIndicadoCentavos)}</b> no primeiro corte</>}
              </p>
            )}
            {v.cidade && <p className="eyebrow">{v.cidade}</p>}
            <h1 className="titulo-marca mt-5 text-[3.4rem] leading-[0.94] sm:text-7xl lg:text-[5rem]">
              {temIlimitado ? "Cortes" : "Seu corte"}
              <br />
              <span className="text-ouro">{temIlimitado ? "ilimitados." : "garantido."}</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-zinc-500 sm:text-lg">
              {maisBarato !== null && <>A partir de <strong className="text-zinc-900">{reais(porDia(maisBarato))}/dia.</strong> </>}
              Cancele quando quiser.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="#planos" className="btn-primario px-6 py-3">Quero ser assinante <ArrowRight size={16} /></a>
              <a href="#como-funciona" className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:text-ouro">
                Como funciona <ArrowRight size={15} />
              </a>
            </div>
            {v.assinantes && (
              <p className="mt-8 flex items-center gap-3 text-sm text-zinc-500">
                <Crown size={16} className="text-ouro" />
                <strong className="text-zinc-900">+{v.assinantes.toLocaleString("pt-BR")}</strong> assinantes ativos
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Beneficios */}
      <section id="beneficios" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-24 lg:px-8 lg:py-32">
        <p className="eyebrow">Por que assinar</p>
        <div className="mt-4 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <h2 className="titulo-marca max-w-2xl text-4xl leading-[0.95] sm:text-5xl">
            Liberdade para estar
            <br />
            <span className="text-ouro">sempre no seu melhor.</span>
          </h2>
          <p className="max-w-sm text-sm leading-6 text-zinc-500">Para quem valoriza tempo, constância e um corte impecável todo mês.</p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {beneficios.map(({ Icone, titulo, texto }, i) => (
            <article key={titulo} className="cartao-clicavel entrar-suave p-6" style={{ animationDelay: `${i * 60}ms` }}>
              <Icone className="text-ouro" size={23} strokeWidth={1.5} />
              <h3 className="mt-8 text-base font-bold">{titulo}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{texto}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-16 border-y border-zinc-200 bg-[#141312]">
        <div className="mx-auto max-w-6xl px-5 py-24 lg:px-8 lg:py-32">
          <p className="eyebrow">Planos</p>
          <h2 className="titulo-marca mt-4 text-4xl sm:text-5xl">Escolha sua <span className="text-ouro">rotina.</span></h2>
          {v.planos.length === 0 ? (
            <p className="cartao mt-12 text-sm text-zinc-500">Os planos estão sendo preparados. Volte em breve!</p>
          ) : (
            <div className={`mt-14 grid items-stretch gap-5 ${v.planos.length >= 3 ? "lg:grid-cols-3" : v.planos.length === 2 ? "md:grid-cols-2" : "max-w-md"}`}>
              {v.planos.map((p) => {
                const emDestaque = p.id === destaque;
                const esgotado = p.vagasRestantes === 0;
                return (
                  <article key={p.id}
                    className={`relative flex flex-col rounded-2xl border bg-white p-7 ${emDestaque ? "border-ouro shadow-[0_10px_32px_rgba(211,171,69,0.2)] lg:-translate-y-3" : "border-zinc-200"}`}>
                    {emDestaque && (
                      <span className="absolute top-0 right-5 -translate-y-1/2 rounded-full bg-ouro px-3 py-1 text-[9px] font-black text-fundo uppercase">Destaque</span>
                    )}
                    <p className="text-sm font-bold">{p.nome}</p>
                    <div className="mt-5 flex items-end gap-2">
                      <span className="text-4xl font-black">{reais(p.precoCentavos)}</span>
                      <span className="pb-1 text-sm text-zinc-500">/mês</span>
                    </div>
                    <p className="mt-2 text-xs text-ouro">{reais(porDia(p.precoCentavos))}/dia</p>
                    {p.descricao && <p className="mt-3 text-sm text-zinc-500">{p.descricao}</p>}
                    <div className="my-7 h-px bg-zinc-200" />
                    <ul className="flex-1 space-y-3">
                      {itensDoPlano(p).map((item) => (
                        <li key={item} className="flex gap-3 text-sm text-zinc-500"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ouro" />{item}</li>
                      ))}
                    </ul>
                    {p.vagasRestantes !== null && p.vagasRestantes > 0 && p.vagasRestantes <= 10 && (
                      <p className="mt-6 text-xs font-semibold text-ouro">Últimas {p.vagasRestantes} vagas</p>
                    )}
                    <Link href={linkAssinar(p.id)} className={`${emDestaque && !esgotado ? "btn-primario" : "btn"} mt-6 w-full py-3`}>
                      {esgotado ? "Esgotado · entrar na lista de espera" : "Assinar plano"}
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-24 lg:px-8 lg:py-28">
        <p className="eyebrow">Como funciona</p>
        <h2 className="titulo-marca mt-4 text-4xl sm:text-5xl">Em 3 passos <span className="text-ouro">você assina.</span></h2>
        <ol className="mt-12 grid gap-3 md:grid-cols-3">
          {passos.map(({ Icone, titulo, texto }, i) => (
            <li key={titulo} className="cartao p-6">
              <div className="flex items-center justify-between">
                <Icone className="text-ouro" size={23} strokeWidth={1.5} />
                <span className="text-4xl font-black text-zinc-200">{i + 1}</span>
              </div>
              <h3 className="mt-6 text-base font-bold">{titulo}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{texto}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <a href="#planos" className="btn-primario px-6 py-3">Ver planos <ArrowRight size={16} /></a>
          <Link href="/c" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">Já sou cliente · entrar</Link>
        </div>
      </section>

      {/* Rodape */}
      <footer className="border-t border-zinc-200">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[1fr_2fr] lg:px-8">
          <Marca nome={v.nomeBarbearia} />
          <div className="grid gap-6 text-sm text-zinc-500 sm:grid-cols-3">
            {v.endereco && <p className="flex gap-3"><MapPin className="shrink-0 text-ouro" size={18} />{v.endereco}</p>}
            {v.horario && <p className="flex gap-3"><Clock3 className="shrink-0 text-ouro" size={18} />{v.horario.dias}<br />{v.horario.horas}</p>}
            {v.whatsapp && (
              <a href={`https://wa.me/${v.whatsapp}`} target="_blank" rel="noreferrer" className="flex gap-3 hover:text-zinc-900">
                <MessageCircle className="shrink-0 text-ouro" size={18} />Fale no WhatsApp
              </a>
            )}
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-5 px-5 pb-10 text-xs text-zinc-500 lg:px-8">
          <Link href="/privacidade" className="underline hover:text-zinc-900">Política de privacidade</Link>
          <Link href="/termos" className="underline hover:text-zinc-900">Termos de uso</Link>
        </div>
      </footer>

      {v.whatsapp && (
        <a href={`https://wa.me/${v.whatsapp}`} target="_blank" rel="noreferrer"
          className="fixed right-4 bottom-4 z-50 flex h-12 items-center gap-2 rounded-full bg-[#25d366] px-4 text-[11px] font-black text-[#0a0a0a] uppercase shadow-lg transition hover:-translate-y-0.5">
          <MessageCircle size={17} /> <span className="hidden sm:inline">Fale conosco</span>
        </a>
      )}
    </div>
  );
}
