"""
Backend Flask - API proxy para o portal corporativo Apdata.
Fornece endpoints REST consumidos pelo frontend do dashboard.
"""

import logging
import sys
from os import environ
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from requests import post

# Carregar .env do diretório pai (raiz do projeto)
_BASE_DIR = Path(__file__).parent.parent
load_dotenv(_BASE_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ─── Configuração Apdata ───────────────────────────────────────────────────────

_APDATA_URL = "https://portal.apdata.com.br/corporativo/.net/index.ashx/"

_FIX_PAYLOAD: dict = {
    "captcha": "",
    "NTLMLogin": False,
    "loginAuthenticOnserver": True,
    "tenantName": "Apdata",
    "baseURL": "",
    "tsc": "",
    "sessionID": 0,
    "selectedEmployee": 0,
    "selectedCandidate": 0,
    "selectedVacancy": 0,
    "dtFmt": "d/m/Y",
    "tmFmt": "H:i:s",
    "shTmFmt": "H:i",
    "dtTmFmt": "d/m/Y H:i:s",
    "language": 0,
    "idEmployeeLogged": 0,
}

_cookies: dict = {}


def _request(metodo: str, payload: dict) -> dict | None:
    """POST no portal Apdata com params via query string."""
    try:
        resp = post(_APDATA_URL + metodo, params=payload, cookies=_cookies, timeout=120)
        resp.raise_for_status()
        return resp.json() if resp.text else None
    except Exception as e:
        logger.error(f"Erro em {metodo}: {e}")
        return None


def _login() -> bool:
    """Autentica e armazena cookies de sessão."""
    global _cookies

    user = environ.get("APP_USER", "")
    pwd = environ.get("APP_PASS", "")
    if not user or not pwd:
        logger.error("APP_USER / APP_PASS não configurados no .env")
        return False

    payload = {**_FIX_PAYLOAD, "UserName": user, "password": pwd}

    try:
        resp = post(_APDATA_URL + "login", params=payload, timeout=60)
        resp.raise_for_status()
        _cookies = resp.cookies.get_dict()
        _FIX_PAYLOAD["tsc"] = _cookies.get("ts", "")
        # SetPerfil
        _request("SetPerfil", {**_FIX_PAYLOAD, "perfil": 34})
        logger.info("Login realizado com sucesso.")
        return True
    except Exception as e:
        logger.error(f"Falha no login: {e}")
        return False


def _executar_sql(sql: str) -> list | None:
    """Executa query SQL via protocolo ISQLGrid (4 passos)."""
    # Passo 1
    payload = {
        **_FIX_PAYLOAD,
        "sMessage": 1895866383,
        "serverClass": "ISQLGrid",
        "killAfterUse": False,
        "Field_0": sql, "Field_0_TP": "string",
        "Field_1": False, "Field_1_TP": "boolean",
        "Field_2": False, "Field_2_TP": "boolean",
        "Field_3": False, "Field_3_TP": "boolean",
        "Field_4": False, "Field_4_TP": "boolean",
    }
    r = _request("genericTransactionExecute", payload)
    if not r or "hwd" not in r:
        logger.error(f"Passo 1 falhou: {r}")
        return None
    hwd = r["hwd"]

    # Passo 2
    payload = {
        **_FIX_PAYLOAD,
        "sMessage": 1879056385, "hwd": hwd,
        "Field_0": 5, "Field_0_TP": "int",
        "Field_1": "", "Field_1_TP": "string",
        "Field_2": sql, "Field_2_TP": "string",
        "Field_2_AsRec": True,
        "Field_3": False, "Field_3_TP": "boolean",
    }
    _request("genericTransactionExecute", payload)

    # Passo 3
    payload = {
        **_FIX_PAYLOAD,
        "sMessage": 1879056410, "hwd": hwd,
        "Field_0": 90000, "Field_0_TP": "int",
    }
    _request("genericTransactionExecute", payload)

    # Passo 4
    payload = {
        **_FIX_PAYLOAD,
        "sMessage": 1879056391, "rMessage": 1879056402, "hwd": hwd,
        "Field_0": -2, "Field_0_TP": "int",
    }
    r = _request("genericTransactionExecute", payload)
    return r.get("comBuf") if r else None


# ─── SQL Queries ───────────────────────────────────────────────────────────────

SQL_CHAMADOS_EQUIPE = """WITH ChamadosEncerradosPorHFE AS (SELECT HFE.HFE_CdiContratoItemxPessoa AS HFE_Id, COUNT(DISTINCT CHA.CHA_CdiChamada) AS QtdeEncerrados FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON CHA.CHA_CdiChamada = AHX.AHX_CdiChamada JOIN ContratosItensxPessoas HFE ON AHX.AHX_CdiContratoItemxPessoa_At = HFE.HFE_CdiContratoItemxPessoa JOIN EquipesAtendimentos AJG ON AHX.AHX_CdiEquipeAtendimento = AJG.AJG_CdiEquipeAtendimento WHERE CHA.CHA_CdiStatusChamada = 31 AND AHX.AHX_CdiOcorrenciaChamada IN (51,52,59,66,67,85,86,93,158,159,1023,1024,1032) AND CHA.CHA_DtdChamada_Fim >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND CHA.CHA_DtdChamada_Fim < DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)) AND AJG.AJG_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND AJG.AJG_D2sEquipeAtendimento IS NOT NULL AND AJG.AJG_D2sEquipeAtendimento NOT LIKE 'None' GROUP BY HFE.HFE_CdiContratoItemxPessoa ), UltimoChamadoPorHFE AS ( SELECT HFE.HFE_CdiContratoItemxPessoa AS HFE_Id, MAX(AHX.AHX_DtdChamadaOcorrencia_Ini) AS UltimaData FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON CHA.CHA_CdiChamada = AHX.AHX_CdiChamada JOIN ContratosItensxPessoas HFE ON AHX.AHX_CdiContratoItemxPessoa_AtA = HFE.HFE_CdiContratoItemxPessoa WHERE AHX.AHX_CdiOcorrenciaChamada IN (2,100) AND AHX.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND NOT EXISTS (SELECT CHA1.CHA_CdiChamada FROM Chamadas CHA1 INNER JOIN ChamadasOcorrencias AHX1 ON (CHA1.CHA_CdiChamada = AHX1.AHX_CdiChamada) where AHX1.AHX_CdiOcorrenciaChamada IN (2,100) AND CHA1.CHA_CdiChamada = CHA.CHA_CdiChamada AND AHX1.AHX_DtdChamadaOcorrencia_Ini < AHX.AHX_DtdChamadaOcorrencia_Ini AND AHX1.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) ) GROUP BY HFE.HFE_CdiContratoItemxPessoa ), ChamadasAtivasPorContratado AS ( SELECT CHA.CHA_CdiContratoItemxPessoa_AtA AS CON_CdiContratado, PDD.PDD_DssNome AS CON_DssNome, COUNT(*) AS QtdeAtivas FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = CHA.CHA_CdiContratoItemxPessoa_AtA JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE CHA.CHA_CdiStatusChamada <> 31 AND CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) AND SCH.SCH_D1sStatusChamada LIKE 'Apdata%' AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiContratoItemxPessoa_AtA <> 0 GROUP BY CHA.CHA_CdiContratoItemxPessoa_AtA, PDD.PDD_DssNome), Base1 AS ( SELECT CA.CON_DssNome AS PDD_DssNome, CA.QtdeAtivas AS Col2_CountChamadas, 2 AS Col3, ISNULL(CEH.QtdeEncerrados, 0) AS Chamados_Encerrados, CASE WHEN UH.UltimaData IS NULL THEN ' ' WHEN UH.UltimaData < DATEADD(DAY, -30, GETDATE()) THEN ' ' ELSE FORMAT(UH.UltimaData, 'dd/MM/yyyy HH:mm:ss') END AS UltimoChamado, CA.CON_CdiContratado FROM ChamadasAtivasPorContratado CA LEFT JOIN ChamadosEncerradosPorHFE CEH ON CEH.HFE_Id = CA.CON_CdiContratado LEFT JOIN UltimoChamadoPorHFE UH ON UH.HFE_Id = CA.CON_CdiContratado ), Base3 AS (SELECT AJG.AJG_D1sEquipeAtendimento AS PDD_DssNome, COUNT(*) AS Col2_Count, 1 AS Col3_Flag, 0 AS Col4, '' AS Col5 FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN EquipesAtendimentos AJG ON AJG.AJG_CdiEquipeAtendimento = CHA.CHA_CdiEquipeAtendimento_Atual WHERE CHA.CHA_CdiStatusChamada IN ( SELECT SCH_CdiStatusChamada FROM StatusChamadas WHERE (SCH_OplSomenteEquipe = 1 OR SCH_OplEquipeAtendente = 1) AND SCH_CdiStatusChamada NOT IN (64,65,11,12,44,45,31) ) AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) GROUP BY AJG.AJG_D1sEquipeAtendimento) SELECT PDD_DssNome as 'Nome', Col2_CountChamadas as 'Quantidade de Chamados', Chamados_Encerrados as 'Quantidade de Chamados Encerrados', UltimoChamado as 'Ultimo Chamado Novo Recebido', Col3 as 'Ordem' FROM Base1 UNION SELECT PDD_DssNome, Col2_Count, Col4, Col5, Col3_Flag FROM Base3 ORDER BY 5, 2 DESC, 3 DESC, 4 DESC"""

SQL_CHAMADOS_HOJE = """WITH ChamadosNovosHoje AS(SELECT AHX.AHX_CdiContratoItemxPessoa_AtA AS HFE_Id, COUNT(DISTINCT CHA.CHA_CdiChamada) AS QtdeNovos FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON(CHA.CHA_CdiChamada = AHX.AHX_CdiChamada) WHERE(AHX.AHX_CdiOcorrenciaChamada IN (2, 100) AND AHX.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND AHX.AHX_DtdChamadaOcorrencia_Ini >= CAST(GETDATE() AS DATE) AND AHX.AHX_DtdChamadaOcorrencia_Ini < DATEADD(DAY, 1, CAST(GETDATE() AS DATE)) AND NOT EXISTS(SELECT 1 FROM ChamadasOcorrencias AHX1 WHERE(AHX1.AHX_CdiChamada = CHA.CHA_CdiChamada AND AHX1.AHX_CdiOcorrenciaChamada IN (2, 100) AND AHX1.AHX_DtdChamadaOcorrencia_Ini < AHX.AHX_DtdChamadaOcorrencia_Ini AND AHX1.AHX_CdiContratoItemxPessoa_AtA = AHX.AHX_CdiContratoItemxPessoa_AtA AND AHX1.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174)))) GROUP BY AHX.AHX_CdiContratoItemxPessoa_AtA), AtendentesDaEquipe AS(SELECT DISTINCT CHA.CHA_CdiContratoItemxPessoa_AtA AS CON_CdiContratado, PDD.PDD_DssNome AS CON_DssNome FROM Chamadas CHA JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = CHA.CHA_CdiContratoItemxPessoa_AtA JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) AND CHA.CHA_CdiContratoItemxPessoa_AtA <> 0) SELECT LA.CON_DssNome AS 'Atendente', ISNULL(CNH.QtdeNovos, 0) AS 'Chamados Novos Hoje', FORMAT(GETDATE(), 'dd/MM/yyyy') AS 'Data Referencia' FROM AtendentesDaEquipe LA LEFT JOIN ChamadosNovosHoje CNH ON(CNH.HFE_Id = LA.CON_CdiContratado) ORDER BY 2 DESC, 1 ASC"""

SQL_CHAMADOS_ABERTOS = """SELECT Chamadas.CHA_CdiChamada, Chamadas.CHA_DtdChamada, Chamadas.CHA_D1sReferencia, StatusChamadas.SCH_CdiStatusChamada, StatusChamadas.SCH_D1sStatusChamada, StatusChamadas.SCH_OplPendenteCliente, EquipesAtendimentos.AJG_CdiEquipeAtendimento, EquipesAtendimentos.AJG_D1sEquipeAtendimento, ContratosItensxPessoas.HFE_CdiContratoItemxPessoa, PessoasContratos.PDD_DssNome FROM Chamadas Chamadas INNER JOIN StatusChamadas StatusChamadas ON (Chamadas.CHA_CdiStatusChamada = StatusChamadas.SCH_CdiStatusChamada) INNER JOIN EquipesAtendimentos EquipesAtendimentos ON (Chamadas.CHA_CdiEquipeAtendimento_Atual = EquipesAtendimentos.AJG_CdiEquipeAtendimento) INNER JOIN ContratosItensxPessoas ContratosItensxPessoas ON (Chamadas.CHA_CdiContratoItemxPessoa_AtA = ContratosItensxPessoas.HFE_CdiContratoItemxPessoa) INNER JOIN PessoasContratos PessoasContratos ON (ContratosItensxPessoas.HFE_CdiPessoaContrato = PessoasContratos.PDD_CdiPessoaContrato) WHERE (StatusChamadas.SCH_CdiStatusChamada <> 31) AND (StatusChamadas.SCH_OplPendenteCliente = 0)"""


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    """Retorna todos os dados do dashboard em uma única chamada."""
    # Re-login se necessário
    if not _cookies:
        if not _login():
            return jsonify({"error": "Falha no login"}), 500

    # Executar queries
    dados_equipe = _executar_sql(SQL_CHAMADOS_EQUIPE)
    dados_hoje = _executar_sql(SQL_CHAMADOS_HOJE)

    if dados_equipe is None:
        # Tentar re-login e executar novamente
        if _login():
            dados_equipe = _executar_sql(SQL_CHAMADOS_EQUIPE)
            dados_hoje = _executar_sql(SQL_CHAMADOS_HOJE)

    # Processar dados de equipe/atendente
    equipes = []
    atendentes = []

    if dados_equipe:
        for row in dados_equipe:
            nome = row.get("Field_0", "")
            qtd_chamados = row.get("Field_1", 0)
            qtd_encerrados = row.get("Field_2", 0)
            ultimo_chamado = row.get("Field_3", "")
            ordem = row.get("Field_4", 0)

            item = {
                "nome": nome,
                "chamados_abertos": qtd_chamados,
                "chamados_encerrados": qtd_encerrados,
                "ultimo_chamado": ultimo_chamado if ultimo_chamado.strip() else "-",
            }

            if ordem < 2:
                equipes.append(item)
            else:
                atendentes.append(item)

    # Processar chamados distribuídos hoje
    distribuidos_hoje = []
    if dados_hoje:
        for row in dados_hoje:
            distribuidos_hoje.append({
                "atendente": row.get("Field_0", ""),
                "chamados_novos": row.get("Field_1", 0),
                "data": row.get("Field_2", ""),
            })

    # Total de chamados abertos das equipes
    total_equipes = sum(e["chamados_abertos"] for e in equipes)

    return jsonify({
        "equipes": equipes,
        "atendentes": atendentes,
        "distribuidos_hoje": distribuidos_hoje,
        "total_chamados_equipes": total_equipes,
    })


@app.route("/api/health", methods=["GET"])
def health():
    """Healthcheck."""
    return jsonify({"status": "ok", "logged_in": bool(_cookies)})


# ─── Startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("Iniciando backend...")
    if not _login():
        logger.warning("Login inicial falhou. Tentará novamente na primeira requisição.")
    app.run(host="0.0.0.0", port=5000, debug=False)
