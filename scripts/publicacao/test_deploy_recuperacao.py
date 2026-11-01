import contextlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import deploy_vps as deploy


class RecuperacaoTest(unittest.TestCase):
    def executar_cenario(self, falha, backup_sem_imagem=False):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as pilha:
            base = Path(d)
            commit = "a" * 40
            codigo = base / "releases" / commit / "barberos"
            (codigo / "deploy").mkdir(parents=True)
            (base / "deploy").mkdir()
            (base / "deploy/docker-compose.yml").write_text("original")
            (base / ".env").write_text("sentinela-privada")
            antigo = {"Id": "app", "Image": "sha256:" + "b" * 64,
                      "Config": {"Env": ["DATABASE_URL=sentinela-db"], "Labels": {"com.docker.compose.project.config_files": str(base / "deploy/docker-compose.yml")}},
                      "State": {"Status": "running", "Health": {"Status": "healthy"}}, "NetworkSettings": {"Networks": {"barberos_default": {}}}}
            chamadas = []

            def comando(args, **_kw):
                chamadas.append(args)
                if args[:3] == ["docker", "image", "inspect"]:
                    if backup_sem_imagem and args[-1] == antigo["Image"]:
                        raise RuntimeError("Imagem antiga de backup ausente")
                    return json.dumps([{"Config": {"Labels": {"org.opencontainers.image.revision": commit}}}]).encode()
                return b""

            def simular(nome, **kw):
                return pilha.enter_context(patch.object(deploy, nome, **kw))

            pilha.enter_context(patch.object(deploy.os, "geteuid", return_value=0))
            simular("conferir_pacote", return_value=codigo)
            simular("container", return_value=antigo)
            simular("executar", side_effect=comando)
            simular("migracoes", return_value=[])
            simular("conferir_migracoes", return_value=[])
            simular("consultar_banco", return_value="1")
            simular("aguardar_saude", return_value=antigo)
            ensaio = simular("ensaiar_schema")
            backup = simular("backup_verificado", return_value={"arquivo": "/backup/fixture.sql.gz", "restaurado": True})
            https = simular("conferir_https")
            if falha == "backup":
                backup.side_effect = RuntimeError("Backup recusado")
            elif falha == "https":
                https.side_effect = RuntimeError("Revisão HTTPS divergente")
            if falha:
                with self.assertRaisesRegex(RuntimeError, "interrompida"):
                    deploy.publicar(base, "barberos", commit, antigo["Image"])
            else:
                self.assertTrue(deploy.publicar(base, "barberos", commit, antigo["Image"])["concluido"])
            registro = json.loads((codigo.parent / "operacao.json").read_text())
            self.assertFalse((codigo.parent / "backup.env").exists())
            self.assertEqual((base / ".env").read_text(), "sentinela-privada")
            self.assertEqual((base / "deploy/docker-compose.yml").read_text(), "original")
            if falha == "backup":
                self.assertFalse(ensaio.called)
                self.assertFalse(any("up" in a or "migrate" in a for a in chamadas))
                self.assertIsNone(registro["rollback"])
                self.assertEqual(registro["etapaFalha"], "backup_e_restauracao")
            elif falha == "https":
                self.assertTrue(registro["rollback"])
                self.assertEqual(registro["etapaFalha"], "troca_aplicacao")
                rollback = json.loads((codigo.parent / "rollback.json").read_text())
                self.assertEqual(rollback["services"]["app"]["image"], antigo["Image"])
                self.assertEqual(rollback["services"]["app"]["command"], ["node", "server.js"])
                self.assertTrue(any("stop" in a and "video-worker" in a for a in chamadas))
            else:
                self.assertTrue(ensaio.called)
                self.assertEqual(backup.call_count, 2)
                self.assertTrue(registro["concluido"])
                self.assertTrue((base / "versao-ativa.json").is_file())
                self.assertEqual(registro["backupAnteriorPreservado"], not backup_sem_imagem)

    def test_falha_backup_bloqueia_migracao_e_troca(self):
        self.executar_cenario("backup")

    def test_falha_https_retorna_imagem_sem_restaurar_banco(self):
        self.executar_cenario("https")

    def test_sucesso_exige_ensaio_e_backups_antes_e_depois(self):
        self.executar_cenario(None)

    def test_backup_legado_sem_imagem_so_e_substituido_apos_restauracao_nova(self):
        self.executar_cenario(None, backup_sem_imagem=True)


if __name__ == "__main__":
    unittest.main()
