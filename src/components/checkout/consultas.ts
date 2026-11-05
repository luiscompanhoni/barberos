/** Uma resposta anterior à mutação não pode restaurar o checkout antigo. */
export function controlarConsultasCheckout() {
  let versao = 0;
  let ultima = 0;
  let mutando = false;
  return {
    iniciarMutacao() { mutando = true; versao++; },
    terminarMutacao() { mutando = false; versao++; },
    iniciarConsulta(aposRespostaDaMutacao = false) {
      if (mutando && !aposRespostaDaMutacao) return null;
      const solicitada = { versao, ordem: ++ultima };
      return { atual: () => solicitada.versao === versao && solicitada.ordem === ultima };
    },
  };
}
