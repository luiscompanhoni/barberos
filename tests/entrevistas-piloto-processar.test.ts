import { describe,it,expect,vi,beforeEach,afterEach } from "vitest";
const m=vi.hoisted(()=>({entrada:vi.fn(),enviar:vi.fn(),modelo:vi.fn(),cfg:vi.fn(),piloto:vi.fn(),entrevista:vi.fn()}));
vi.mock("@/lib/whatsapp/conversas",()=>({registrarEntrada:m.entrada,enviarNaConversa:m.enviar}));
vi.mock("@/lib/bot/agente",()=>({executarTurno:m.modelo}));
vi.mock("@/lib/agenda/carregar",()=>({configuracao:m.cfg}));
vi.mock("@/lib/whatsapp/piloto",()=>({estadoPiloto:m.piloto}));
vi.mock("@/lib/bot/entrevistas",()=>({processarBotEntrevista:m.entrevista,registroSeguroEntrevista:(s:string)=>s,contemConviteEntrevista:()=>false,comandoReservadoEntrevista:()=>false}));
import { receberMensagem } from "@/lib/bot/processar";
const telefone="5547999990000";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS","false");vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE","false");m.piloto.mockResolvedValue({ativo:true,telefone,expiraEm:new Date(Date.now()+60000),enviados:0,versao:1});m.entrada.mockResolvedValue({id:"fixture-piloto",telefone,estado:"BOT"});m.entrevista.mockResolvedValue({tratado:true,resposta:"fixture horarios"});});
afterEach(()=>vi.unstubAllEnvs());
describe("piloto determinístico não chama IA ou ferramentas gerais",()=>{
 it("bloqueio geral impede também entrevista ativa sem exceção de equipe",async()=>{
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS","true");await receberMensagem({telefone,texto:"INICIAR ENTREVISTA"});
  expect(m.entrada).toHaveBeenCalled();for(const fn of [m.piloto,m.entrevista,m.cfg,m.enviar,m.modelo])expect(fn).not.toHaveBeenCalled();
 });
 it("responde somente pelo fluxo de entrevista com finalidade explícita",async()=>{
  await receberMensagem({telefone,texto:"INICIAR ENTREVISTA"});
  expect(m.entrevista).toHaveBeenCalledWith({conversaId:"fixture-piloto",telefone},"INICIAR ENTREVISTA");
  expect(m.enviar).toHaveBeenCalledWith("fixture-piloto","fixture horarios","BOT",{entrevistaPiloto:true});
  expect(m.modelo).not.toHaveBeenCalled();expect(m.cfg).not.toHaveBeenCalled();
 });
 it("modo piloto sem cadastro inicial não libera bot geral",async()=>{
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO","true");m.piloto.mockResolvedValue(null);
  await receberMensagem({telefone,texto:"oi"});expect(m.modelo).not.toHaveBeenCalled();expect(m.cfg).not.toHaveBeenCalled();expect(m.enviar).not.toHaveBeenCalled();
 });
 it("mensagem desconhecida não cai no modelo",async()=>{
  m.entrevista.mockResolvedValue({tratado:false,resposta:null});await receberMensagem({telefone,texto:"oi"});expect(m.enviar).not.toHaveBeenCalled();expect(m.modelo).not.toHaveBeenCalled();expect(m.cfg).not.toHaveBeenCalled();
 });
 it.each(["outro","humano","expirado","esgotado","encerrado"])("não responde em caso %s",async(caso)=>{
  if(caso==="outro")m.entrada.mockResolvedValue({id:"fixture",telefone:"5547999990001",estado:"BOT"});
  if(caso==="humano")m.entrada.mockResolvedValue({id:"fixture",telefone,estado:"HUMANO"});
  if(caso==="expirado")m.piloto.mockResolvedValue({ativo:true,telefone,expiraEm:new Date(0),enviados:0,versao:1});
  if(caso==="encerrado")m.piloto.mockResolvedValue({ativo:false,telefone,expiraEm:new Date(Date.now()+60000),enviados:0,versao:2});
  if(caso==="esgotado")m.piloto.mockResolvedValue({ativo:true,telefone,expiraEm:new Date(Date.now()+60000),enviados:40,versao:1});
  await receberMensagem({telefone,texto:"HORARIOS"});expect(m.entrevista).not.toHaveBeenCalled();expect(m.enviar).not.toHaveBeenCalled();expect(m.cfg).not.toHaveBeenCalled();expect(m.modelo).not.toHaveBeenCalled();
 });
});
