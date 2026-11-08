"""Manifesto de um snapshot PostgreSQL; sem dados pessoais em arquivos de conferência."""
import gzip
import hashlib
import json
import re
import subprocess
import tempfile
import threading

SCHEMAS = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'"


def psql(banco, sql):
    r = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", banco, "-c", sql],
                       capture_output=True, timeout=180)
    if r.returncode:
        raise RuntimeError("Consulta privada de conferência não concluiu.")
    return r.stdout


def ident(nome):
    return '"' + nome.replace('"', '""') + '"'


def transacao(sql, snapshot=None):
    importar = "SET TRANSACTION SNAPSHOT '" + snapshot + "';" if snapshot else ""
    return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" + importar + "SET LOCAL statement_timeout='180s';" + sql + ";COMMIT;"


def stream(args, consumir):
    # Arquivos/linhas completos não são acumulados em memória nem enviados para logs.
    erros = []
    with tempfile.TemporaryFile() as stderr:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr)

        def copiar():
            try:
                consumir(p.stdout)
            except BaseException as erro:
                erros.append(erro)
                p.kill()

        t = threading.Thread(target=copiar, daemon=True)
        t.start()
        try:
            codigo = p.wait(timeout=600)
            t.join(timeout=10)
            if codigo or t.is_alive() or erros:
                raise RuntimeError("Fluxo privado do backup não concluiu.")
        finally:
            if p.poll() is None:
                p.kill()
                p.wait(timeout=10)
            p.stdout.close()
    return True


def resumo_tabela(banco, schema, tabela, snapshot):
    h, linhas = hashlib.sha256(), 0
    qualificado = ident(schema) + "." + ident(tabela)
    sql = "COPY (SELECT to_jsonb(t)::text FROM ONLY " + qualificado + " t ORDER BY to_jsonb(t)::text COLLATE \"C\") TO STDOUT"

    def ler(origem):
        nonlocal linhas
        while bloco := origem.read(64 * 1024):
            h.update(bloco)
            linhas += bloco.count(b"\n")

    stream(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", banco, "-c", transacao(sql, snapshot)], ler)
    return {"linhas": linhas, "sha256": h.hexdigest()}


def json_sql(banco, sql, snapshot):
    return json.loads(psql(banco, transacao(sql, snapshot)))


def capturar(banco, snapshot=None):
    tabelas = json_sql(banco, "SELECT coalesce(json_agg(json_build_array(n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]') "
                        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + SCHEMAS + " AND c.relkind IN ('r','p','m')", snapshot)
    consultas = {
        "colunas": "SELECT n.nspname||'.'||c.relname||'.'||a.attname AS chave,format_type(a.atttypid,a.atttypmod) AS tipo,"
                   "a.attnotnull AS obrigatoria,a.attidentity AS identidade,a.attgenerated AS gerada,"
                   "pg_get_expr(d.adbin,d.adrelid) AS padrao FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "
                   "JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum "
                   "WHERE " + SCHEMAS + " AND c.relkind IN ('r','p','m') AND a.attnum>0 AND NOT a.attisdropped",
        "constraints": "SELECT n.nspname||'.'||c.relname||'.'||r.conname AS chave,r.contype AS tipo,r.convalidated AS validada,"
                       "pg_get_constraintdef(r.oid,true) AS definicao FROM pg_constraint r JOIN pg_class c ON c.oid=r.conrelid "
                       "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + SCHEMAS,
        "indices": "SELECT schemaname||'.'||tablename||'.'||indexname AS chave,indexdef AS definicao FROM pg_indexes WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema'",
        "triggers": "SELECT n.nspname||'.'||c.relname||'.'||t.tgname AS chave,t.tgenabled AS habilitado,pg_get_triggerdef(t.oid,true) AS definicao "
                    "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + SCHEMAS + " AND NOT t.tgisinternal",
        "funcoes": "SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS chave,pg_get_functiondef(p.oid) AS definicao "
                   "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE " + SCHEMAS + " AND p.prokind IN ('f','p')",
        "sequencias": "SELECT schemaname||'.'||sequencename AS chave,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size "
                      "FROM pg_sequences WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema'",
        # pg_dump pode renumerar OIDs/enumsortorder; só a sequência semântica dos labels é persistida.
        "enums": "SELECT n.nspname||'.'||t.typname AS chave,coalesce(json_agg(e.enumlabel ORDER BY e.enumsortorder) "
                 "FILTER (WHERE e.enumlabel IS NOT NULL),'[]') AS labels FROM pg_type t "
                 "JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_enum e ON e.enumtypid=t.oid "
                 "WHERE " + SCHEMAS + " AND t.typtype='e' GROUP BY n.nspname,t.typname",
        "privilegios": "SELECT n.nspname||'.'||c.relname AS chave,pg_get_userbyid(c.relowner) AS dono,c.relacl::text AS acl,c.relrowsecurity AS rls "
                       "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + SCHEMAS + " AND c.relkind IN ('r','p','m','S')",
    }
    estrutura = {}
    for nome, sql in consultas.items():
        estrutura[nome] = json_sql(banco, "SELECT coalesce(json_agg(r ORDER BY chave),'[]') FROM (" + sql + ") r", snapshot)
    return {"tabelas": {schema + "." + tabela: resumo_tabela(banco, schema, tabela, snapshot) for schema, tabela in tabelas}, "estrutura": estrutura}


def check_canonico(definicao):
    # Reconhece somente CHECKs booleanos simples. Outras diferenças falham fechadas.
    if not definicao.startswith("CHECK ("):
        raise ValueError("Expressão não suportada.")
    texto = definicao[6:]
    tokens = re.findall(r'"(?:""|[^"])*"|>=|<=|<>|!=|[()=<>]|-?\d+|[A-Za-z_][A-Za-z_0-9]*', texto)
    if "".join(tokens) != re.sub(r"\s", "", texto):
        raise ValueError("Tokens não suportados.")
    pos = 0

    def combinar(op, a, b):
        return (op, (a[1] if a[0] == op else [a]) + (b[1] if b[0] == op else [b]))

    def fator():
        nonlocal pos
        if pos < len(tokens) and tokens[pos] == "(":
            pos += 1
            n = ou()
            if pos >= len(tokens) or tokens[pos] != ")":
                raise ValueError("Parêntese inválido.")
            pos += 1
            return n
        folha = []
        while pos < len(tokens) and tokens[pos] not in {"AND", "OR", ")"}:
            folha.append(tokens[pos])
            pos += 1
        if not folha or "(" in folha:
            raise ValueError("Folha não suportada.")
        return ("folha", " ".join(folha))

    def conjuncao():
        nonlocal pos
        a = fator()
        while pos < len(tokens) and tokens[pos] == "AND":
            pos += 1
            a = combinar("AND", a, fator())
        return a

    def ou():
        nonlocal pos
        a = conjuncao()
        while pos < len(tokens) and tokens[pos] == "OR":
            pos += 1
            a = combinar("OR", a, conjuncao())
        return a

    resultado = ou()
    if pos != len(tokens):
        raise ValueError("Conteúdo restante.")
    return resultado


def comparar(antes, depois):
    if antes["tabelas"] != depois["tabelas"]:
        raise RuntimeError("Linhas ou hash de tabela divergentes do snapshot do dump.")
    if antes["estrutura"].keys() != depois["estrutura"].keys():
        raise RuntimeError("Estrutura, privilégios ou proteção do banco divergentes.")
    for grupo, linhas in antes["estrutura"].items():
        outras = depois["estrutura"].get(grupo)
        if linhas == outras:
            continue
        if grupo != "constraints" or outras is None or len(linhas) != len(outras):
            raise RuntimeError("Estrutura, privilégios ou proteção do banco divergentes.")
        for a, b in zip(linhas, outras):
            sem_def = lambda r: {k: v for k, v in r.items() if k != "definicao"}
            try:
                iguais = sem_def(a) == sem_def(b) and (a["definicao"] == b["definicao"] or check_canonico(a["definicao"]) == check_canonico(b["definicao"]))
            except ValueError:
                iguais = False
            if not iguais:
                raise RuntimeError("Restrição restaurada não equivale à referência.")


def sequencias_do_dump(dump):
    """Lê somente os blocos SEQUENCE SET do pg_dump 16; nunca compara ao estado vivo não transacional."""
    estados, aguardando, em_copia = {}, False, False
    padrao = re.compile(r"SELECT pg_catalog\.setval\('((?:[^']|'')*)', (-?\d+), (true|false)\);")
    with gzip.open(dump, "rt", encoding="utf8") as arquivo:
        for linha in arquivo:
            texto = linha.strip()
            if em_copia:
                if linha.rstrip("\r\n") == r"\.":
                    em_copia = False
                continue
            if texto.startswith("COPY ") and texto.endswith(" FROM stdin;"):
                em_copia = True
                continue
            if texto.startswith("-- Name: ") and "; Type: SEQUENCE SET; Schema: " in texto:
                if aguardando:
                    raise RuntimeError("Estado de sequência do dump não suportado ou incompleto.")
                aguardando = True
                continue
            if not aguardando or not texto or texto.startswith("--"):
                continue
            m = padrao.fullmatch(texto)
            if not m:
                raise RuntimeError("Estado de sequência do dump não suportado ou incompleto.")
            nome, valor, chamada = m.groups()
            nome = nome.replace("''", "'")
            if nome in estados:
                raise RuntimeError("Estado de sequência do dump não suportado ou incompleto.")
            estados[nome] = {"valor": str(int(valor)), "chamada": chamada == "true"}
            aguardando = False
    if aguardando or em_copia:
        raise RuntimeError("Estado de sequência do dump não suportado ou incompleto.")
    return estados


def conferir_sequencias(banco, dump, definicoes):
    estados, conferidas = sequencias_do_dump(dump), set()
    esperadas = {d["chave"] for d in definicoes}
    for regclass, esperado in estados.items():
        # Hexadecimal evita depender de standard_conforming_strings do destino.
        literal = "convert_from(decode('" + regclass.encode("utf8").hex() + "','hex'),'UTF8')"
        nome = json.loads(psql(banco, "SELECT json_build_array(n.nspname,c.relname) FROM pg_class c "
                              "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND c.oid=" + literal + "::regclass"))
        if not isinstance(nome, list) or len(nome) != 2 or not all(isinstance(n, str) for n in nome):
            raise RuntimeError("Sequências restauradas não correspondem ao dump.")
        chave = nome[0] + "." + nome[1]
        if chave not in esperadas or chave in conferidas:
            raise RuntimeError("Sequências restauradas não correspondem ao dump.")
        atual = json.loads(psql(banco, "SELECT json_build_object('valor',last_value::text,'chamada',is_called) FROM " + ident(nome[0]) + "." + ident(nome[1])))
        if atual != esperado:
            raise RuntimeError("Estado de sequência restaurada diverge do dump.")
        conferidas.add(chave)
    if conferidas != esperadas:
        raise RuntimeError("Sequências restauradas não correspondem ao dump.")
    return len(conferidas)


def sql_prova_auditoria():
    """A sonda é compartilhada com o harness local, que aplica sua própria guarda fixa de conexão."""
    comandos = ["UPDATE public.auditoria SET acao='prova' WHERE id='__backup_probe__'", "DELETE FROM public.auditoria WHERE id='__backup_probe__'", "TRUNCATE public.auditoria"]
    testes = []
    for comando in comandos:
        testes.append("BEGIN " + comando + ";RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='Imutabilidade não comprovada';"
                      "EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'A auditoria não pode ser alterada nem apagada.' THEN RAISE; END IF; END;")
    return "BEGIN;INSERT INTO public.auditoria(id,acao,entidade,\"entidadeId\") VALUES ('__backup_probe__','prova','backup','prova');DO $prova$ BEGIN " + "".join(testes) + " END $prova$;ROLLBACK;"


def testar_auditoria(banco):
    if not re.fullmatch(r"barberos_teste_[a-zA-Z0-9_]+|barberos_restaurado", banco):
        raise RuntimeError("Prova de escrita permitida somente no banco isolado.")
    psql(banco, sql_prova_auditoria())
