// Ajuda dos testes de fluxo. Eles rodam a qualquer hora (no CI, inclusive) por cima da agenda do seed.
import { db } from "@/lib/db";

/**
 * Horario em que o barbeiro esta livre: parte de `desejado` e anda de `passoMin` em `passoMin` minutos (negativo volta
 * no tempo, para quem precisa de um horario que ja passou) ate nao cruzar com nenhum atendimento.
 */
export async function horarioLivre(barbeiroId: string, desejado: Date, duracaoMin = 30, passoMin = 30) {
  let inicio = desejado.getTime();
  for (let i = 0; i < 200; i++) {
    const fim = inicio + duracaoMin * 60_000;
    const cruza = await db.agendamento.count({
      where: { barbeiroId, status: { notIn: ["CANCELADO", "FALTOU"] }, inicio: { lt: new Date(fim) }, fim: { gt: new Date(inicio) } },
    });
    if (!cruza) return new Date(inicio);
    inicio += passoMin * 60_000;
  }
  throw new Error("Sem horário livre na agenda para o teste.");
}
