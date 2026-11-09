"""Ativa somente respostas solicitadas por DONO/GERENTE, após publicação comprovada."""
import argparse
import json
import os
import re
import secrets
import shutil
import sys
import time
from pathlib import Path

from deploy_vps_comum import (aguardar_saude, ambiente_container, conferir_https, container, escrever_privado, executar)
from protecao_operacao import exigir_sem_recuperacao


PREFLIGHT = r"""
const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient();
(async()=>{try {
 const chaveIaExistente=!!(process.env.ANTHROPIC_API_KEY||process.env.ANTHROPIC_AUTH_TOKEN);
 const canal=process.env.WHATSAPP_PROVIDER||'ausente';
 const equipe=await p.usuario.count({where:{ativo:true,papel:{in:['DONO','GERENTE']}}});
 let whatsapp='desconectado';
 if(canal==='evolution'&&process.env.EVOLUTION_URL&&process.env.EVOLUTION_API_KEY){try{
 const r=await fetch(process.env.EVOLUTION_URL.replace(/\/$/,'')+'/instance/connectionState/'+(process.env.EVOLUTION_INSTANCIA||'barberos'),{headers:{apikey:process.env.EVOLUTION_API_KEY},signal:AbortSignal.timeout(15000)});
 const b=await r.json();if(r.ok&&b.instance?.state==='open') whatsapp='conectado';
 }catch{whatsapp='indisponivel'}}
 console.log(JSON.stringify({equipe,whatsapp,chaveIaExistente,canal}));
}finally{await p.$disconnect()}})().catch(()=>process.exit(1));
"""

ATIVAR = r"""
const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient();
(async()=>{try{await p.$transaction(async tx=>{
 const c=await tx.configuracao.findUniqueOrThrow({where:{id:1}});
 if(!c.botAtivo){await tx.configuracao.update({where:{id:1},data:{botAtivo:true}});
 await tx.auditoria.create({data:{acao:'atendimento.teste_equipe.ativar',entidade:'configuracao',entidadeId:'1',dados:{antes:{botAtivo:false},depois:{botAtivo:true},modo:'DONO_GERENTE'}}});}
 const planos=await tx.plano.findMany({where:{nome:{contains:'Business',mode:'insensitive'},precoCentavos:{in:[9700,15600]}}});
 if(planos.length!==2||new Set(planos.map(x=>x.precoCentavos)).size!==2) throw Error('Business divergente');
 for(const x of planos) if(!x.vendaSomenteEquipe){
 await tx.plano.update({where:{id:x.id},data:{vendaSomenteEquipe:true}});
 await tx.auditoria.create({data:{acao:'plano.venda_equipe.ativar',entidade:'plano',entidadeId:x.id,dados:{antes:{vendaSomenteEquipe:false},depois:{vendaSomenteEquipe:true},precoCentavos:x.precoCentavos}}});}
 });console.log(JSON.stringify({botAtivo:true,businessRestritos:2}));
}finally{await p.$disconnect()}})().catch(()=>process.exit(1));
"""

WEBHOOK = r"""
const {createHmac}=require('node:crypto');
(async()=>{
 if(!process.env.SESSION_SECRET&&!process.env.EVOLUTION_WEBHOOK_TOKEN) throw Error('Autenticação do webhook ausente');
 const token=process.env.EVOLUTION_WEBHOOK_TOKEN||createHmac('sha256',process.env.SESSION_SECRET).update('evolution-webhook').digest('hex');
 const r=await fetch(process.env.EVOLUTION_URL.replace(/\/$/,'')+'/webhook/set/'+(process.env.EVOLUTION_INSTANCIA||'barberos'),{
 method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({webhook:{enabled:true,url:process.env.EVOLUTION_WEBHOOK_URL||'http://app:3000/api/whatsapp/evolution',headers:{'x-barberos-token':token},byEvents:false,base64:false,events:['MESSAGES_UPSERT','MESSAGES_UPDATE']}}),signal:AbortSignal.timeout(15000)});
 if(!r.ok) throw Error('Webhook não configurado'); console.log('{"webhook":true}');
})().catch(()=>process.exit(1));
"""

MODELO = None


def provar_modelo(app):
    if not MODELO:
        raise RuntimeError('Bundle da prova do SDK não informado.')
    programa = "process.env.BARBEROS_PROVA_IA='mensagem';\n" + MODELO
    prova = json.loads(executar(['docker', 'exec', '-i', app['Id'], 'node'], entrada=programa.encode(), prazo=40))
    if prova.get('modeloRespondeu') is not True:
        raise RuntimeError('Modelo existente não respondeu: status ' + str(prova.get('status')) +
                           ', motivo ' + str(prova.get('motivo', 'indefinido')) + '.')
    return {'modeloRespondeu': True, 'sdkExternalizado': prova.get('sdkExternalizado')}


def compor(base, projeto, arquivos, privado):
    args = ['docker', 'compose', '-p', projeto, '--env-file', str(base / '.env')]
    if (base / '.env.estudio').exists():
        args += ['--env-file', str(base / '.env.estudio')]
    args += ['--env-file', str(privado)]
    for arquivo in arquivos:
        args += ['-f', str(arquivo)]
    return args


def ativar(base, projeto, commit):
    exigir_sem_recuperacao(base)
    pasta = base / 'releases' / commit
    registro = json.loads((pasta / 'operacao.json').read_text())
    if not registro.get('concluido') or registro.get('revisao') != commit:
        raise RuntimeError('Publicação não comprovada.')
    app = aguardar_saude(projeto, prazo=35)
    if ambiente_container(app).get('BARBEROS_REVISAO') != commit:
        raise RuntimeError('Aplicação mudou desde a publicação.')
    imagem = 'barberos-atendimento:' + commit
    info = json.loads(executar(['docker', 'image', 'inspect', imagem]))[0]
    if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != commit:
        raise RuntimeError('Imagem ASR divergente.')
    if shutil.disk_usage(base).free < 2 * 1024**3:
        raise RuntimeError('Reserva de disco insuficiente.')
    memoria = next(int(l.split()[1]) for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))
    if memoria < 1500 * 1024:
        raise RuntimeError('Reserva de memória insuficiente.')
    preflight = json.loads(executar(['docker', 'exec', app['Id'], 'node', '-e', PREFLIGHT], prazo=40))
    if not preflight.get('chaveIaExistente'):
        raise RuntimeError('Credencial de IA existente ausente; configuração necessária.')
    if preflight.get('whatsapp') != 'conectado':
        raise RuntimeError('WhatsApp desconectado ou indisponível; conectar pelo painel.')
    if not preflight.get('equipe'):
        raise RuntimeError('Nenhum dono/gerente ativo cadastrado para testar.')
    # Uma chamada técnica curta, sem dados de cliente, à mesma IA já configurada.
    try:
        prova_modelo = provar_modelo(app)
    except RuntimeError:
        raise
    except Exception:
        raise RuntimeError('Modelo existente não respondeu ao teste técnico; conferir autenticação e disponibilidade.') from None
    privado = base / '.env.atendimento'
    if privado.is_symlink():
        raise RuntimeError('Configuração privada inesperada.')
    if not privado.exists():
        escrever_privado(privado, 'BOT_TRANSCRICAO_TOKEN=' + secrets.token_hex(32) + '\n')
    os.chmod(privado, 0o600)
    override = pasta / 'atendimento-teste.json'
    servicos = {'app': {'environment': {'WHATSAPP_ATENDIMENTO_TESTE_EQUIPE': 'true', 'WHATSAPP_MIDIA_ATIVA': 'true',
                'BOT_TRANSCRICAO_URL': 'http://atendimento:8091/transcrever', 'BOT_TRANSCRICAO_TOKEN': '${BOT_TRANSCRICAO_TOKEN}'}},
                'atendimento': {'image': imagem, 'restart': 'unless-stopped', 'read_only': True,
                'user': '10001:10001', 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
                'mem_limit': '768m', 'cpus': 0.5, 'pids_limit': 64,
                'tmpfs': ['/tmp:rw,noexec,nosuid,size=32m,mode=1777'],
                'environment': {'BOT_TRANSCRICAO_TOKEN': '${BOT_TRANSCRICAO_TOKEN}'}}}
    if override.exists():
        raise RuntimeError('Ativação anterior requer conferência; não repetir.')
    escrever_privado(override, json.dumps({'services': servicos}))
    arquivos = registro['composeAtual']
    if any(not Path(p).is_relative_to(base) or not Path(p).is_file() or Path(p).is_symlink() for p in arquivos):
        raise RuntimeError('Compose anterior não validado.')
    anterior = compor(base, projeto, arquivos, privado)
    novo = compor(base, projeto, [*arquivos, str(override)], privado)
    try:
        executar([*novo, 'config', '--quiet'])
        executar([*novo, 'up', '-d', '--no-build', '--no-deps', 'atendimento'], prazo=120)
        for _ in range(30):
            worker = container(projeto, 'atendimento')
            if worker['State'].get('Health', {}).get('Status') == 'healthy':
                break
            time.sleep(2)
        else:
            raise RuntimeError('ASR sem saúde.')
        executar([*novo, 'up', '-d', '--no-build', '--no-deps', 'app'], prazo=120)
        novo_app = aguardar_saude(projeto)
        env = ambiente_container(novo_app)
        if env.get('WHATSAPP_ATENDIMENTO_TESTE_EQUIPE') != 'true' or env.get('WHATSAPP_ENVIOS_BLOQUEADOS') != 'true' or env.get('WHATSAPP_MIDIA_ATIVA') != 'true':
            raise RuntimeError('Isolamento do teste não confirmado.')
        conferir_https(commit)
        executar(['docker', 'exec', novo_app['Id'], 'node', '-e', WEBHOOK], prazo=25)
        # Não envia mensagem nem emite cobrança durante a ativação.
        resultado = json.loads(executar(['docker', 'exec', novo_app['Id'], 'node', '-e', ATIVAR], prazo=45))
        estado = {'concluido': True, 'revisao': commit, 'compose': [*arquivos, str(override)], **preflight, **prova_modelo, **resultado}
        escrever_privado(pasta / 'atendimento-ativado.json', json.dumps(estado))
        return estado
    except BaseException:
        executar([*anterior, 'up', '-d', '--no-build', '--no-deps', 'app'], prazo=120)
        aguardar_saude(projeto)
        raise


if __name__ == '__main__':
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('base'); parser.add_argument('projeto'); parser.add_argument('commit')
    parser.add_argument('--prova-sdk-stdin', action='store_true')
    args = parser.parse_args()
    if args.prova_sdk_stdin:
        MODELO = sys.stdin.read(1024 * 1024 + 1)
        if not MODELO or len(MODELO) > 1024 * 1024:
            raise SystemExit('Bundle da prova inválido.')
    base = Path(args.base)
    if os.geteuid() != 0 or base.is_symlink() or not re.fullmatch(r'/[A-Za-z0-9_/-]+', args.base) or '..' in base.parts or not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.projeto) or not re.fullmatch(r'[a-f0-9]{40}', args.commit):
        raise SystemExit('Parâmetros inválidos.')
    trava = base / '.publicacao.lock'
    if trava.is_symlink():
        raise SystemExit('Trava inesperada.')
    try:
        with open(trava, 'a') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(ativar(base, args.projeto, args.commit)))
    except BaseException as erro:
        motivo = str(erro) if isinstance(erro, RuntimeError) else 'Conferência operacional não concluída.'
        print(json.dumps({'concluido': False, 'erro': motivo}))
        raise SystemExit(1) from None
