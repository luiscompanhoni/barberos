import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m=vi.hoisted(()=>({auth:vi.fn(),estado:vi.fn(),configurar:vi.fn(),evolution:vi.fn(),provedor:vi.fn()}));
vi.mock("@/lib/auth/sessao",()=>({exigirSessao:m.auth}));
vi.mock("@/lib/whatsapp/piloto",()=>({estadoPiloto:m.estado,configurarPiloto:m.configurar}));
vi.mock("@/lib/whatsapp/evolution",()=>({estadoEvolution:m.evolution}));
vi.mock("@/lib/whatsapp/canal",()=>({provedorWhatsApp:m.provedor}));
import { GET,POST } from "@/app/api/recrutamento/entrevistas/piloto/route";
const req=(body:unknown)=>new Request("http://local/api",{method:"POST",body:JSON.stringify(body)});
const iniciar={acao:"INICIAR",versao:0,telefone:"47999990000",minutos:30};
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({usuarioId:"fixture-dono",papel:"DONO"});m.estado.mockResolvedValue(null);m.evolution.mockResolvedValue("conectado");m.provedor.mockReturnValue("evolution");m.configurar.mockResolvedValue({ativo:true});});
afterEach(()=>vi.unstubAllEnvs());
describe("controle privado do piloto",()=>{
 it.each([401,403])("autenticação %s impede leitura e ativação",async(status)=>{
  m.auth.mockRejectedValue(new ErroNegocio("Sem acesso",status));expect((await GET()).status).toBe(status);expect((await POST(req(iniciar))).status).toBe(status);expect(m.configurar).not.toHaveBeenCalled();expect(m.estado).not.toHaveBeenCalled();
 });
 it.each([{...iniciar,telefone:""},{...iniciar,minutos:61},{...iniciar,minutos:0},{...iniciar,versao:-1},{...iniciar,todos:true}])("rejeita parâmetros fora do escopo %#",async(body)=>{
  expect((await POST(req(body))).status).toBe(400);expect(m.configurar).not.toHaveBeenCalled();
 });
 it("nega API paga ou desconectada",async()=>{
  m.provedor.mockReturnValue("cloud");expect((await POST(req(iniciar))).status).toBe(409);expect(m.configurar).not.toHaveBeenCalled();
  m.provedor.mockReturnValue("evolution");m.evolution.mockResolvedValue("desconectado");expect((await POST(req(iniciar))).status).toBe(409);expect(m.configurar).not.toHaveBeenCalled();
 });
 it("ativa somente por DONO com estado sem cache e não faz envio",async()=>{
  const r=await POST(req(iniciar));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(m.auth).toHaveBeenCalledWith(["DONO"]);expect(m.configurar).toHaveBeenCalledWith("fixture-dono",0,"47999990000",30);
 });
 it("permite encerrar mesmo com canal desconectado",async()=>{
  m.evolution.mockResolvedValue("desconectado");const r=await POST(req({acao:"ENCERRAR",versao:1}));expect(r.status).toBe(200);expect(m.evolution).not.toHaveBeenCalled();expect(m.configurar).toHaveBeenCalledWith("fixture-dono",1,null,30);
 });
});
