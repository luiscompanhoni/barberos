import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { permitePiloto, telefonePiloto } from "@/lib/whatsapp/piloto-regras";
const m=vi.hoisted(()=>({ find:vi.fn(), update:vi.fn(), lock:vi.fn(), evolution:vi.fn() }));
vi.mock("@/lib/auditoria",()=>({auditar:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{$transaction:(fn:(tx:unknown)=>unknown)=>fn({$executeRaw:m.lock,pilotoEntrevistaWhatsApp:{findUnique:m.find,update:m.update}})}}));
vi.mock("@/lib/whatsapp/evolution",()=>({enviarTextoEvolution:m.evolution}));
import { enviarTexto, enviarTemplate } from "@/lib/whatsapp/canal";
const telefone="5547999990000";
const ativo=()=>({ativo:true,telefone,expiraEm:new Date(Date.now()+60_000),enviados:0,versao:1});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO","true");vi.stubEnv("WHATSAPP_PROVIDER","evolution");m.find.mockResolvedValue(ativo());m.evolution.mockResolvedValue({wamid:"fixture"});});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("piloto de WhatsApp fechado por destinatário e finalidade",()=>{
 it("reconhece somente telefone e JID individual verificáveis",()=>{
  expect(telefonePiloto(telefone+"@s.whatsapp.net")).toBe(telefone);
  expect(telefonePiloto("47999990000")).toBe(telefone);
 });
 it.each(["5547999990001",telefone+"@g.us",telefone+"@lid",telefone+"@example.com","abc"+telefone,"+"+telefone,telefone+":1@s.whatsapp.net",""])("recusa destino divergente ou ambíguo %s",async(destino)=>{
  expect(permitePiloto(ativo(),destino,"ENTREVISTA_PILOTO")).toBe(false);
  await expect(enviarTexto(destino,"fixture",0,"ENTREVISTA_PILOTO")).rejects.toMatchObject({status:403});
  expect(m.evolution).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
 });
 it.each(["PADRAO","TEMPLATE","", "ENTREVISTA"])("bloqueia origem %s mesmo para o telefone autorizado",async(origem)=>{
  await expect(enviarTexto(telefone,"fixture",0,origem)).rejects.toMatchObject({status:403});
  expect(m.evolution).not.toHaveBeenCalled();
 });
 it("templates não atravessam o piloto",async()=>{
  await expect(enviarTemplate(telefone,{nome:"fixture",parametros:[]})).rejects.toMatchObject({status:403});expect(m.evolution).not.toHaveBeenCalled();
 });
 it.each([{...ativo(),expiraEm:new Date(0)},{...ativo(),expiraEm:null},{...ativo(),enviados:40},{...ativo(),telefone:null},{...ativo(),ativo:false},null])("não envia com estado inelegível %#",async(p)=>{
  m.find.mockResolvedValue(p);await expect(enviarTexto(telefone,"fixture",0,"ENTREVISTA_PILOTO")).rejects.toMatchObject({status:403});expect(m.evolution).not.toHaveBeenCalled();
 });
 it("modo piloto sem cadastro inicial também bloqueia mensagens comuns",async()=>{
  m.find.mockResolvedValue(null);await expect(enviarTexto(telefone,"fixture")).rejects.toMatchObject({status:403});expect(m.evolution).not.toHaveBeenCalled();
 });
 it("encerramento conserva bloqueio de todos os envios",async()=>{
  m.find.mockResolvedValue({...ativo(),ativo:false});
  await expect(enviarTexto(telefone,"fixture")).rejects.toMatchObject({status:403});expect(m.evolution).not.toHaveBeenCalled();
 });
 it("reserva tentativa antes de chamar o transporte, inclusive falhas",async()=>{
  m.evolution.mockImplementation(()=>{expect(m.update).toHaveBeenCalledWith({where:{id:1},data:{enviados:{increment:1}}});throw Error("fixture falha");});
  await expect(enviarTexto(telefone,"fixture",0,"ENTREVISTA_PILOTO")).rejects.toThrow("fixture falha");expect(m.evolution).toHaveBeenCalledTimes(1);
 });
 it("recurso desligado preserva chamadas legadas mas recusa origem de piloto",async()=>{
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO","false");
  await enviarTexto(telefone,"fixture");expect(m.find).not.toHaveBeenCalled();expect(m.evolution).toHaveBeenCalledTimes(1);
  await expect(enviarTexto(telefone,"fixture",0,"ENTREVISTA_PILOTO")).rejects.toMatchObject({status:403});expect(m.evolution).toHaveBeenCalledTimes(1);
 });
});
