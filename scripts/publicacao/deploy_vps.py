"""Publicação em instalação existente, com ensaio de schema e retorno à imagem anterior."""
import argparse
import json
import os
import re
import secrets
import shutil
import signal
import time
from pathlib import Path

from deploy_vps_comum import (COMANDO_MIGRACAO, CONTROLES_PUBLICACAO, aguardar_saude, ambiente_container, arquivo_ambiente, backup_verificado,
    conferir_https, conferir_migracoes, conferir_pacote, conferir_central_desligada, consultar_banco, container, ensaiar_schema,
    escrever_privado, executar, exigir_agenda_equipe, exigir_contrato_pix_imagem, exigir_migracoes_da_publicacao, migracoes)
from protecao_operacao import (MARCADOR, ambiente_rollback, conferir_capacidade, containers_projeto, exigir_banco_isolavel,
    exigir_sem_recuperacao, parar_escritores, registrar_quarentena, retomar_auxiliares)

TAG_EVOLUTION_PREVIA = "barberos-evolution:2.3.7-previa-clicavel"
DESTINO_RELATORIOS = "/run/barberos-relatorios"


def interrompido(_sinal, _frame):
    raise InterruptedError("Publicação interrompida.")


def memoria_disponivel_kib():
    return next(int(l.split()[1]) for l in Path("/proc/meminfo").read_text().splitlines() if l.startswith("MemAvailable:"))


def conferir_controles_cliente(app, banco, imagem_com_contrato_verificado):
    if app["Image"] != imagem_com_contrato_verificado:
        raise RuntimeError("O aplicativo ativo não usa a imagem cujo contrato Pix foi conferido.")
    env = ambiente_container(app)
    modo = env.get("MAQUININHA")
    if modo != "manual":
        raise RuntimeError("O container em execução não confirmou MAQUININHA manual.")
    if env.get("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS") != "true":
        raise RuntimeError("O container em execução não confirmou o bloqueio de cobranças reais.")
    return {"agendaEquipeBanco": exigir_agenda_equipe(banco), "stoneManualContainer": True,
            "modoMaquininhaContainer": modo, "lotePixContratoBloqueadoNaImagem": True,
            "cobrancasReaisBloqueadasContainer": True}


def conferir_evolution(projeto):
    servicos = [c for c in containers_projeto(projeto)
                if c["Config"].get("Labels", {}).get("com.docker.compose.service") == "evolution"]
    adaptada = next((c for c in servicos if c["Config"].get("Image") == TAG_EVOLUTION_PREVIA), None)
    if adaptada is None:
        return None
    if len(servicos) != 1:
        raise RuntimeError("Serviço Evolution adaptado aparece mais de uma vez na instalação.")
    try:
        imagem = json.loads(executar(["docker", "image", "inspect", TAG_EVOLUTION_PREVIA]))[0]["Id"]
    except RuntimeError:
        raise RuntimeError("A tag da Evolution adaptada não está disponível localmente.") from None
    if imagem != adaptada["Image"]:
        raise RuntimeError("A tag local da Evolution adaptada diverge da imagem do container.")
    return {"id": adaptada["Id"], "imagem": imagem, "ativa": adaptada["State"]["Running"]}


def montagem_demonstrativo(base, app, imagem):
    anterior = next((m for m in app.get("Mounts", []) if m["Destination"] == DESTINO_RELATORIOS), None)
    if anterior and (anterior["Type"] != "bind" or anterior["RW"]):
        raise RuntimeError("Montagem anterior dos demonstrativos não é um bind somente leitura.")
    pasta = Path(anterior["Source"]) if anterior else base / "relatorios-rh"
    if not anterior and not pasta.exists() and not pasta.is_symlink():
        return None
    arquivo = pasta / "demonstrativo.xlsx"
    if not pasta.is_absolute() or pasta.is_symlink() or not arquivo.is_file() or arquivo.is_symlink():
        raise RuntimeError("Pasta privada ou demonstrativo XLSX indisponível.")
    # Usa o usuário efetivo da imagem candidata, antes de parar qualquer serviço.
    executar(["docker", "run", "--rm", "--network", "none", "--read-only", "--volume",
              str(pasta) + ":" + DESTINO_RELATORIOS + ":ro", "--entrypoint", "node", imagem, "-e",
              "const fs=require('node:fs'),f=fs.openSync('/run/barberos-relatorios/demonstrativo.xlsx','r');"
              "const b=Buffer.alloc(4);if(fs.readSync(f,b)!==4||b.toString('hex')!=='504b0304')process.exit(1)"])
    return {"type": "bind", "source": str(pasta), "target": DESTINO_RELATORIOS,
            "read_only": True, "bind": {"create_host_path": False}}


def conferir_demonstrativo_ativo(app, origem):
    montada = any(m["Destination"] == DESTINO_RELATORIOS and m["Source"] == origem
                  and m["Type"] == "bind" and not m["RW"] for m in app.get("Mounts", []))
    if not montada or ambiente_container(app).get("DEMONSTRATIVO_RH_ARQUIVO") != DESTINO_RELATORIOS + "/demonstrativo.xlsx":
        raise RuntimeError("O aplicativo não preservou a montagem privada do demonstrativo.")


def publicar(base, projeto, commit, imagem_esperada):
    if os.geteuid() != 0 or base.is_symlink() or not (base / ".env").is_file():
        raise RuntimeError("Instalação existente não confirmada.")
    exigir_sem_recuperacao(base)
    pasta = base / "releases" / commit
    codigo = conferir_pacote(pasta, commit)
    registro = pasta / "operacao.json"
    if registro.exists():
        anterior = json.loads(registro.read_text())
        if anterior.get("concluido"):
            app = aguardar_saude(projeto, prazo=30)
            banco = container(projeto, "db")
            if app["Image"] != anterior.get("imagemNova"):
                raise RuntimeError("A imagem instalada mudou desde o registro da publicação.")
            exigir_agenda_equipe(banco["Id"])
            conferir_central_desligada(app)
            exigir_contrato_pix_imagem(app["Image"])
            controles = conferir_controles_cliente(app, banco["Id"], app["Image"])
            if anterior.get("origemDemonstrativoRh"):
                conferir_demonstrativo_ativo(app, anterior["origemDemonstrativoRh"])
            evolution_anterior = anterior.get("evolutionPreservada")
            if evolution_anterior and conferir_evolution(projeto) != evolution_anterior:
                raise RuntimeError("A Evolution adaptada mudou desde o registro da publicação.")
            conferir_https(commit)
            return {"concluido": True, "revisao": commit, "reutilizado": True, "controlesCliente": controles}
        raise RuntimeError("Execução anterior requer conferência do registro privado antes de continuar.")
    estado = {"revisao": commit, "etapa": "conferencia", "concluido": False, "rollback": None}

    def etapa(nome):
        estado["etapa"] = nome
        tmp = pasta / "operacao.tmp"
        tmp.write_text(json.dumps(estado, indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, registro)

    app = container(projeto, "app")
    banco = container(projeto, "db")
    backup_anterior = container(projeto, "backup")
    quarentena = ambiente_container(app).get("BARBEROS_QUARENTENA_RESTAURACAO", "").strip().lower()
    if quarentena and quarentena != "false":
        raise RuntimeError("Aplicativo em quarentena de restauração; conclua a reconciliação antes de publicar.")
    if app["Image"] != imagem_esperada or banco["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Estado instalado mudou desde o inventário ou banco indisponível.")
    estado["agendaEquipeAntes"] = exigir_agenda_equipe(banco["Id"])
    aguardar_saude(projeto, prazo=30)
    if shutil.disk_usage(base).free < 3 * 1024**3:
        raise RuntimeError("Reserva mínima de disco indisponível após carregar imagens.")
    if memoria_disponivel_kib() < 2400 * 1024:
        raise RuntimeError("Memória disponível insuficiente para ativar o worker com reserva para o aplicativo.")
    rede = projeto + "_default"
    if rede not in app["NetworkSettings"]["Networks"] or rede not in banco["NetworkSettings"]["Networks"]:
        raise RuntimeError("Rede esperada não confirmada.")
    novas = {s: f"barberos-{s}:{commit}" for s in ("app", "backup", "video-worker")}
    for servico, imagem in novas.items():
        info = json.loads(executar(["docker", "image", "inspect", imagem]))[0]
        if info["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != commit:
            raise RuntimeError("Imagem não corresponde ao commit aprovado.")
        if servico == "app":
            imagem_nova = info["Id"]
            exigir_contrato_pix_imagem(imagem_nova)
    pendentes = conferir_migracoes(migracoes(banco["Id"]), codigo / "prisma/migrations")
    exigir_migracoes_da_publicacao(pendentes)
    configs_antigos = app["Config"]["Labels"]["com.docker.compose.project.config_files"].split(",")
    for p in configs_antigos:
        if not Path(p).is_relative_to(base) or not Path(p).is_file() or Path(p).is_symlink():
            raise RuntimeError("Configuração anterior não pode ser preservada automaticamente.")
    evolution = conferir_evolution(projeto)
    relatorios = montagem_demonstrativo(base, app, novas["app"])
    estado.update(imagemAnterior=app["Image"], backupAnterior=backup_anterior["Image"], composeAnterior=configs_antigos, migracoesPendentes=pendentes)
    etapa("preservar")
    executar(["docker", "tag", app["Image"], "barberos-app:antes-" + commit])
    try:
        executar(["docker", "image", "inspect", backup_anterior["Image"]])
    except RuntimeError:
        # A instalação legada pode manter o container após remover sua imagem.
        # A troca só prossegue se o backup NOVO restaurar banco/mídias e o app anterior for compatível.
        estado["backupAnteriorPreservado"] = False
    else:
        executar(["docker", "tag", backup_anterior["Image"], "barberos-backup:antes-" + commit])
        estado["backupAnteriorPreservado"] = True
    etapa("preservar")
    env_app = ambiente_container(app)
    retorno_com_bloqueio = env_app.get("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS") == "true"
    env_backup = ambiente_container(backup_anterior)
    volume = projeto + "_estudio_media"
    estado["capacidade"] = conferir_capacidade(base, banco, app, volume)
    exigir_banco_isolavel(projeto, banco)
    env_backup.update(BACKUP_ESTUDIO_MEDIA="/media-estudio", BACKUP_DIAS_LOCAL="999999", BACKUP_S3_BUCKET="")
    ativacao_iniciada = False
    isolamento_iniciado = False
    migracao_iniciada = False
    servicos_parados = []
    compose = None
    try:
        # Ingresso, app, Evolution, worker e backup param antes da cópia e do schema.
        # O marcador persiste inclusive se o processo for encerrado inesperadamente.
        etapa("isolar_escritores")
        registrar_quarentena(base, {"revisao": commit, "etapa": estado["etapa"]})
        isolamento_iniciado = True
        servicos_parados = parar_escritores(projeto, banco["Id"])
        estado["servicosParados"] = servicos_parados
        estado["capacidade"] = conferir_capacidade(base, banco, app, volume)
        arquivo_ambiente(pasta / "backup.env", env_backup)
        # A primeira montagem usa o diretório da imagem antes da montagem de leitura.
        executar(["docker", "run", "--rm", "--network", "none", "-v", volume + ":/app/media", novas["app"], "node", "-e",
                  "require('fs').accessSync('/app/media',require('fs').constants.W_OK)"])
        etapa("backup_e_restauracao")
        estado["backupAntes"] = backup_verificado(base, novas["backup"], rede, pasta / "backup.env", volume, volume_banco=estado["capacidade"]["volumePostgres"])
        etapa("ensaio_migracao_e_compatibilidade")
        ensaiar_schema(banco["Id"], estado["backupAntes"]["arquivo"], "barberos_ensaio_" + commit[:12], rede, env_app, novas["app"], app["Image"], pasta)
        privado = base / ".env.estudio"
        if privado.is_symlink():
            raise RuntimeError("Arquivo de configuração Studio inesperado.")
        if not privado.exists():
            escrever_privado(privado, "ESTUDIO_WORKER_TOKEN=" + secrets.token_hex(32) + "\n")
        os.chmod(privado, 0o600)
        envs = ["--env-file", str(base / ".env"), "--env-file", str(privado)]
        (codigo / ".env").symlink_to(base / ".env")
        override = codigo / "deploy/versao.json"
        servicos = {
            "app": {"image": novas["app"], "command": ["node", "server.js"], "environment": CONTROLES_PUBLICACAO},
            "backup": {"image": novas["backup"], "volumes": [str(base / "backups") + ":/backups"]},
            "video-worker": {"image": novas["video-worker"]},
        }
        if relatorios:
            servicos["app"]["volumes"] = [relatorios]
            servicos["app"]["environment"] = {**CONTROLES_PUBLICACAO,
                                               "DEMONSTRATIVO_RH_ARQUIVO": DESTINO_RELATORIOS + "/demonstrativo.xlsx"}
        if evolution:
            servicos["evolution"] = {"image": TAG_EVOLUTION_PREVIA, "pull_policy": "never"}
        escrever_privado(override, json.dumps({"services": servicos}))
        arquivos = [codigo / "deploy/docker-compose.yml", codigo / "deploy/docker-compose.estudio.producao.yml", override]
        compose = ["docker", "compose", "-p", projeto, *envs]
        for arquivo in arquivos:
            compose += ["-f", str(arquivo)]
        executar([*compose, "config", "--quiet"])
        exigir_agenda_equipe(banco["Id"])
        etapa("migracao_producao")
        if pendentes:
            # Depois deste ponto não se declara rollback funcional baseado só em leitura.
            migracao_iniciada = True
            registrar_quarentena(base, {"revisao": commit, "etapa": "migracao_iniciada", "migracoes": pendentes})
            executar([*compose, "run", "--rm", "--no-deps", "app", *COMANDO_MIGRACAO], prazo=180)
        if conferir_migracoes(migracoes(banco["Id"]), codigo / "prisma/migrations"):
            raise RuntimeError("Migrações não concluídas.")
        etapa("troca_aplicacao")
        ativacao_iniciada = True
        executar([*compose, "up", "-d", "--no-build", "--no-deps", "app"], prazo=180)
        novo = aguardar_saude(projeto)
        if relatorios:
            conferir_demonstrativo_ativo(novo, relatorios["source"])
            estado["origemDemonstrativoRh"] = relatorios["source"]
        estado["centralAgentes"] = conferir_central_desligada(novo)
        estado["controlesCliente"] = conferir_controles_cliente(novo, banco["Id"], imagem_nova)
        retomar_auxiliares(servicos_parados, {"caddy"})
        conferir_https(commit)
        etapa("ativacao_worker")
        executar([*compose, "up", "-d", "--no-build", "--no-deps", "video-worker"], prazo=180)
        limite = time.monotonic() + 90
        while time.monotonic() < limite:
            if int(consultar_banco(banco["Id"], 'SELECT count(*) FROM estudio_workers WHERE "vistoEm" > now() - interval \'2 minutes\'')) > 0:
                break
            time.sleep(5)
        else:
            raise RuntimeError("Worker não confirmou autenticação e presença.")
        etapa("backup_apos_migracao")
        estado["backupDepois"] = backup_verificado(base, novas["backup"], rede, pasta / "backup.env", volume, tipo="MANUAL", volume_banco=estado["capacidade"]["volumePostgres"])
        conferir_https(commit)
        estado["controlesCliente"] = conferir_controles_cliente(container(projeto, "app"), banco["Id"], imagem_nova)
        # O daemon compartilha .backup.lock com o one-shot e só inicia após sua restauração.
        etapa("ativacao_backup_programado")
        executar([*compose, "up", "-d", "--no-build", "--no-deps", "backup"], prazo=180)
        # Transcrição local (compose próprio) também é parada no isolamento; volta com a Evolution.
        retomar_auxiliares(servicos_parados, {"evolution", "atendimento"})
        if evolution:
            if conferir_evolution(projeto) != evolution:
                raise RuntimeError("A Evolution adaptada não voltou com o container, a imagem e o estado originais.")
            estado["evolutionPreservada"] = evolution
        estado.update(concluido=True, imagemNova=novo["Image"], composeAtual=[str(p) for p in arquivos], workerAtivo=True)
        etapa("concluido")
        ativa = base / "versao-ativa.json"
        if ativa.is_symlink():
            raise RuntimeError("Registro ativo inesperado.")
        temp = pasta / "ativa.tmp"
        temp.write_text(json.dumps({"revisao": commit, "registro": str(registro), "compose": estado["composeAtual"]}))
        os.chmod(temp, 0o600)
        os.replace(temp, ativa)
        (base / MARCADOR).unlink()
        return {"concluido": True, "revisao": commit, "backupRestaurado": True, "leituraAnteriorConferida": True,
                "rollbackAutomaticoPermitido": not migracao_iniciada and retorno_com_bloqueio,
                "workerAtivo": True, "controlesCliente": estado["controlesCliente"]}
    except BaseException as erro:
        estado["concluido"] = False
        estado["etapaFalha"] = estado["etapa"]
        estado["erroTipo"] = type(erro).__name__
        if isinstance(erro, RuntimeError):
            estado["erro"] = str(erro)
        if isolamento_iniciado:
            # Reenumera também containers criados depois da primeira parada.
            try:
                parar_escritores(projeto, banco["Id"])
                estado["escritoresParadosNaFalha"] = True
            except BaseException:
                estado["escritoresParadosNaFalha"] = False
            registrar_quarentena(base, {"revisao": commit, "etapa": "falha", "migrouOuIniciouMigracao": migracao_iniciada,
                                       "escritoresParados": estado["escritoresParadosNaFalha"]})
        if isolamento_iniciado and not migracao_iniciada and estado.get("escritoresParadosNaFalha") and retorno_com_bloqueio:
            etapa("recuperar_imagem_anterior")
            try:
                rollback = pasta / "rollback.json"
                escrever_privado(rollback, json.dumps({"services": {"app": {"image": app["Image"], "command": ["node", "server.js"],
                                                                           "environment": ambiente_rollback()}}}))
                anterior = ["docker", "compose", "-p", projeto, "--env-file", str(base / ".env")]
                if (base / ".env.estudio").exists():
                    anterior += ["--env-file", str(base / ".env.estudio")]
                for arquivo in [*configs_antigos, str(rollback)]:
                    anterior += ["-f", arquivo]
                executar([*anterior, "up", "-d", "--no-build", "--no-deps", "app"], prazo=180)
                recuperado = aguardar_saude(projeto)
                conferir_central_desligada(recuperado)
                estado["rollback"] = recuperado["Image"] == app["Image"] and ambiente_container(recuperado).get("BARBEROS_QUARENTENA_RESTAURACAO") == "false"
                if not estado["rollback"]:
                    raise RuntimeError("Imagem ou bloqueios da recuperação não confirmados.")
                retomar_auxiliares(servicos_parados, {"caddy"})
                estado["recuperacaoRestrita"] = True
                registrar_quarentena(base, {"revisao": commit, "etapa": "imagem_anterior_restrita", "migrouOuIniciouMigracao": False,
                                           "escritoresParados": False, "controlesValidados": True})
            except BaseException:
                estado["rollback"] = False
                try:
                    parar_escritores(projeto, banco["Id"])
                except BaseException:
                    estado["escritoresParadosNaFalha"] = False
        elif migracao_iniciada:
            estado["recuperacaoManualObrigatoria"] = True
        elif isolamento_iniciado and not retorno_com_bloqueio:
            # Uma imagem legada pode ignorar a flag, mesmo se ela for adicionada ao override.
            estado["rollbackBloqueadoPorCobrancas"] = True
            estado["recuperacaoManualObrigatoria"] = True
        etapa("falhou")
        raise RuntimeError("Publicação interrompida; consultar registro privado da etapa e recuperação.") from None
    finally:
        (pasta / "backup.env").unlink(missing_ok=True)


if __name__ == "__main__":
    import fcntl  # A trava de publicação real roda apenas na VPS Linux.
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--imagem-anterior", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"/[A-Za-z0-9_/-]+", args.base) or ".." in Path(args.base).parts or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.project) or not re.fullmatch(r"[a-f0-9]{40}", args.commit) or not re.fullmatch(r"sha256:[a-f0-9]{64}", args.imagem_anterior):
        raise SystemExit("Parâmetros inválidos.")
    signal.signal(signal.SIGHUP, interrompido)
    signal.signal(signal.SIGTERM, interrompido)
    trava = Path(args.base) / ".publicacao.lock"
    if trava.is_symlink():
        raise SystemExit("Trava inesperada.")
    try:
        with open(trava, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(publicar(Path(args.base), args.project, args.commit, args.imagem_anterior)))
    except BaseException as erro:
        # Só as mensagens fixas deste procedimento; quem chama grava o motivo apenas no relatório cifrado.
        motivo = str(erro) if type(erro) is RuntimeError else type(erro).__name__
        print(json.dumps({"concluido": False, "revisao": args.commit, "registroPrivado": "operacao.json", "motivo": motivo}))
        raise SystemExit(1) from None
