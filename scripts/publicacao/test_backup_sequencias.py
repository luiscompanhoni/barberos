import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("conferencia_sequencias", Path(__file__).resolve().parents[2] / "deploy/backup-conferencia.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class SequenciasBackupTest(unittest.TestCase):
    def dump(self, sql):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        destino = Path(pasta.name) / "fixture.sql.gz"
        destino.write_bytes(gzip.compress(sql.encode("utf8")))
        return destino

    def bloco(self, valor="2", chamada="true", nome="public.fixture_id_seq"):
        return "--\n-- Name: fixture_id_seq; Type: SEQUENCE SET; Schema: public; Owner: fixture\n--\n\nSELECT pg_catalog.setval('" + nome + "', " + valor + ", " + chamada + ");\n"

    def test_le_estado_do_dump_sem_float_e_preserva_is_called_false(self):
        p = self.dump(self.bloco("9223372036854775807", "false"))
        self.assertEqual(c.sequencias_do_dump(p), {"public.fixture_id_seq": {"valor": "9223372036854775807", "chamada": False}})

    def test_formato_desconhecido_duplicado_ou_truncado_falha_fechado(self):
        for sql in (self.bloco() + self.bloco(), self.bloco().replace("setval", "nextval"), self.bloco().split("SELECT")[0]):
            with self.subTest(sql=sql), self.assertRaisesRegex(RuntimeError, "não suportado"):
                c.sequencias_do_dump(self.dump(sql))

    def test_conteudo_copy_que_parece_bloco_sql_nao_vira_estado_de_sequencia(self):
        sql = "COPY public.fixture (valor) FROM stdin;\n" + self.bloco(nome="public.falso") + "\\.\n" + self.bloco()
        self.assertEqual(c.sequencias_do_dump(self.dump(sql)), {"public.fixture_id_seq": {"valor": "2", "chamada": True}})
        with self.assertRaisesRegex(RuntimeError, "não suportado"):
            c.sequencias_do_dump(self.dump("COPY public.fixture (valor) FROM stdin;\ntruncado\n"))

    def test_compara_apenas_restaurado_com_setval_do_dump_e_detecta_valor_ou_chamada(self):
        p = self.dump(self.bloco())
        definicoes = [{"chave": "public.fixture_id_seq"}]
        for valor in ({"valor": "1", "chamada": True}, {"valor": "2", "chamada": False}):
            with self.subTest(valor=valor), patch.object(c, "psql", side_effect=[b'["public","fixture_id_seq"]', json.dumps(valor).encode()]) as psql:
                with self.assertRaisesRegex(RuntimeError, "diverge do dump"):
                    c.conferir_sequencias("barberos_teste_fixture", p, definicoes)
                self.assertTrue(all(call.args[0] == "barberos_teste_fixture" and call.args[1].startswith("SELECT ") for call in psql.call_args_list))
        with patch.object(c, "psql", side_effect=[b'["public","fixture_id_seq"]', b'{"valor":"2","chamada":true}']):
            self.assertEqual(c.conferir_sequencias("barberos_teste_fixture", p, definicoes), 1)

    def test_estado_ausente_a_mais_ou_sem_definicao_nao_e_aceito(self):
        with self.assertRaisesRegex(RuntimeError, "não correspondem"):
            c.conferir_sequencias("barberos_teste_fixture", self.dump("-- sem sequência\n"), [{"chave": "public.fixture_id_seq"}])
        with patch.object(c, "psql", return_value=b'["public","fixture_id_seq"]'), self.assertRaisesRegex(RuntimeError, "não correspondem"):
            c.conferir_sequencias("barberos_teste_fixture", self.dump(self.bloco()), [])

    def test_nome_escapado_permanece_identificador_sem_injetar_sql(self):
        p = self.dump(self.bloco(nome='public."fixture\'\'especial"'))
        with patch.object(c, "psql", side_effect=[b'["public","fixture\'especial"]', b'{"valor":"2","chamada":true}']) as psql:
            self.assertEqual(c.conferir_sequencias("barberos_teste_fixture", p, [{"chave": "public.fixture'especial"}]), 1)
        self.assertIn("convert_from(decode('" + 'public."fixture\'especial"'.encode("utf8").hex() + "','hex'),'UTF8')::regclass", psql.call_args_list[0].args[1])
        self.assertTrue(psql.call_args_list[1].args[1].endswith('FROM "public"."fixture\'especial"'))


if __name__ == "__main__":
    unittest.main()
