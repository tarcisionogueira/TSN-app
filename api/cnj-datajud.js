/**
 * API CNJ DataJud — consulta pública de processos judiciais
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/endpoints
 */

const CNJ_KEY = process.env.CNJ_DATAJUD_KEY;
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

const TRIBUNAL_MAP = {
  SP: 'tjsp', RJ: 'tjrj', MG: 'tjmg', RS: 'tjrs', PR: 'tjpr',
  SC: 'tjsc', BA: 'tjba', GO: 'tjgo', PE: 'tjpe', CE: 'tjce',
  ES: 'tjes', MA: 'tjma', PA: 'tjpa', PB: 'tjpb', RN: 'tjrn',
  MT: 'tjmt', MS: 'tjms', PI: 'tjpi', AL: 'tjal', SE: 'tjse',
  TO: 'tjto', DF: 'tjdft', AC: 'tjac', AM: 'tjam', AP: 'tjap',
  RO: 'tjro', RR: 'tjrr',
};

async function buscarProcesso(tribunal, query) {
  const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `APIKey ${CNJ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ size: 5, query }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DataJud ${tribunal}: ${res.status} — ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function normalizarNumero(num) {
  // Remove qualquer coisa que não seja dígito e retorna só números
  return num.replace(/\D/g, '');
}

function formatarMovimento(mov) {
  return {
    data: mov.dataHora?.split('T')[0] || '',
    descricao: mov.nome || mov.complemento || '',
    codigo: mov.codigo,
  };
}

function formatarParte(parte) {
  return {
    nome: parte.nome || '',
    tipo: parte.polo || '',
    representante: parte.advogados?.map(a => a.nome).join(', ') || '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { numero_processo, nome_parte, uf } = req.body || {};

  if (!numero_processo && !nome_parte) {
    return res.status(400).json({ error: 'Informe numero_processo ou nome_parte' });
  }
  if (!uf) {
    return res.status(400).json({ error: 'UF obrigatório para determinar o tribunal' });
  }

  const tribunal = TRIBUNAL_MAP[uf?.toUpperCase()];
  if (!tribunal) {
    return res.status(400).json({ error: `UF inválida ou tribunal não mapeado: ${uf}` });
  }

  try {
    let query;

    if (numero_processo) {
      // Busca por número do processo (formatado CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO)
      const numLimpo = normalizarNumero(numero_processo);
      query = {
        bool: {
          should: [
            { match: { numeroProcesso: numero_processo } },
            { match: { numeroProcesso: numLimpo } },
          ],
          minimum_should_match: 1,
        },
      };
    } else {
      // Busca por nome da parte
      query = {
        nested: {
          path: 'partes',
          query: {
            match: { 'partes.nome': { query: nome_parte, fuzziness: 'AUTO' } },
          },
        },
      };
    }

    const data = await buscarProcesso(tribunal, query);
    const hits = data?.hits?.hits || [];

    if (!hits.length) {
      return res.status(200).json({ processos: [], total: 0, tribunal });
    }

    const processos = hits.map(hit => {
      const s = hit._source || {};
      return {
        id: hit._id,
        numero: s.numeroProcesso || '',
        classe: s.classe?.nome || '',
        assunto: s.assuntos?.map(a => a.nome).join('; ') || '',
        orgao: s.orgaoJulgador?.nome || '',
        tribunal: s.tribunal || tribunal.toUpperCase(),
        data_ajuizamento: s.dataAjuizamento?.split('T')[0] || '',
        ultima_atualizacao: s.dataHoraUltimaAtualizacao?.split('T')[0] || '',
        grau: s.grau || '',
        partes: (s.partes || []).map(formatarParte),
        movimentos: (s.movimentos || [])
          .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
          .slice(0, 15)
          .map(formatarMovimento),
        // Indicadores de risco
        tem_penhora: (s.movimentos || []).some(m =>
          m.nome?.toLowerCase().includes('penhora') ||
          m.complemento?.toLowerCase().includes('penhora')
        ),
        tem_arresto: (s.movimentos || []).some(m =>
          m.nome?.toLowerCase().includes('arresto') ||
          m.complemento?.toLowerCase().includes('arresto')
        ),
        tem_leilao: (s.movimentos || []).some(m =>
          m.nome?.toLowerCase().includes('leilão') ||
          m.nome?.toLowerCase().includes('hasta') ||
          m.complemento?.toLowerCase().includes('leilão')
        ),
      };
    });

    return res.status(200).json({ processos, total: data.hits.total?.value || hits.length, tribunal });
  } catch (err) {
    console.error('CNJ DataJud erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
