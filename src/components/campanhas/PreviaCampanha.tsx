import { aberturaReativacao } from "@/lib/automacoes/regras";
import { montarMensagem, textoDaOferta } from "@/lib/campanhas/regras";

export function PreviaCampanha({ mensagem }: { mensagem: string }) {
  const abertura = aberturaReativacao("Cliente");
  const oferta = montarMensagem(textoDaOferta(mensagem), { nome: "Cliente", barbearia: "Black Barber", link: "[link individual]" });
  return <section aria-label="Prévia da mensagem" className="space-y-2 rounded-xl border border-zinc-200 p-3 text-sm">
    <h3 className="font-semibold">Prévia da mensagem</h3>
    <ol aria-label="Abertura" className="space-y-1">
      {abertura.map(texto => <li key={texto} className="w-fit rounded-lg bg-zinc-100 p-2">{texto}</li>)}
    </ol>
    <p className="pt-2 text-xs font-semibold">Depois que o cliente responder</p>
    <p className="whitespace-pre-wrap break-words">{oferta}</p>
  </section>;
}
