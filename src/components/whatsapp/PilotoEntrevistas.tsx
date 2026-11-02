"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/cliente-api";
type Info = {disponivel:boolean;piloto:null|{ativo:boolean;telefone:string|null;expiraEm:string|null;enviados:number;versao:number}};
export function PilotoEntrevistas() {
 const [info,setInfo]=useState<Info|null>(null);const [erro,setErro]=useState("");const [msg,setMsg]=useState("");const [ocupado,setOcupado]=useState(false);
 const url="/api/recrutamento/entrevistas/piloto";
 async function carregar(){setOcupado(true);setErro("");try{setInfo(await api<Info>(url));}catch(e){setErro((e as Error).message);}finally{setOcupado(false);}}
 async function alterar(e?:FormEvent<HTMLFormElement>){e?.preventDefault();const f=e?new FormData(e.currentTarget):null;setOcupado(true);setErro("");try{
  await api(url,{method:"POST",body:f?{acao:"INICIAR",versao:info?.piloto?.versao??0,telefone:f.get("telefone"),minutos:Number(f.get("minutos"))}:{acao:"ENCERRAR",versao:info?.piloto?.versao??0}});
  setInfo(await api<Info>(url));setMsg(f?"Piloto restrito iniciado. O bot geral foi pausado. Nenhuma mensagem foi enviada por esta ação.":"Piloto encerrado. Todos os envios continuam bloqueados e o bot geral permanece pausado.");
 }catch(err){setErro((err as Error).message);}finally{setOcupado(false);}}
 return <section className="cartao space-y-3 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-ouro"><h2 className="text-xl font-semibold">Teste restrito de entrevistas</h2><p>Um único número, até 60 minutos e 40 tentativas de envio. Sem IA. Durante o piloto, mensagens comuns, templates e envios para outros contatos são bloqueados no canal.</p><p className="text-sm">Ao expirar, os envios continuam bloqueados até encerrar o piloto. O encerramento mantém todos os envios e rotinas bloqueados; não religa o bot geral. A liberação geral exige outra alteração autorizada. Envios já iniciados podem concluir.</p><button className="btn" disabled={ocupado} onClick={carregar}>Conferir piloto de entrevistas</button>
 {erro&&<p role="alert" className="text-red-500">{erro}</p>}{msg&&<p role="status">{msg}</p>}
 {info&&!info.disponivel&&<p>Recurso ainda não liberado nesta instalação. Nenhum envio foi ativado.</p>}
 {info?.disponivel&&(info.piloto?.ativo?<div><p>Destino autorizado: final {info.piloto.telefone?.slice(-4)}. Até {new Date(info.piloto.expiraEm!).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (São Paulo).</p><p>{info.piloto.enviados}/40 tentativas consumidas.</p><button className="btn-perigo" disabled={ocupado} onClick={()=>alterar()}>Encerrar piloto restrito</button></div>:<form onSubmit={alterar} className="space-y-3"><fieldset disabled={ocupado}><label className="block">Único WhatsApp autorizado<input className="campo" name="telefone" type="tel" required maxLength={30} autoComplete="off" /></label><label className="block">Duração do teste (minutos)<input className="campo" name="minutos" type="number" required min={1} max={60} defaultValue={30}/></label><button className="btn-primario mt-3">Iniciar somente para este número</button></fieldset></form>)}
 </section>;
}
