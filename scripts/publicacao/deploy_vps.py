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

from deploy_vps_comum import (CONTROLES_PUBLICACAO, aguardar_saude, ambiente_container, arquivo_ambiente, backup_verificado,
    conferir_https, conferir_migracoes, conferir_pacote, conferir_central_desligada, consultar_banco, container, ensaiar_schema,
    escrever_privado, executar, exigir_agenda_equipe, exigir_contrato_pix_imagem, exigir_migracoes_da_publicacao, migracoes)
from protecao_operacao import (MARCADOR, ambiente_rollback, conferir_capacidade, exigir_banco_isolavel,
    exigir_sem_recuperacao, parar_escritores, registrar_quarentena, retomar_auxiliares)


def interrompido(_sinal, _frame):
    raise InterruptedError("Publicação interrompida.")


def memoria_disponivel_kib():
    return next(int(l.split()[1]) for l in Path("/proc/meminfo").read_text().splitlines() if l.startswith("MemAvailable:"))


def conferir_controles_cliente(app, banco, imagem_com_contrato_verificado):
    if app["Image"] != imagem_com_contrato_verificado:
        raise RuntimeError("O aplicativo ativo não usa a imagem cujo contrato Pix foi conferido.")
    modo = ambiente_container(app).get("MAQUININHA")
    if modo != "manual":
        raise RuntimeError("O container em execução não confirmou MAQUININHA manual.")
    return {"agendaEquipeBanco": exigir_agenda_equipe(banco), "stoneManualContainer": True,
            "modoMaquininhaContainer": modo, "lotePixContratoBloqueadoNaImagem": True}


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
        escrever_privado(override, json.dumps({"services": {
            "app": {"image": novas["app"], "command": ["node", "server.js"], "environment": {
                **CONTROLES_PUBLICACAO}},
            "backup": {"image": novas["backup"], "volumes": [str(base / "backups") + ":/backups"]},
            "video-worker": {"image": novas["video-worker"]}}}))
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
            executar([*compose, "run", "--rm", "--no-deps", "app", "prisma", "migrate", "deploy"], prazo=180)
        if conferir_migracoes(migracoes(banco["Id"]), codigo / "prisma/migrations"):
            raise RuntimeError("Migrações não concluídas.")
        etapa("troca_aplicacao")
        ativacao_iniciada = True
        executar([*compose, "up", "-d", "--no-build", "--no-deps", "app"], prazo=180)
        novo = aguardar_saude(projeto)
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
                "rollbackAutomaticoPermitido": not migracao_iniciada,
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
        if isolamento_iniciado and not migracao_iniciada and estado.get("escritoresParadosNaFalha"):
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
    except BaseException:
        print(json.dumps({"concluido": False, "revisao": args.commit, "registroPrivado": "operacao.json"}))
        raise SystemExit(1) from None
