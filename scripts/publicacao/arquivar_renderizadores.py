"""Duas imagens nominais de renderizador; a restauração externa precede qualquer remoção."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

CANONICO_SHA256 = "d355f9472f75ecf1c79584a7350572c20f22dd9db77564e163d1b13735c14897"
NOMINAIS_SHA256 = "b2d7a8919a60ecac634bfaba735d509fc8649f234d4b5b3bb79e3a940e1155bb"
APP_ESPERADO = "sha256:ad5656989e8ec6e5d2a5e1e6d0a9c8cf7929d24589e626e2673698d22df59366"
REVISAO_APP = "28422c5c894b384b3e5ed628b6cb7507021caf0d"
CONFIGURACOES = (".env", ".env.estudio", ".env.atendimento")
FLAGS_GERAIS = {
    "BARBEROS_QUARENTENA_RESTAURACAO": "false", "AGENTES_HABILITADOS": "true",
    "AGENTES_EXECUCAO_ATIVA": "false", "META_ADS_TOKEN": "",
    "RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO": "false", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO": "true",
    "WHATSAPP_ATENDIMENTO_APOS_PILOTO": "false", "WHATSAPP_ATENDIMENTO_IA_PAGA": "false",
    "WHATSAPP_ATENDIMENTO_TESTE_EQUIPE": "true", "WHATSAPP_MIDIA_ATIVA": "true",
    "WHATSAPP_ENVIOS_BLOQUEADOS": "true", "PUSH_PROVIDER": "desativado",
    "COBRANCA_LEGADA_WHATSAPP_ATIVA": "false", "COBRANCA_AUTOMATICA_WHATSAPP_ATIVA": "false",
    "PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA": "false", "MAQUININHA": "manual",
}


def carregar_canonico(codigo, codigo_nominal):
    if not isinstance(codigo, str) or hashlib.sha256(codigo.encode()).hexdigest() != CANONICO_SHA256:
        raise RuntimeError("Fonte canônica difere da revisão autorizada.")
    if not isinstance(codigo_nominal, str) or hashlib.sha256(codigo_nominal.encode()).hexdigest() != NOMINAIS_SHA256:
        raise RuntimeError("Fonte nominal difere do inventário autorizado.")
    nominal = json.loads(codigo_nominal)
    if nominal["imagemApp"] != APP_ESPERADO or nominal["revisaoApp"] != REVISAO_APP or nominal["canonicoSha256"] != CANONICO_SHA256:
        raise RuntimeError("Identidade nominal divergente.")
    alvos = {a["alvo"]: a for a in nominal["alvos"]}
    ns = {"__name__": "arquivador_canonico_582"}
    exec(compile(codigo, "arquivar_workers_582.py", "exec"), ns)
    ns["APP_ESPERADO"] = APP_ESPERADO
    ns["ALVOS"] = {a: (v["id"], v["bytes"]) for a, v in alvos.items()}

    def tags_alvo(alvo=None):
        if not isinstance(alvo, str) or alvo not in alvos:
            raise RuntimeError("Selecione exatamente uma das duas imagens autorizadas.")
        return list(alvos[alvo]["tags"])

    def conferir_app(projeto, esperada):
        if esperada != APP_ESPERADO:
            raise RuntimeError("Imagem instalada difere da autorização.")
        ids = ns["cmd"](["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + projeto,
                         "--filter", "label=com.docker.compose.service=app"]).split()
        if len(ids) != 1:
            raise RuntimeError("Aplicação atual não confirmada.")
        lista = json.loads(ns["cmd"](["docker", "inspect", ids[0]]))
        if len(lista) != 1:
            raise RuntimeError("Aplicação atual divergente.")
        app = lista[0]
        env = dict(x.split("=", 1) for x in app.get("Config", {}).get("Env", []) if "=" in x)
        if (app.get("Image") != esperada or app.get("State", {}).get("Status") != "running"
                or app.get("State", {}).get("Health", {}).get("Status") != "healthy"
                or env.get("BARBEROS_REVISAO") != REVISAO_APP
                or any(env.get(k) != v for k, v in {**FLAGS_GERAIS, **nominal["flags"]}.items())):
            raise RuntimeError("Aplicação, saúde ou controles operacionais mudaram.")

    def candidatos(alvo=None):
        tags = tags_alvo(alvo)
        ref = alvos[alvo]
        ids = ns["cmd"](["docker", "ps", "-aq"]).split()
        usados = {c["Image"] for c in json.loads(ns["cmd"](["docker", "inspect", *ids]))} if ids else set()
        lista = json.loads(ns["cmd"](["docker", "image", "inspect", *tags]))
        if not isinstance(lista, list) or len(lista) != len(tags):
            raise RuntimeError("Inventário de aliases incompleto.")
        for img in lista:
            atuais = img.get("RepoTags")
            if (img.get("Id") != ref["id"] or img.get("Size") != ref["bytes"] or ref["id"] in usados
                    or not isinstance(atuais, list) or len(atuais) != len(tags) or set(atuais) != set(tags)
                    or img.get("Os") != ref["os"] or img.get("Architecture") != ref["architecture"]
                    or img.get("RootFS") != ref["rootfs"]):
                raise RuntimeError("Imagem, aliases, plataforma, RootFS ou referências mudaram.")
        return [{"tag": tag, "id": ref["id"], "bytesImagem": ref["bytes"]} for tag in tags]

    retrato_original, preservacao_original = ns["retrato"], ns["conferir_preservacao"]

    def retrato(base):
        if (base / "recuperacao-pendente.json").exists() or (base / "recuperacao-pendente.json").is_symlink():
            raise RuntimeError("Recuperação pendente; manutenção bloqueada.")
        for nome in CONFIGURACOES:
            p = base / nome
            if p.is_symlink() or not p.is_file() or p.stat().st_nlink != 1:
                raise RuntimeError("Configuração privada preservada não confirmada.")
        estado = retrato_original(base)
        for nome in CONFIGURACOES:
            p = base / nome
            estado["arquivos"][str(p)] = ns["soma"](p)
        return estado

    def conferir_preservacao(antes, depois, tags=()):
        preservacao_original(antes, depois, tags)
        if tags and any(s.endswith(" " + tag) for s in depois["imagens"] for tag in tags):
            raise RuntimeError("Alias selecionado ainda presente.")

    ns.update(tags_alvo=tags_alvo, conferir_app=conferir_app, candidatos=candidatos,
              retrato=retrato, conferir_preservacao=conferir_preservacao)
    return ns


def conferir_prova(entrada, ns):
    alvo, nome, checksum = entrada["alvo"], entrada["arquivo"], entrada["sha256"]
    if not isinstance(nome, str) or not re.fullmatch(r"workers-\d+\.tar\.gz", nome):
        raise RuntimeError("Arquivo de restauração inválido.")
    if not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        raise RuntimeError("Hash de restauração inválido.")
    registro = Path(entrada["base"]) / "worker-archives" / (nome + ".json")
    if registro.is_symlink() or not registro.is_file():
        raise RuntimeError("Registro de restauração inesperado.")
    r = json.loads(registro.read_text(encoding="utf8"))
    esperado = {"alvo": alvo, "arquivo": nome, "sha256": checksum, "bytes": r.get("bytes"),
                "imagens": r.get("imagens"), "restauracaoIsoladaValidada": True, "aplicacaoSinteticaValidada": True}
    prova = entrada.get("provaRestauracao")
    if (not isinstance(prova, dict) or prova != esperado
            or prova.get("restauracaoIsoladaValidada") is not True or prova.get("aplicacaoSinteticaValidada") is not True
            or not isinstance(r.get("bytes"), int) or isinstance(r["bytes"], bool) or r["bytes"] <= 0
            or r.get("imagens") != ns["candidatos"](alvo)):
        raise RuntimeError("Restauração externa e sintaxe do app não comprovadas para este arquivo.")


def executar(entrada):
    comuns = {"codigoCanonico", "codigoAlvos", "base", "projeto", "imagemApp", "modo", "alvo"}
    if not isinstance(entrada, dict) or entrada.get("modo") not in ("preparar", "retomar", "concluir"):
        raise RuntimeError("Operação inválida.")
    esperadas = comuns | ({"arquivo", "sha256", "provaRestauracao"} if entrada["modo"] == "concluir" else set())
    if set(entrada) != esperadas:
        raise RuntimeError("Contrato da operação divergente.")
    ns = carregar_canonico(entrada["codigoCanonico"], entrada["codigoAlvos"])
    diretorio, projeto, imagem, alvo = (entrada[k] for k in ("base", "projeto", "imagemApp", "alvo"))
    if (not isinstance(diretorio, str) or not re.fullmatch(r"/[A-Za-z0-9_/-]+", diretorio)
            or ".." in Path(diretorio).parts or not isinstance(projeto, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", projeto)):
        raise RuntimeError("Instalação inválida.")
    base = Path(diretorio)
    if os.geteuid() != 0 or base.is_symlink() or (base / "backups").is_symlink():
        raise RuntimeError("Diretório inválido.")
    ns["validar_app_alvo"](imagem, alvo)
    import fcntl
    trava = base / ".publicacao.lock"
    if trava.is_symlink():
        raise RuntimeError("Trava inválida.")
    with trava.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (base / "recuperacao-pendente.json").exists() or (base / "recuperacao-pendente.json").is_symlink():
            raise RuntimeError("Recuperação pendente.")
        if entrada["modo"] == "concluir":
            conferir_prova(entrada, ns)
            r = ns["concluir"](base, projeto, imagem, entrada["arquivo"], entrada["sha256"], alvo)
            return {**r, "restauracaoIsoladaValidada": True, "aplicacaoSinteticaValidada": True}
        return ns[entrada["modo"]](base, projeto, imagem, alvo)


if __name__ == "__main__":
    os.umask(0o077)
    texto = sys.stdin.read(2 * 1024**2 + 1)
    if len(texto) > 2 * 1024**2:
        raise RuntimeError("Entrada excede limite.")
    print(json.dumps(executar(json.loads(texto))))
