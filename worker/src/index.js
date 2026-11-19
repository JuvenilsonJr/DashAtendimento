/**
 * Cloudflare Worker - Proxy API para o portal corporativo Apdata.
 * 
 * Faz login, executa queries SQL e retorna os dados com CORS habilitado
 * para que o frontend no GitHub Pages possa consumir.
 */

const APDATA_URL = 'https://portal.apdata.com.br/corporativo/.net/index.ashx/';

const BASE_PAYLOAD = {
  captcha: '',
  NTLMLogin: 'false',
  loginAuthenticOnserver: 'true',
  tenantName: 'Apdata',
  baseURL: '',
  tsc: '',
  sessionID: '0',
  selectedEmployee: '0',
  selectedCandidate: '0',
  selectedVacancy: '0',
  dtFmt: 'd/m/Y',
  tmFmt: 'H:i:s',
  shTmFmt: 'H:i',
  dtTmFmt: 'd/m/Y H:i:s',
  language: '0',
  idEmployeeLogged: '0',
};

// ─── SQL Queries ──────────────────────────────────────────────────────────────

const SQL_CHAMADOS_EQUIPE = `SELECT AJG.AJG_D1sEquipeAtendimento AS Equipe, PDD.PDD_DssNome AS Atendente, COUNT(*) AS ChamadosAbertos FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN EquipesAtendimentos AJG ON AJG.AJG_CdiEquipeAtendimento = CHA.CHA_CdiEquipeAtendimento_Atual JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = CHA.CHA_CdiContratoItemxPessoa_AtA JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE CHA.CHA_CdiStatusChamada <> 31 AND SCH.SCH_D1sStatusChamada LIKE 'Apdata%' AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiContratoItemxPessoa_AtA <> 0 AND CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) GROUP BY AJG.AJG_D1sEquipeAtendimento, PDD.PDD_DssNome ORDER BY 1, 3 DESC, 2`;

const SQL_CHAMADOS_DESENVOLVIMENTO = `SELECT PDD.PDD_DssNome AS Atendente, COUNT(*) AS ChamadosDesenvolvimento FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = CHA.CHA_CdiContratoItemxPessoa_AtA JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE CHA.CHA_CdiStatusChamada <> 31 AND SCH.SCH_D1sStatusChamada LIKE 'Apdata%' AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiContratoItemxPessoa_AtA <> 0 AND CHA.CHA_CdiEquipeAtendimento_Atual = 183 GROUP BY PDD.PDD_DssNome`;

const SQL_CHAMADOS_ENCERRADOS = `SELECT AJG.AJG_D1sEquipeAtendimento AS Equipe, PDD.PDD_DssNome AS Atendente, COUNT(DISTINCT CHA.CHA_CdiChamada) AS ChamadosEncerrados FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON CHA.CHA_CdiChamada = AHX.AHX_CdiChamada JOIN ContratosItensxPessoas HFE ON AHX.AHX_CdiContratoItemxPessoa_At = HFE.HFE_CdiContratoItemxPessoa JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato JOIN EquipesAtendimentos AJG ON AHX.AHX_CdiEquipeAtendimento = AJG.AJG_CdiEquipeAtendimento WHERE CHA.CHA_CdiStatusChamada = 31 AND AHX.AHX_CdiOcorrenciaChamada IN (51,52,59,66,67,85,86,93,158,159,1023,1024,1032) AND CHA.CHA_DtdChamada_Fim >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND CHA.CHA_DtdChamada_Fim < DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)) AND AJG.AJG_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND AJG.AJG_D2sEquipeAtendimento IS NOT NULL AND AJG.AJG_D2sEquipeAtendimento NOT LIKE 'None' GROUP BY AJG.AJG_D1sEquipeAtendimento, PDD.PDD_DssNome ORDER BY 1, 3 DESC`;

const SQL_CHAMADOS_SEM_ATENDENTE = `SELECT AJG.AJG_D1sEquipeAtendimento AS Equipe, COUNT(*) AS QtdeSemAtendente FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN EquipesAtendimentos AJG ON AJG.AJG_CdiEquipeAtendimento = CHA.CHA_CdiEquipeAtendimento_Atual WHERE CHA.CHA_CdiStatusChamada <> 31 AND SCH.SCH_OplPendenteCliente = 0 AND CHA.CHA_CdiContratoItemxPessoa_AtA = 0 AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) GROUP BY AJG.AJG_D1sEquipeAtendimento ORDER BY 2 DESC`;

const SQL_PRIORIDADES = `SELECT AJG.AJG_D1sEquipeAtendimento AS Equipe, PDD.PDD_DssNome AS Atendente, CHA.CHA_CdiChamada AS IdChamada, CHA.CHA_D1sReferencia AS Referencia, ESY.ESY_D1sSeveridadeSLA AS Prioridade, SCH.SCH_D1sStatusChamada AS Status FROM Chamadas CHA JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada JOIN EquipesAtendimentos AJG ON AJG.AJG_CdiEquipeAtendimento = CHA.CHA_CdiEquipeAtendimento_Atual JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = CHA.CHA_CdiContratoItemxPessoa_AtA JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato JOIN SeveridadesSLA ESY ON ESY.ESY_CdiSeveridadeSLA = CHA.CHA_CdiSeveridadeSLA JOIN ChamadasOcorrencias AHX16 ON AHX16.AHX_CdiChamada = CHA.CHA_CdiChamada AND AHX16.AHX_CdiOcorrenciaChamada = 16 WHERE CHA.CHA_CdiStatusChamada <> 31 AND SCH.SCH_OplPendenteCliente = 0 AND CHA.CHA_CdiChamada <> 0 AND CHA.CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) AND NOT EXISTS (SELECT 1 FROM ChamadasOcorrencias AHX2 WHERE AHX2.AHX_CdiChamada = CHA.CHA_CdiChamada AND AHX2.AHX_CdiOcorrenciaChamada IN (51,52,59,66,67,85,86,93,158,159,1023,1024,1032,8,22) AND AHX2.AHX_DtdChamadaOcorrencia_Ini > AHX16.AHX_DtdChamadaOcorrencia_Ini) ORDER BY CHA.CHA_CdiSeveridadeSLA, AJG.AJG_D1sEquipeAtendimento, PDD.PDD_DssNome`;

const SQL_DIAS_SEM_MOVIMENTACAO = `SELECT CHA_CdiChamada AS IdChamada, CHA_D1sReferencia AS Referencia, AJG_D1sEquipeAtendimento AS Equipe, PDD_DssNome AS Responsavel, SCH_D1sStatusChamada AS Status, MAX(AHX_DtdChamadaOcorrencia_Ini) AS UltimaOcorrencia, CAST(GETDATE() - MAX(AHX_DtdChamadaOcorrencia_Ini) AS INT) AS DiasSemMovimentacao, CAST(GETDATE() - CHA_DtdChamada AS INT) AS DiasEmAberto FROM Chamadas JOIN ChamadasOcorrencias ON AHX_CdiChamada = CHA_CdiChamada JOIN ContratosItensxPessoas ON CHA_CdiContratoItemxPessoa_AtA = HFE_CdiContratoItemxPessoa JOIN PessoasContratos ON HFE_CdiPessoaContrato = PDD_CdiPessoaContrato JOIN StatusChamadas ON CHA_CdiStatusChamada = SCH_CdiStatusChamada JOIN EquipesAtendimentos ON CHA_CdiEquipeAtendimento_Atual = AJG_CdiEquipeAtendimento WHERE CHA_CdiStatusChamada <> 31 AND SCH_OplPendenteCliente = 0 AND CHA_CdiChamada > 0 AND CHA_CdiEquipeAtendimento_Atual IN (57,132,144,146,147,148,160,174) GROUP BY CHA_CdiChamada, CHA_D1sReferencia, CHA_DtdChamada, AJG_D1sEquipeAtendimento, PDD_DssNome, SCH_D1sStatusChamada ORDER BY DiasSemMovimentacao DESC`;

const SQL_CHAMADOS_HOJE = `SELECT AJG.AJG_D1sEquipeAtendimento AS Equipe, PDD.PDD_DssNome AS Atendente, COUNT(DISTINCT CHA.CHA_CdiChamada) AS ChamadosNovos, FORMAT(GETDATE(), 'dd/MM/yyyy') AS DataRef FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON CHA.CHA_CdiChamada = AHX.AHX_CdiChamada JOIN EquipesAtendimentos AJG ON AHX.AHX_CdiEquipeAtendimento = AJG.AJG_CdiEquipeAtendimento JOIN ContratosItensxPessoas HFE ON AHX.AHX_CdiContratoItemxPessoa_AtA = HFE.HFE_CdiContratoItemxPessoa JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE AHX.AHX_CdiOcorrenciaChamada IN (2, 100) AND AHX.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND AHX.AHX_DtdChamadaOcorrencia_Ini >= CAST(GETDATE() AS DATE) AND AHX.AHX_DtdChamadaOcorrencia_Ini < DATEADD(DAY, 1, CAST(GETDATE() AS DATE)) AND NOT EXISTS(SELECT 1 FROM ChamadasOcorrencias AHX1 WHERE AHX1.AHX_CdiChamada = CHA.CHA_CdiChamada AND AHX1.AHX_CdiOcorrenciaChamada IN (2, 100) AND AHX1.AHX_DtdChamadaOcorrencia_Ini < AHX.AHX_DtdChamadaOcorrencia_Ini AND AHX1.AHX_CdiContratoItemxPessoa_AtA = AHX.AHX_CdiContratoItemxPessoa_AtA AND AHX1.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174)) GROUP BY AJG.AJG_D1sEquipeAtendimento, PDD.PDD_DssNome ORDER BY 3 DESC, 1, 2`;

// ─── SQL Queries - Metas ──────────────────────────────────────────────────────

const SQL_PESQUISA_SATISFACAO = `SELECT Ano, Mes, AJG_D1sEquipeAtendimento AS Equipe, atendente_nome AS Atendente, Classificacao, COUNT(*) AS Qtde FROM MetasAtend_PesquisaV GROUP BY Ano, Mes, AJG_D1sEquipeAtendimento, atendente_nome, Classificacao`;

const SQL_PRIMEIRO_ATENDIMENTO = `SELECT Ano, Mes, AJG_D1sEquipeAtendimento AS Equipe, atendente_nome AS Atendente, [Classificação] AS Classificacao, SUM(Qtde) AS Qtde FROM ChamdasPrimAtend GROUP BY Ano, Mes, AJG_D1sEquipeAtendimento, atendente_nome, [Classificação]`;

const SQL_ATENDIMENTO_SLA = `SELECT ChamadosSLAMetasView.Ano, Month(ChamadosSLAMetasView.CHA_DtdChamada_Fim) as Mes, EquipesChamadasView.AJG_D1sEquipeAtendimento AS Equipe, SLAMetaAtend.atendente_nome AS Atendente, Case When EquipesChamadasView.ResponsavelSLA = 1 and ChamadosSLAMetasView.ClassificacaoSLA = 2 Then 'Fora do SLA' Else 'Dentro do SLA' End as Classificacao, ChamadosSLAMetasView.CHA_CdiChamada, SLAMetaAtend.atendente_id FROM ChamadosSLAMetasView ChamadosSLAMetasView INNER JOIN EquipesChamadasView EquipesChamadasView ON (EquipesChamadasView.CHA_CdiChamada = ChamadosSLAMetasView.CHA_CdiChamada) INNER JOIN EquipesAtendimentos EquipesAtendimentos ON (EquipesAtendimentos.AJG_CdiEquipeAtendimento = EquipesChamadasView.AJG_CdiEquipeAtendimento) INNER JOIN SLAMetaAtend SLAMetaAtend ON (SLAMetaAtend.CHA_CdiChamada = ChamadosSLAMetasView.CHA_CdiChamada) WHERE EquipesAtendimentos.AJG_CdiEquipeAtendimento in (57,132,144,146,147,148,160,174) and SLAMetaAtend.AJG_CdiEquipeAtendimento = EquipesAtendimentos.AJG_CdiEquipeAtendimento and YEAR(ChamadosSLAMetasView.CHA_DtdChamada_Fim) >= 2025 and EquipesChamadasView.ResponsavelSLA = 0 and (SLAMetaAtend.Definitiva = 1 or SLAMetaAtend.Paliativo = 1 or SLAMetaAtend.DefInterna = 1) UNION ALL SELECT ChamadosSLAMetasView.Ano, Month(ChamadosSLAMetasView.CHA_DtdChamada_Fim) as Mes, EquipesChamadasView.AJG_D1sEquipeAtendimento AS Equipe, SLAMetaAtend.atendente_nome AS Atendente, Case When EquipesChamadasView.ResponsavelSLA = 1 and ChamadosSLAMetasView.ClassificacaoSLA = 2 Then 'Fora do SLA' Else 'Dentro do SLA' End as Classificacao, ChamadosSLAMetasView.CHA_CdiChamada, SLAMetaAtend.atendente_id FROM ChamadosSLAMetasView ChamadosSLAMetasView INNER JOIN EquipesChamadasView EquipesChamadasView ON (EquipesChamadasView.CHA_CdiChamada = ChamadosSLAMetasView.CHA_CdiChamada) INNER JOIN EquipesAtendimentos EquipesAtendimentos ON (EquipesAtendimentos.AJG_CdiEquipeAtendimento = EquipesChamadasView.AJG_CdiEquipeAtendimento) INNER JOIN SLAMetaAtend SLAMetaAtend ON (SLAMetaAtend.CHA_CdiChamada = ChamadosSLAMetasView.CHA_CdiChamada) WHERE EquipesAtendimentos.AJG_CdiEquipeAtendimento in (57,132,144,146,147,148,160,174) and SLAMetaAtend.AJG_CdiEquipeAtendimento = EquipesAtendimentos.AJG_CdiEquipeAtendimento and YEAR(ChamadosSLAMetasView.CHA_DtdChamada_Fim) >= 2025 and EquipesChamadasView.ResponsavelSLA = 1 and SLAMetaAtend.ResponsavelSLA = 1`;

const SQL_MAPA_ATENDENTES = `SELECT HFE.HFE_CdiContratoItemxPessoa, PDD.PDD_DssNome FROM ContratosItensxPessoas HFE JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato`;

// ─── SQL Queries - Pendência Técnica ──────────────────────────────────────────

// Chamados que tiveram a ocorrência 14 (PT), identificando a equipe que gerou a PT
// via AHX_CdiEquipeAtendimento. Traz o status atual do chamado e o flag
// SCH_OplPendenteCliente para o frontend classificar nas 3 abas:
//   - Em aberto           -> não finalizado (status <> 31) e não pendente com cliente
//   - Pendente com cliente -> SCH_OplPendenteCliente = 1
//   - Finalizado           -> CHA_CdiStatusChamada = 31
// Usa DISTINCT porque um mesmo chamado pode ter mais de uma ocorrência 14 pela
// mesma equipe; cada chamado deve aparecer uma única vez por equipe geradora.
// O filtro de equipe é aplicado no servidor (clausulaEquipe) para reduzir o
// volume trafegado: sem equipe selecionada são milhares de PTs historicas.
function buildSqlPendenciaTecnica(clausulaEquipe) {
  return `SELECT DISTINCT AHX.AHX_CdiEquipeAtendimento AS EquipeId, AJG.AJG_D1sEquipeAtendimento AS Equipe, CHA.CHA_CdiChamada AS IdChamada, CHA.CHA_D1sReferencia AS Referencia, CHA.CHA_CdiStatusChamada AS StatusId, SCH.SCH_D1sStatusChamada AS Status, SCH.SCH_OplPendenteCliente AS PendenteCliente, PDD.PDD_DssNome AS Atendente FROM Chamadas CHA JOIN ChamadasOcorrencias AHX ON AHX.AHX_CdiChamada = CHA.CHA_CdiChamada JOIN EquipesAtendimentos AJG ON AJG.AJG_CdiEquipeAtendimento = AHX.AHX_CdiEquipeAtendimento JOIN StatusChamadas SCH ON SCH.SCH_CdiStatusChamada = CHA.CHA_CdiStatusChamada LEFT JOIN ContratosItensxPessoas HFE ON HFE.HFE_CdiContratoItemxPessoa = AHX.AHX_CdiContratoItemxPessoa_At LEFT JOIN PessoasContratos PDD ON HFE.HFE_CdiPessoaContrato = PDD.PDD_CdiPessoaContrato WHERE AHX.AHX_CdiOcorrenciaChamada = 14 AND AHX.AHX_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) AND CHA.CHA_CdiChamada <> 0${clausulaEquipe} ORDER BY AJG.AJG_D1sEquipeAtendimento, CHA.CHA_CdiChamada`;
}

// Lista de equipes para popular o filtro, independente de haver PT. Mesmo
// conjunto da aba de atendimento.
const SQL_EQUIPES_PT = `SELECT AJG_D1sEquipeAtendimento AS Equipe FROM EquipesAtendimentos WHERE AJG_CdiEquipeAtendimento IN (57,132,144,146,147,148,160,174) ORDER BY AJG_D1sEquipeAtendimento`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

/**
 * Extrai cookies de uma Response no Cloudflare Workers.
 * CF Workers junta múltiplos Set-Cookie em um único header separado por ", "
 * mas "expires=Thu, 01 Jan..." também tem vírgula, então usamos getAll se disponível
 * ou iteramos via entries().
 */
function extractCookies(response) {
  const cookies = {};

  // Método 1: iterar todos os headers (CF Workers suporta múltiplas entradas)
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() === 'set-cookie') {
      // Cada entrada pode ser um cookie individual ou múltiplos separados por ", "
      // Separar por ", " mas evitar quebrar em "expires=Mon, 01..."
      const parts = value.split(/,\s*(?=[A-Za-z_\-]+=)/);
      for (const part of parts) {
        const cookiePart = part.trim().split(';')[0];
        const eqIdx = cookiePart.indexOf('=');
        if (eqIdx > 0) {
          const cName = cookiePart.substring(0, eqIdx).trim();
          const cValue = cookiePart.substring(eqIdx + 1).trim();
          cookies[cName] = cValue;
        }
      }
    }
  }

  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── API Apdata ───────────────────────────────────────────────────────────────

async function apdataRequest(metodo, payload, cookies) {
  const qs = buildQueryString(payload);
  const url = APDATA_URL + metodo + '?' + qs;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Cookie': cookieString(cookies),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'manual',
  });

  // Extrair novos cookies com getSetCookie()
  let rawSetCookies = [];
  if (typeof resp.headers.getSetCookie === 'function') {
    rawSetCookies = resp.headers.getSetCookie();
  } else {
    const sc = resp.headers.get('set-cookie');
    if (sc) rawSetCookies = [sc];
  }

  for (const header of rawSetCookies) {
    const parts = header.split(/,\s*(?=[A-Za-z_\-]+=)/);
    for (const part of parts) {
      const cookiePart = part.trim().split(';')[0];
      const eqIdx = cookiePart.indexOf('=');
      if (eqIdx > 0) {
        const cName = cookiePart.substring(0, eqIdx).trim();
        const cValue = cookiePart.substring(eqIdx + 1).trim();
        cookies[cName] = cValue;
      }
    }
  }

  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function login(env) {
  const cookies = {};
  const payload = {
    ...BASE_PAYLOAD,
    UserName: env.APP_USER,
    password: env.APP_PASS,
  };

  const qs = buildQueryString(payload);
  const url = APDATA_URL + 'login';

  // Enviar como POST com body form-urlencoded (como o requests.post com params= faz)
  // Na verdade requests.post(url, params=payload) envia na query string, mas vamos
  // tentar com a query string E também com o header User-Agent para evitar bloqueio do WAF
  const resp = await fetch(url + '?' + qs, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    },
  });

  // Debug: coletar TODOS os set-cookie headers
  // No CF Workers com headers().entries(), set-cookie aparece apenas uma vez (condensado)
  // Vamos usar getSetCookie() se disponível (runtime mais recente)
  let rawSetCookies = [];
  if (typeof resp.headers.getSetCookie === 'function') {
    rawSetCookies = resp.headers.getSetCookie();
  } else {
    // Fallback: pegar o header único
    const sc = resp.headers.get('set-cookie');
    if (sc) rawSetCookies = [sc];
  }

  // Parse cada cookie
  for (const header of rawSetCookies) {
    // Cada header pode ter um cookie: "name=value; path=/; ..."
    // Ou no fallback pode ter múltiplos condensados: "name1=val1, name2=val2"
    const parts = header.split(/,\s*(?=[A-Za-z_\-]+=)/);
    for (const part of parts) {
      const cookiePart = part.trim().split(';')[0];
      const eqIdx = cookiePart.indexOf('=');
      if (eqIdx > 0) {
        const cName = cookiePart.substring(0, eqIdx).trim();
        const cValue = cookiePart.substring(eqIdx + 1).trim();
        cookies[cName] = cValue;
      }
    }
  }

  // Verificar resposta de login
  const text = await resp.text();
  let loginData = null;
  if (text) {
    try { loginData = JSON.parse(text); } catch {}
  }

  // Se login falhou explicitamente
  if (loginData && loginData.success === false) {
    throw new Error(`Login falhou: ${loginData.error || 'desconhecido'}`);
  }

  // Atualizar tsc
  BASE_PAYLOAD.tsc = cookies.ts || '';

  // Se não tem cookie de sessão, pode ser que o Cloudflare está strip dos cookies HttpOnly
  if (!cookies.ts && !cookies.SessionID) {
    throw new Error(`Login sem cookies. rawSetCookies count: ${rawSetCookies.length}. rawSetCookies: ${JSON.stringify(rawSetCookies).substring(0, 500)}. Status: ${resp.status}. Body: ${text.substring(0, 300)}`);
  }

  // SetPerfil
  await apdataRequest('SetPerfil', { ...BASE_PAYLOAD, perfil: '34' }, cookies);

  return cookies;
}

async function executarSQL(sql, cookies) {
  // Passo 1: inicializar grid
  let payload = {
    ...BASE_PAYLOAD,
    sMessage: '1895866383',
    serverClass: 'ISQLGrid',
    killAfterUse: 'false',
    Field_0: sql, Field_0_TP: 'string',
    Field_1: 'false', Field_1_TP: 'boolean',
    Field_2: 'false', Field_2_TP: 'boolean',
    Field_3: 'false', Field_3_TP: 'boolean',
    Field_4: 'false', Field_4_TP: 'boolean',
  };

  let r = await apdataRequest('genericTransactionExecute', payload, cookies);
  if (!r || !r.hwd) {
    throw new Error(`Passo 1 falhou. Resposta: ${JSON.stringify(r)}`);
  }
  const hwd = r.hwd;

  // Passo 2: configurar query
  payload = {
    ...BASE_PAYLOAD,
    sMessage: '1879056385', hwd,
    Field_0: '5', Field_0_TP: 'int',
    Field_1: '', Field_1_TP: 'string',
    Field_2: sql, Field_2_TP: 'string',
    Field_2_AsRec: 'true',
    Field_3: 'false', Field_3_TP: 'boolean',
  };
  await apdataRequest('genericTransactionExecute', payload, cookies);

  // Passo 3: limite de linhas
  payload = {
    ...BASE_PAYLOAD,
    sMessage: '1879056410', hwd,
    Field_0: '90000', Field_0_TP: 'int',
  };
  await apdataRequest('genericTransactionExecute', payload, cookies);

  // Passo 4: buscar registros
  payload = {
    ...BASE_PAYLOAD,
    sMessage: '1879056391', rMessage: '1879056402', hwd,
    Field_0: '-2', Field_0_TP: 'int',
  };
  r = await apdataRequest('genericTransactionExecute', payload, cookies);
  return r ? (r.comBuf || null) : null;
}

// ─── CORS Headers ─────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// ─── Worker Handler ───────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/api/health') {
      return jsonResponse({ status: 'ok' });
    }

    // Debug: testar apenas o login
    if (url.pathname === '/api/debug-login') {
      try {
        const cookies = await login(env);
        return jsonResponse({ success: true, cookies_keys: Object.keys(cookies) });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // Dashboard endpoint
    if (url.pathname === '/api/dashboard') {
      try {
        // Login
        const cookies = await login(env);

        // Executar queries sequencialmente (compartilham a mesma sessão)
        const dadosEquipe = await executarSQL(SQL_CHAMADOS_EQUIPE, cookies);
        const dadosEncerrados = await executarSQL(SQL_CHAMADOS_ENCERRADOS, cookies);
        const dadosDesenv = await executarSQL(SQL_CHAMADOS_DESENVOLVIMENTO, cookies);
        const dadosSemAtendente = await executarSQL(SQL_CHAMADOS_SEM_ATENDENTE, cookies);
        const dadosHoje = await executarSQL(SQL_CHAMADOS_HOJE, cookies);
        const dadosDiasSemMov = await executarSQL(SQL_DIAS_SEM_MOVIMENTACAO, cookies);
        const dadosPrioridades = await executarSQL(SQL_PRIORIDADES, cookies);

        // Processar atendentes por equipe (abertos)
        const atendentesMap = {};

        if (dadosEquipe && Array.isArray(dadosEquipe)) {
          for (const row of dadosEquipe) {
            const equipe = row.Field_0 || '';
            const nome = row.Field_1 || '';
            const key = `${equipe}|${nome}`;
            atendentesMap[key] = {
              equipe,
              nome,
              chamados_abertos: row.Field_2 || 0,
              chamados_encerrados: 0,
            };
          }
        }

        // Mesclar encerrados
        if (dadosEncerrados && Array.isArray(dadosEncerrados)) {
          for (const row of dadosEncerrados) {
            const equipe = row.Field_0 || '';
            const nome = row.Field_1 || '';
            const key = `${equipe}|${nome}`;
            if (atendentesMap[key]) {
              atendentesMap[key].chamados_encerrados = row.Field_2 || 0;
            } else {
              atendentesMap[key] = {
                equipe,
                nome,
                chamados_abertos: 0,
                chamados_encerrados: row.Field_2 || 0,
              };
            }
          }
        }

        // Chamados abertos na equipe 183 (Desenvolvimento) por atendente (apenas os ja listados)
        const desenvMap = {};
        if (dadosDesenv && Array.isArray(dadosDesenv)) {
          for (const row of dadosDesenv) desenvMap[row.Field_0 || ''] = row.Field_1 || 0;
        }
        const atendentes = Object.values(atendentesMap).map(a => ({ ...a, desenvolvimento: desenvMap[a.nome] || 0 }));

        // Chamados sem atendente por equipe
        const sem_atendente = [];
        if (dadosSemAtendente && Array.isArray(dadosSemAtendente)) {
          for (const row of dadosSemAtendente) {
            sem_atendente.push({
              equipe: row.Field_0 || '',
              quantidade: row.Field_1 || 0,
            });
          }
        }

        // Equipes: extrair nomes únicos das equipes
        const nomesEquipes = new Set();
        atendentes.forEach(a => nomesEquipes.add(a.equipe));
        sem_atendente.forEach(s => nomesEquipes.add(s.equipe));
        const equipes = [...nomesEquipes].sort().map(nome => {
          const totalAbertos = atendentes.filter(a => a.equipe === nome).reduce((s, a) => s + a.chamados_abertos, 0);
          const semAt = sem_atendente.find(s => s.equipe === nome);
          return { nome, chamados_abertos: totalAbertos + (semAt ? semAt.quantidade : 0) };
        });

        const distribuidos_hoje = [];
        if (dadosHoje && Array.isArray(dadosHoje)) {
          for (const row of dadosHoje) {
            distribuidos_hoje.push({
              equipe: row.Field_0 || '',
              atendente: row.Field_1 || '',
              chamados_novos: row.Field_2 || 0,
              data: row.Field_3 || '',
            });
          }
        }

        const total_chamados_equipes = equipes.reduce((sum, e) => sum + e.chamados_abertos, 0);
        const total_sem_atendente = sem_atendente.reduce((sum, s) => sum + s.quantidade, 0);

        // Chamados com mais dias sem movimentação
        const dias_sem_movimentacao = [];
        if (dadosDiasSemMov && Array.isArray(dadosDiasSemMov)) {
          for (const row of dadosDiasSemMov) {
            dias_sem_movimentacao.push({
              id_chamada: row.Field_0 || 0,
              referencia: row.Field_1 || '',
              equipe: row.Field_2 || '',
              responsavel: row.Field_3 || '',
              status: row.Field_4 || '',
              ultima_ocorrencia: row.Field_5 || '',
              dias_sem_movimentacao: row.Field_6 || 0,
              dias_em_aberto: row.Field_7 || 0,
            });
          }
        }

        // Prioridades
        const prioridades = [];
        if (dadosPrioridades && Array.isArray(dadosPrioridades)) {
          for (const row of dadosPrioridades) {
            prioridades.push({
              equipe: row.Field_0 || '',
              atendente: row.Field_1 || '',
              id_chamada: row.Field_2 || 0,
              referencia: row.Field_3 || '',
              prioridade: row.Field_4 || '',
              status: row.Field_5 || '',
            });
          }
        }

        return jsonResponse({ equipes, atendentes, sem_atendente, distribuidos_hoje, dias_sem_movimentacao, prioridades, total_chamados_equipes, total_sem_atendente });
      } catch (err) {
        return jsonResponse({ error: err.message, stack: err.stack }, 500);
      }
    }

    // Metas endpoint
    if (url.pathname === '/api/metas') {
      try {
        const cookies = await login(env);

        const [dadosSatisfacao, dadosPrimAtend, dadosSLA, dadosMapaAtend] = await Promise.all([
          executarSQL(SQL_PESQUISA_SATISFACAO, cookies),
          executarSQL(SQL_PRIMEIRO_ATENDIMENTO, cookies),
          executarSQL(SQL_ATENDIMENTO_SLA, cookies),
          executarSQL(SQL_MAPA_ATENDENTES, cookies),
        ]);

        // Mapa atendente_id -> PDD_DssNome (nome padronizado, igual as outras abas).
        // Resolvido no codigo porque fazer o JOIN dentro da consulta de SLA
        // estoura o gateway do portal (504) pelo volume de linhas.
        const mapaAtendentes = {};
        if (dadosMapaAtend && Array.isArray(dadosMapaAtend)) {
          for (const row of dadosMapaAtend) {
            if (row.Field_0 != null) mapaAtendentes[row.Field_0] = (row.Field_1 || '').trim();
          }
        }

        // Pesquisa Satisfação: Field_0=Ano, Field_1=Mes, Field_2=Equipe, Field_3=Atendente, Field_4=Classificação, Field_5=Qtde
        const satisfacao = [];
        if (dadosSatisfacao && Array.isArray(dadosSatisfacao)) {
          for (const row of dadosSatisfacao) {
            satisfacao.push({
              ano: row.Field_0 || 0,
              mes: row.Field_1 || 0,
              equipe: row.Field_2 || '',
              atendente: row.Field_3 || '',
              classificacao: row.Field_4 || '',
              qtde: row.Field_5 || 0,
            });
          }
        }

        // Primeiro Atendimento: Field_0=Ano, Field_1=Mes, Field_2=Equipe, Field_3=Atendente, Field_4=Classificação, Field_5=Qtde
        const primeiro_atendimento = [];
        if (dadosPrimAtend && Array.isArray(dadosPrimAtend)) {
          for (const row of dadosPrimAtend) {
            primeiro_atendimento.push({
              ano: row.Field_0 || 0,
              mes: row.Field_1 || 0,
              equipe: row.Field_2 || '',
              atendente: row.Field_3 || '',
              classificacao: row.Field_4 || '',
              qtde: row.Field_5 || 0,
            });
          }
        }

        // SLA: Field_0=Ano, Field_1=Mes, Field_2=Equipe, Field_3=Atendente(cru),
        //      Field_4=Classificação, Field_5=CHA_CdiChamada, Field_6=atendente_id
        // O nome exibido vem do mapa (PDD_DssNome) para bater com as outras abas;
        // se o id nao estiver no mapa, cai no nome cru da view.
        const slaMap = {};
        if (dadosSLA && Array.isArray(dadosSLA)) {
          for (const row of dadosSLA) {
            const nomeMapeado = mapaAtendentes[row.Field_6];
            const atendente = (nomeMapeado || row.Field_3 || '').trim();
            const key = `${row.Field_0}|${row.Field_1}|${row.Field_2}|${atendente}|${row.Field_4}`;
            if (!slaMap[key]) {
              slaMap[key] = { ano: row.Field_0||0, mes: row.Field_1||0, equipe: row.Field_2||'', atendente: atendente, classificacao: row.Field_4||'', qtde: 0 };
            }
            slaMap[key].qtde++;
          }
        }
        const sla = Object.values(slaMap);

        return jsonResponse({ satisfacao, primeiro_atendimento, sla });
      } catch (err) {
        return jsonResponse({ error: err.message, stack: err.stack }, 500);
      }
    }

    // Pendência Técnica endpoint
    // ?equipe=<nome> -> retorna os chamados daquela equipe (filtrado no servidor).
    // Sem o parametro, retorna apenas a lista de equipes para popular o filtro.
    if (url.pathname === '/api/pendencia-tecnica') {
      try {
        const cookies = await login(env);

        // Lista de equipes (sempre retornada, igual a aba de atendimento)
        const dadosEquipes = await executarSQL(SQL_EQUIPES_PT, cookies);
        const equipes = [];
        if (dadosEquipes && Array.isArray(dadosEquipes)) {
          for (const row of dadosEquipes) {
            const nome = (row.Field_0 || '').trim();
            if (nome) equipes.push(nome);
          }
        }

        const equipeParam = (url.searchParams.get('equipe') || '').trim();

        // Sem equipe selecionada: nao busca chamados (sao milhares de PTs historicas).
        if (!equipeParam) {
          return jsonResponse({ chamados: [], equipes });
        }

        // Escapa aspas simples para montar o literal de forma segura no T-SQL.
        const equipeSql = equipeParam.replace(/'/g, "''");
        const clausulaEquipe = ` AND AJG.AJG_D1sEquipeAtendimento = '${equipeSql}'`;
        const dadosPT = await executarSQL(buildSqlPendenciaTecnica(clausulaEquipe), cookies);

        // Field_0=EquipeId, Field_1=Equipe, Field_2=IdChamada, Field_3=Referencia,
        // Field_4=StatusId, Field_5=Status, Field_6=PendenteCliente, Field_7=Atendente
        // (contratado que incluiu a ocorrencia 14 - AHX_CdiContratoItemxPessoa_At)
        const chamados = [];
        if (dadosPT && Array.isArray(dadosPT)) {
          for (const row of dadosPT) {
            const statusId = row.Field_4 || 0;
            const pendenteCliente = Number(row.Field_6) === 1;
            // Classificação: finalizado (31) tem prioridade; depois pendente cliente;
            // o restante é "em aberto".
            let categoria;
            if (Number(statusId) === 31) categoria = 'finalizado';
            else if (pendenteCliente) categoria = 'pendente_cliente';
            else categoria = 'em_aberto';

            chamados.push({
              equipe: row.Field_1 || '',
              id_chamada: row.Field_2 || 0,
              referencia: row.Field_3 || '',
              status: row.Field_5 || '',
              atendente: row.Field_7 || '',
              categoria,
            });
          }
        }

        return jsonResponse({ chamados, equipes });
      } catch (err) {
        return jsonResponse({ error: err.message, stack: err.stack }, 500);
      }
    }

    // 404
    return jsonResponse({ error: 'Not found. Use /api/dashboard, /api/metas, /api/pendencia-tecnica ou /api/health' }, 404);
  },
};
