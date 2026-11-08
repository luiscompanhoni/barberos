import contextlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import deploy_vps as deploy
from deploy_vps_comum import CONTROLES_PUBLICACAO


class RecuperacaoTest(unittest.TestCase):
    def test_quarentena_impede_publicacao_antes_de_tocar_na_instalacao(self):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as pilha:
            base = Path(d)
            commit = "a" * 40
            codigo = base / "releases" / commit / "barberos"
            codigo.mkdir(parents=True)
            (base / ".env").write_text("sentinela-privada")
            ativo = {"Config": {"Env": ["BARBEROS_QUARENTENA_RESTAURACAO=true"]}}
            pilha.enter_context(patch.object(deploy.os, "geteuid", return_value=0, create=True))
            pilha.enter_context(patch.object(deploy, "conferir_pacote", return_value=codigo))
            pilha.enter_context(patch.object(deploy, "container", return_value=ativo))
            executar = pilha.enter_context(patch.object(deploy, "executar"))
            with self.assertRaisesRegex(RuntimeError, "quarentena"):
                deploy.publicar(base, "barberos", commit, "sha256:" + "b" * 64)
            executar.assert_not_called()
            self.assertFalse((codigo.parent / "operacao.json").exists())

    def executar_cenario(self, falha, backup_sem_imagem=False, com_migracao=False):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as pilha:
            base = Path(d)
            commit = "a" * 40
            codigo = base / "releases" / commit / "barberos"
            (codigo / "deploy").mkdir(parents=True)
            (base / "deploy").mkdir()
            (base / "deploy/docker-compose.yml").write_text("original")
            (base / ".env").write_text("sentinela-privada")
            antigo = {"Id": "app", "Image": "sha256:" + "b" * 64,
                      "Config": {"Env": ["DATABASE_URL=sentinela-db", "MAQUININHA=manual"], "Labels": {"com.docker.compose.project.config_files": str(base / "deploy/docker-compose.yml")}},
                      "State": {"Status": "running", "Health": {"Status": "healthy"}}, "NetworkSettings": {"Networks": {"barberos_default": {}}}}
            novo = {**antigo, "Image": "sha256:" + "c" * 64, "Config": {"Env": ["MAQUININHA=" + ("stone" if falha == "stone" else "manual")]}}
            recuperado = {**antigo, "Config": {**antigo["Config"], "Env": [k + "=" + v for k, v in deploy.ambiente_rollback().items()]}}
            chamadas = []

            def comando(args, **_kw):
                chamadas.append(args)
                if falha == "migracao" and "migrate" in args:
                    raise RuntimeError("Falha sintética após iniciar a migração")
                if args[:3] == ["docker", "image", "inspect"]:
                    if backup_sem_imagem and args[-1] == antigo["Image"]:
                        raise RuntimeError("Imagem antiga de backup ausente")
                    return json.dumps([{"Id": novo["Image"], "Config": {"Labels": {"org.opencontainers.image.revision": commit}}}]).encode()
                return b""

            def simular(nome, **kw):
                return pilha.enter_context(patch.object(deploy, nome, **kw))

            pilha.enter_context(patch.object(deploy.os, "geteuid", return_value=0, create=True))
            pilha.enter_context(patch.object(deploy.shutil, "disk_usage", return_value=SimpleNamespace(free=12 * 1024**3)))
            if sys.platform == "win32":
                pilha.enter_context(patch.object(Path, "symlink_to"))  # symlink real da VPS depende de Linux
            simular("memoria_disponivel_kib", return_value=3200 * 1024)
            simular("conferir_pacote", return_value=codigo)
            simular("container", side_effect=[antigo, antigo, antigo, novo])
            simular("executar", side_effect=comando)
            simular("migracoes", return_value=[])
            simular("conferir_migracoes", side_effect=[["20261104224500_versao_sessao"] if com_migracao else [], []])
            simular("consultar_banco", return_value="1")
            simular("aguardar_saude", side_effect=[antigo, recuperado] if falha in ("backup", "agenda_pre_migracao") else [antigo, novo, recuperado])
            simular("conferir_capacidade", return_value={"estimativaConservadora": True, "volumePostgres": "pg-ficticio"})
            simular("exigir_banco_isolavel")
            parar = simular("parar_escritores", return_value=[{"id": "caddy", "servico": "caddy"}])
            simular("retomar_auxiliares")
            agenda = simular("exigir_agenda_equipe", return_value=True)
            pix = simular("exigir_contrato_pix_imagem", return_value=True)
            simular("conferir_central_desligada", return_value={"habilitada": True, "execucaoAtiva": False, "metaTokenConfigurado": False})
            ensaio = simular("ensaiar_schema")
            backup = simular("backup_verificado", return_value={"arquivo": "/backup/fixture.sql.gz", "restaurado": True})
            https = simular("conferir_https")
            if falha in ("agenda_antes", "pix"):
                (agenda if falha == "agenda_antes" else pix).side_effect = RuntimeError("Controle recusado")
                with self.assertRaisesRegex(RuntimeError, "Controle recusado"):
                    deploy.publicar(base, "barberos", commit, antigo["Image"])
                backup.assert_not_called()
                self.assertFalse((codigo.parent / "operacao.json").exists())
                self.assertFalse(any("tag" in a or "up" in a or "migrate" in a for a in chamadas))
                return
            if falha in ("agenda_pre_migracao", "agenda_saude", "agenda_final"):
                consultas_anteriores = {"agenda_pre_migracao": 1, "agenda_saude": 2, "agenda_final": 3}
                agenda.side_effect = [True] * consultas_anteriores[falha] + [RuntimeError("Agenda alterada")]
            elif falha == "backup":
                backup.side_effect = RuntimeError("Backup recusado")
            elif falha == "https":
                https.side_effect = RuntimeError("Revisão HTTPS divergente")
            if falha:
                with self.assertRaisesRegex(RuntimeError, "interrompida"):
                    deploy.publicar(base, "barberos", commit, antigo["Image"])
            else:
                resultado = deploy.publicar(base, "barberos", commit, antigo["Image"])
                self.assertTrue(resultado["concluido"])
            registro = json.loads((codigo.parent / "operacao.json").read_text())
            self.assertFalse((codigo.parent / "backup.env").exists())
            self.assertEqual((base / ".env").read_text(), "sentinela-privada")
            self.assertEqual((base / "deploy/docker-compose.yml").read_text(), "original")
            if falha == "backup":
                self.assertFalse(ensaio.called)
                self.assertFalse(any("migrate" in a for a in chamadas))
                self.assertTrue(registro["rollback"])
                self.assertEqual(registro["etapaFalha"], "backup_e_restauracao")
            elif falha == "agenda_pre_migracao":
                self.assertTrue(ensaio.called)
                self.assertFalse(any("migrate" in a for a in chamadas))
                self.assertTrue(registro["rollback"])
            elif com_migracao and falha:
                self.assertTrue(registro["recuperacaoManualObrigatoria"])
                self.assertIsNone(registro["rollback"])
                self.assertFalse((codigo.parent / "rollback.json").exists())
                marcador = json.loads((base / deploy.MARCADOR).read_text())
                self.assertTrue(marcador["migrouOuIniciouMigracao"])
                self.assertTrue(marcador["escritoresParados"])
                self.assertGreaterEqual(parar.call_count, 2)
            elif falha in ("https", "agenda_saude", "agenda_final", "stone"):
                self.assertTrue(registro["rollback"])
                self.assertEqual(registro["etapaFalha"], "backup_apos_migracao" if falha == "agenda_final" else "troca_aplicacao")
                rollback = json.loads((codigo.parent / "rollback.json").read_text())
                self.assertEqual(rollback["services"]["app"]["image"], antigo["Image"])
                self.assertEqual(rollback["services"]["app"]["command"], ["node", "server.js"])
                self.assertEqual(rollback["services"]["app"]["environment"]["MAQUININHA"], "manual")
                self.assertEqual(rollback["services"]["app"]["environment"], deploy.ambiente_rollback())
                self.assertGreaterEqual(parar.call_count, 2)
            else:
                self.assertTrue(ensaio.called)
                self.assertEqual(backup.call_count, 2)
                self.assertTrue(registro["concluido"])
                self.assertTrue((base / "versao-ativa.json").is_file())
                self.assertFalse((base / deploy.MARCADOR).exists())
                self.assertEqual(resultado["rollbackAutomaticoPermitido"], not com_migracao)
                self.assertEqual(registro["backupAnteriorPreservado"], not backup_sem_imagem)
                override = json.loads((codigo / "deploy/versao.json").read_text())
                self.assertEqual(override["services"]["app"]["environment"], CONTROLES_PUBLICACAO)
                self.assertFalse(registro["centralAgentes"]["execucaoAtiva"])
                self.assertTrue(registro["agendaEquipeAntes"])
                self.assertEqual(agenda.call_count, 4)
                pix.assert_called_once_with(novo["Image"])
                self.assertEqual(registro["controlesCliente"], {"agendaEquipeBanco": True, "stoneManualContainer": True,
                                "modoMaquininhaContainer": "manual", "lotePixContratoBloqueadoNaImagem": True})
                self.assertEqual(resultado["controlesCliente"], registro["controlesCliente"])

    def test_falha_backup_bloqueia_migracao_e_troca(self):
        self.executar_cenario("backup")

    def test_falha_https_retorna_imagem_sem_restaurar_banco(self):
        self.executar_cenario("https")

    def test_falha_apos_iniciar_migracao_mantem_isolamento_sem_rollback_de_dados(self):
        for falha in ("migracao", "https"):
            with self.subTest(falha=falha):
                self.executar_cenario(falha, com_migracao=True)

    def test_sucesso_migrado_remove_marcador_so_apos_controles_e_backup(self):
        self.executar_cenario(None, com_migracao=True)

    def test_sucesso_exige_ensaio_e_backups_antes_e_depois(self):
        self.executar_cenario(None)

    def test_backup_legado_sem_imagem_so_e_substituido_apos_restauracao_nova(self):
        self.executar_cenario(None, backup_sem_imagem=True)

    def test_cancelamento_quando_agenda_ou_contrato_pix_falham_no_preflight(self):
        for falha in ("agenda_antes", "pix"):
            with self.subTest(falha= falha):
                self.executar_cenario(falha)

    def test_mudanca_da_agenda_e_stone_recusam_conclusao(self):
        for falha in ("agenda_pre_migracao", "agenda_saude", "agenda_final", "stone"):
            with self.subTest(falha=falha):
                self.executar_cenario(falha)

    def test_reutilizar_publicacao_reconfere_controles_atuais(self):
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as pilha:
            base = Path(d)
            pasta = base / "releases" / commit
            pasta.mkdir(parents=True)
            (base / ".env").write_text("fixture")
            (pasta / "operacao.json").write_text(json.dumps({"concluido": True, "imagemNova": "imagem-teste"}))
            pilha.enter_context(patch.object(deploy.os, "geteuid", return_value=0, create=True))
            pilha.enter_context(patch.object(deploy, "conferir_pacote", return_value=pasta / "barberos"))
            app = {"Image": "imagem-teste", "Config": {"Env": [k + "=" + v for k, v in CONTROLES_PUBLICACAO.items()]}}
            pilha.enter_context(patch.object(deploy, "aguardar_saude", return_value=app))
            pilha.enter_context(patch.object(deploy, "container", return_value={"Id": "db"}))
            pilha.enter_context(patch.object(deploy, "conferir_https"))
            pix = pilha.enter_context(patch.object(deploy, "exigir_contrato_pix_imagem"))
            agenda = pilha.enter_context(patch.object(deploy, "exigir_agenda_equipe", return_value=True))
            r = deploy.publicar(base, "barberos", commit, "imagem-anterior")
            self.assertTrue(r["reutilizado"] and r["controlesCliente"]["agendaEquipeBanco"])
            pix.assert_called_once_with("imagem-teste")
            agenda.side_effect = RuntimeError("Agenda alterada")
            with self.assertRaisesRegex(RuntimeError, "Agenda alterada"):
                deploy.publicar(base, "barberos", commit, "imagem-anterior")
            pix.assert_called_once()

if __name__ == "__main__":
    unittest.main()

