export function ConfirmacaoEquipe({ atendimentoUrl }: { atendimentoUrl: string | null }) {
  return <section className="cartao-destaque space-y-4">
    <p className="eyebrow">Seu atendimento na Black</p>
    <h1 className="text-2xl font-semibold">Vamos confirmar seu horário.</h1>
    <p className="text-sm text-zinc-500">Nossa equipe confere a disponibilidade e ajuda você a marcar, remarcar ou cancelar. O horário fica garantido depois dessa confirmação.</p>
    {atendimentoUrl ? <a className="btn-primario inline-flex" href={atendimentoUrl}>Falar com a equipe</a> : <p className="text-sm">Entre em contato com a recepção da Black para concluir.</p>}
  </section>;
}
