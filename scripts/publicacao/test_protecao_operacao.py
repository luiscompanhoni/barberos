import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import protecao_operacao as p
from deploy_vps_comum import CONTROLES_PUBLICACAO, conferir_central_desligada


class ProtecaoOperacaoTest(unittest.TestCase):
    def test_rollback_impoe_todos_bloqueios_independente_da_configuracao_anterior(self):
        env = p.ambiente_rollback()
        self.assertEqual({k: env[k] for k in CONTROLES_PUBLICACAO}, CONTROLES_PUBLICACAO)
        self.assertEqual(env["BARBEROS_QUARENTENA_RESTAURACAO"], "false")
        app = {"Config": {"Env": [k + "=" + v for k, v in env.items()]}}
        self.assertFalse(conferir_central_desligada(app)["execucaoAtiva"])
        for chave in CONTROLES_PUBLICACAO:
            adulterado = {**env, chave: "valor-anterior-inseguro"}
            with self.subTest(chave=chave), self.assertRaises(RuntimeError):
                conferir_central_desligada({"Config": {"Env": [k + "=" + v for k, v in adulterado.items()]}})

    def test_marcador_persistente_impede_repeticao_ate_revisao_humana(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            p.exigir_sem_recuperacao(base)
            p.registrar_quarentena(base, {"etapa": "migracao_iniciada"})
            with self.assertRaises(RuntimeError):
                p.exigir_sem_recuperacao(base)
            self.assertFalse(json.loads((base / p.MARCADOR).read_text())["restaurarBancoAutomaticamente"])

    def test_capacidade_cresce_com_banco_e_com_midias_sem_assumir_compressao(self):
        base = p.calcular_reservas(100, 200)
        banco = p.calcular_reservas(200, 200)
        midia = p.calcular_reservas(100, 400)
        self.assertGreater(banco["backups"], base["backups"])
        self.assertGreater(banco["postgres"], base["postgres"])
        self.assertGreater(midia["backups"], base["backups"])
        for invalido in (-1, 1.2, "100"):
            with self.assertRaises(RuntimeError):
                p.calcular_reservas(invalido, 0)

    def test_isolamento_para_todos_containers_exceto_banco_incluindo_desconhecidos(self):
        def c(id, servico, running=True):
            return {"Id": id, "Config": {"Labels": {"com.docker.compose.service": servico}}, "State": {"Running": running}}
        antes = [c("db-id", "db"), c("app-id", "app"), c("evo-id", "evolution"), c("outro-id", "job-extra"), c("proxy-id", "caddy")]
        depois = [antes[0], *[c(x["Id"], x["Config"]["Labels"]["com.docker.compose.service"], False) for x in antes[1:]]]
        with patch.object(p, "containers_projeto", side_effect=[antes, depois]), patch.object(p, "executar") as executar, patch.object(p, "consultar_banco", return_value="0"):
            parados = p.parar_escritores("barberos", "db-id")
        cmd = executar.call_args.args[0]
        self.assertNotIn("db-id", cmd)
        self.assertTrue({"app-id", "evo-id", "outro-id", "proxy-id"}.issubset(cmd))
        self.assertEqual(len(parados), 4)

    def test_conexao_externa_ou_container_que_nao_parou_bloqueiam_a_migracao(self):
        db = {"Id": "db", "Config": {"Labels": {"com.docker.compose.service": "db"}}, "State": {"Running": True}}
        with patch.object(p, "containers_projeto", return_value=[db]), patch.object(p, "consultar_banco", return_value="1"):
            with self.assertRaisesRegex(RuntimeError, "conexão"):
                p.parar_escritores("b", "db")
        app = {"Id": "app", "Config": {"Labels": {}}, "State": {"Running": True}}
        with patch.object(p, "containers_projeto", return_value=[db, app]), patch.object(p, "executar"):
            with self.assertRaisesRegex(RuntimeError, "ainda ativo"):
                p.parar_escritores("b", "db")

    def test_porta_publica_ou_outro_projeto_na_rede_exigem_isolamento_manual(self):
        banco = {"NetworkSettings": {"Networks": {"barberos_default": {}}, "Ports": {"5432/tcp": [{"HostPort": "5432"}]}}}
        with self.assertRaisesRegex(RuntimeError, "porta"):
            p.exigir_banco_isolavel("barberos", banco)
        banco["NetworkSettings"]["Ports"] = {"5432/tcp": None}
        rede = json.dumps([{"Containers": {"id": {}}}]).encode()
        estrangeiro = json.dumps([{"Config": {"Labels": {"com.docker.compose.project": "outro"}}}]).encode()
        with patch.object(p, "executar", side_effect=[rede, estrangeiro]), self.assertRaisesRegex(RuntimeError, "Outro projeto"):
            p.exigir_banco_isolavel("barberos", banco)


if __name__ == "__main__":
    unittest.main()
