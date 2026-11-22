# Resultado da agenda do cliente

**Veredito.** A entrada direta está funcionando em produção até a tela de login. A revisão pública `6437737f7e304c7470319592d26931f44e8c54f0` inclui a correção `919899a`. O percurso autenticado até a prévia passou em ambiente local, inclusive na troca de uma sessão de equipe. A confirmação autenticada no iPhone de Ygor fica a cargo do roteiro abaixo.

**Link exato para abrir no iPhone.** [https://appblackbarber.com/c/agendar](https://appblackbarber.com/c/agendar)

## Passo a passo no iPhone

1. Abra o link no Safari ou pelo WhatsApp. Se já estiver com uma conta de cliente, o app deve abrir **Quais serviços?**.
2. Se aparecer **Seu horário. Na sua mão.**, informe o celular com DDD de uma conta de **cliente**. Se o app avisar **Esta conta é da equipe**, use o celular do cadastro de cliente.
3. Toque em **Receber código** e digite o código de seis dígitos recebido no WhatsApp. Toque em **Entrar**. Se preferir e já tiver uma senha de cliente, use **Entrar com senha**.
4. Em **Quais serviços?**, marque **Corte** ou outro serviço disponível. Toque em **Continuar**.
5. Em **Com quem?**, escolha um profissional que faça o serviço ou **Qualquer barbeiro**.
6. Em **Quando?**, selecione um dia de atendimento e toque num horário livre.
7. **Pare em Tudo certo?**. Confira serviço, barbeiro, data, hora e valor na tela. Encerre o teste antes de tocar em **Confirmar agendamento** ou **Confirmar total**.

## Evidências

- Em 22/11/2026, horário de São Paulo, `GET /api/saude` retornou a revisão esperada e `GET /c/agendar` retornou 307 para `/entrar?voltar=%2Fc%2Fagendar&confirmar=1`. O navegador confirmou a tela com **Celular**, **Receber código** e **Entrar com senha**. Na primeira abertura, a própria página fez um POST de telemetria sem token e recebeu 204. O código da rota retorna antes de acessar o banco quando falta o token. A segunda abertura repetiu a verificação com as rotas `/api/` bloqueadas no navegador.
- Vercel agent-browser, Chromium em 390×844, PostgreSQL local e OTP fictício. A conta cliente vinda do link e a sessão da recepção trocada por outra conta cliente chegaram a **Tudo certo?** com Corte, Joao, 24/11 às 09:00 e R$ 50,00. A contagem na base usada pelo navegador ficou em zero reservas.
- O fluxo automatizado `npm run teste:agenda:cliente` passou 15 verificações em banco descartável separado.
- Na vitrine, o botão **Já sou cliente · entrar** abria a roleta após o login. Nesta branch, ele abre **Próximos horários** e o botão **Agendar horário** leva à seleção de serviços. O teste em 390×844 passou após ajustar o destino e fazer a navegação ler a sessão recém-gravada. A produção continua na revisão identificada acima.
