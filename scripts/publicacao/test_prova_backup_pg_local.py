import copy
import importlib.util
import os
from pathlib import Path
import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("prova_pg_local", Path(__file__).with_name("provar_backup_pg_local.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProvaPgLocalTest(unittest.TestCase):
    def test_sql_nao_aceita_alvo_fora_dos_dois_bancos_e_catalogo(self):
        with patch.object(m, "executar") as executar, self.assertRaises(RuntimeError):
            m.sql("barberos_producao", "SELECT 1")
        executar.assert_not_called()

    def test_sql_com_acentos_vai_como_utf8_no_stdin_sem_sql_no_argv(self):
        texto = "SELECT 'Fictício e proteção';"
        with patch.object(m, "executar", return_value=b"") as executar:
            m.sql(m.FONTE, texto)
        self.assertEqual(executar.call_args.args[1][-2:], ["-f", "-"])
        self.assertNotIn("-c", executar.call_args.args[1])
        self.assertNotIn(texto, executar.call_args.args[1])
        self.assertEqual(executar.call_args.kwargs["input"], texto.encode("utf-8"))

    def test_conexao_usa_host_porta_usuario_fixos_sem_uri_herdada(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://nao-usar/nao-usar", "PGSERVICE": "nao-usar", "PGOPTIONS": "nao-usar"}), \
             patch.object(Path, "is_file", return_value=True), patch.object(m.shutil, "which", return_value=str(m.PG / "psql.exe")), \
             patch.object(m, "sql", return_value=b"auditoria_teste|127.0.0.1|55439\n") as sql:
            m.ambiente()
            self.assertEqual((os.environ["PGHOST"], os.environ["PGPORT"], os.environ["PGUSER"]), ("127.0.0.1", "55439", "auditoria_teste"))
            for chave in ("DATABASE_URL", "PGSERVICE", "PGOPTIONS"):
                self.assertNotIn(chave, os.environ)
            self.assertIn("host(inet_server_addr())", sql.call_args.args[1])

    def test_identidade_divergente_impede_fixtures(self):
        with patch.dict(os.environ), patch.object(Path, "is_file", return_value=True), \
             patch.object(m.shutil, "which", return_value=str(m.PG / "psql.exe")), \
             patch.object(m, "sql", return_value=b"outro|127.0.0.1|54128\n"), self.assertRaises(RuntimeError):
            m.ambiente()

    def test_banco_preexistente_fica_preservado(self):
        with patch.object(m, "sql", return_value=m.FONTE.encode()), self.assertRaises(RuntimeError):
            m.conferir_destino_vazio()

    def test_limpeza_recusa_nome_ou_marcador_que_nao_pertencem_a_execucao(self):
        with patch.object(m, "sql") as sql, self.assertRaises(RuntimeError):
            m.limpar_criados(["barberos"], m.MARCADOR + "fixture")
        sql.assert_not_called()
        with patch.object(m, "sql", return_value=b"auditoria_teste|outro-marcador") as sql, self.assertRaises(RuntimeError):
            m.limpar_criados([m.RESTAURADO], m.MARCADOR + "fixture")
        self.assertEqual(sql.call_count, 1)

    def test_limpeza_confere_propriedade_e_nao_usa_force(self):
        marcador = m.MARCADOR + "fixture"
        with patch.object(m, "sql", side_effect=[("auditoria_teste|" + marcador).encode(), b""]) as sql:
            m.limpar_criados([m.RESTAURADO], marcador)
        self.assertIn("shobj_description", sql.call_args_list[0].args[1])
        self.assertEqual(sql.call_args.args[1], 'DROP DATABASE "' + m.RESTAURADO + '"')

    def test_saida_fora_das_evidencias_para_antes_de_conectar(self):
        args = ["prova", "--executar-fixtures-locais", "--saida", str(m.REPO / "fora-das-evidencias")]
        with patch("sys.argv", args), patch.object(m, "ambiente") as ambiente, self.assertRaises(RuntimeError):
            m.main()
        ambiente.assert_not_called()

    def test_diagnostico_nao_expoe_erro_sql_ou_comando_desconhecido(self):
        for erro in (RuntimeError("SELECT dado_privado; senha-injetada"), subprocess.TimeoutExpired("comando_privado", 5)):
            d = json.dumps(m.diagnostico_seguro(erro))
            self.assertNotIn("dado_privado", d)
            self.assertNotIn("senha-injetada", d)
            self.assertNotIn("comando_privado", d)
        retorno = SimpleNamespace(returncode=1, stderr=b"ERROR: 42501: SELECT segredo_fixture", stdout=b"")
        with patch.object(m.subprocess, "run", return_value=retorno):
            with self.assertRaises(m.FalhaProva) as erro:
                m.executar("psql", [])
        d = m.diagnostico_seguro(erro.exception)
        self.assertEqual(d["controle"]["sqlstate"], "42501")
        self.assertNotIn("segredo_fixture", json.dumps(d))


class EnumsBackupTest(unittest.TestCase):
    def setUp(self):
        self.c = m.carregar_comparador()
        self.referencia = {"tabelas": {"public.pote_config": {"linhas": 0, "sha256": "vazio"}},
                           "estrutura": {"enums": [{"chave": "public.ArredondamentoPote", "labels": ["LEGADO", "MAIORES_RESTOS_V1"]}]}}

    def test_captura_labels_em_ordem_semantica_inclusive_enum_vazio_sem_persistir_oids(self):
        def ler(_banco, consulta, _snapshot):
            if "FROM pg_type t" in consulta:
                return [{"chave": "public.EnumVazio", "labels": []}]
            return []
        snapshot = "00000001-00000002-1"
        with patch.object(self.c, "json_sql", side_effect=ler) as json_sql:
            capturado = self.c.capturar(m.RESTAURADO, snapshot)
        self.assertEqual(capturado["estrutura"]["enums"], [{"chave": "public.EnumVazio", "labels": []}])
        consulta = next(call.args[1] for call in json_sql.call_args_list if "FROM pg_type t" in call.args[1])
        self.assertIn("json_agg(e.enumlabel ORDER BY e.enumsortorder)", consulta)
        self.assertIn("LEFT JOIN pg_enum", consulta)
        self.assertIn("t.typtype='e'", consulta)
        self.assertIn("FILTER (WHERE e.enumlabel IS NOT NULL)", consulta)
        self.assertTrue(all(call.args[2] == snapshot for call in json_sql.call_args_list))
        self.assertNotIn("oid", json.dumps(capturado))
        self.assertNotIn("enumsortorder", json.dumps(capturado))

    def test_label_nao_default_renomeado_ordem_tipo_ou_labels_ausentes_falham_com_tabela_vazia(self):
        alteracoes = [
            [{"chave": "public.ArredondamentoPote", "labels": ["LEGADO", "ALTERADO"]}],
            [{"chave": "public.ArredondamentoPote", "labels": ["MAIORES_RESTOS_V1", "LEGADO"]}],
            [{"chave": "outro.ArredondamentoPote", "labels": ["LEGADO", "MAIORES_RESTOS_V1"]}],
            [{"chave": "public.ArredondamentoPote", "labels": []}], [],
        ]
        self.c.comparar(self.referencia, copy.deepcopy(self.referencia))
        for enums in alteracoes:
            depois = copy.deepcopy(self.referencia)
            depois["estrutura"]["enums"] = enums
            with self.subTest(enums=enums), self.assertRaisesRegex(RuntimeError, "Estrutura"):
                self.c.comparar(self.referencia, depois)

    def test_manifesto_antigo_sem_grupo_enums_nao_e_aceito_como_validacao_completa(self):
        antigo = copy.deepcopy(self.referencia)
        antigo["estrutura"].pop("enums")
        for antes, depois in ((antigo, self.referencia), (self.referencia, antigo)):
            with self.subTest(antes=antes), self.assertRaisesRegex(RuntimeError, "Estrutura"):
                self.c.comparar(antes, depois)

    def test_negativo_enum_mexe_so_no_restaurado_e_reverte_antes_da_ultima_comparacao(self):
        alterado = copy.deepcopy(self.referencia)
        alterado["estrutura"]["enums"][0]["labels"][1] = "__PROVA_ENUM_ALTERADO__"
        comparar = Mock(wraps=self.c.comparar)
        c = SimpleNamespace(capturar=Mock(side_effect=[alterado, self.referencia]), comparar=comparar)
        with patch.object(m, "sql", return_value=b"") as sql:
            self.assertTrue(m.provar_enum_alterado(self.referencia, c))
        self.assertEqual([call.args[0] for call in sql.call_args_list], [m.RESTAURADO, m.RESTAURADO])
        self.assertIn("RENAME VALUE 'MAIORES_RESTOS_V1' TO '__PROVA_ENUM_ALTERADO__'", sql.call_args_list[0].args[1])
        self.assertIn("RENAME VALUE '__PROVA_ENUM_ALTERADO__' TO 'MAIORES_RESTOS_V1'", sql.call_args_list[1].args[1])
        self.assertNotIn("LEGADO", " ".join(call.args[1] for call in sql.call_args_list))
        comparar.assert_called_with(self.referencia, self.referencia)

    def test_negativo_nao_rejeitado_falha_e_mesmo_assim_reverte_o_label(self):
        c = SimpleNamespace(capturar=Mock(return_value=self.referencia), comparar=Mock())
        with patch.object(m, "sql", return_value=b"") as sql, self.assertRaises(m.FalhaProva) as erro:
            m.provar_enum_alterado(self.referencia, c)
        self.assertEqual(erro.exception.codigo, "NEGATIVO_NAO_REJEITADO")
        self.assertEqual(sql.call_count, 2)
        self.assertIn("TO 'MAIORES_RESTOS_V1'", sql.call_args.args[1])
        self.assertEqual(c.comparar.call_count, 2)

    def test_fixture_enum_com_linhas_recusa_sonda_sem_qualquer_escrita(self):
        referencia = copy.deepcopy(self.referencia)
        referencia["tabelas"]["public.pote_config"]["linhas"] = 1
        with patch.object(m, "sql") as sql, self.assertRaises(m.FalhaProva) as erro:
            m.provar_enum_alterado(referencia, self.c)
        self.assertEqual(erro.exception.codigo, "FIXTURE_ENUM_NAO_VAZIA")
        sql.assert_not_called()


if __name__ == "__main__":
    unittest.main()
