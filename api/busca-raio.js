/**
 * POST /api/busca-raio
 * Busca imóveis dentro de um raio usando earthdistance (PostGIS-lite nativo do Postgres).
 * Retorna página com distância calculada no banco — sem trazer 5000 registros pro browser.
 *
 * Body: { lat, lng, raioKm, pagina, porPagina, sortAtivo, filtros: { tipos[], estado, modalidades[], pagamento[], valorMin, valorMax, prazo } }
 * pagamento usa valores canônicos do banco (a_vista | financiado | hipotecado).
 * sortAtivo: mesmos valores do dropdown da Busca (desconto_desc | desconto_asc | valor_asc |
 * data_asc) — repassado direto pra `ordenacao` da RPC, que usa os MESMOS nomes.
 */
// Runtime EDGE: o handler usa a Web Request/Response (req.json() e `new Response`).
// SEM esta linha a função rodava no Node, onde o `return new Response()` é IGNORADO
// → a requisição pendurava e a busca por raio ficava em "Buscando..." pra sempre.
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Mesma regra de src/pages/Busca.jsx `calcularJanelaPrazo` — duplicada aqui (server) de
// propósito: é 6 linhas, e importar código de src/ num endpoint api/ não é o padrão deste
// projeto. Janelas CUMULATIVAS a partir de hoje (ver comentário completo em Busca.jsx).
function janelaPrazo(opcao) {
  if (!opcao) return { semData: false, dataDe: null, dataAte: null };
  if (opcao === 'sem_data') return { semData: true, dataDe: null, dataAte: null };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const meses = opcao === 'este_mes' ? 1 : opcao === 'proximo_mes' ? 2 : opcao === 'proximo_trimestre' ? 4 : null;
  if (!meses) return { semData: false, dataDe: null, dataAte: null };
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + meses, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { semData: false, dataDe: iso(hoje), dataAte: iso(fim) };
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 }); }

  const { lat, lng, raioKm = 50, pagina = 1, porPagina = 24, filtros = {}, sortAtivo } = body;

  if (!lat || !lng) return new Response(JSON.stringify({ error: 'lat e lng são obrigatórios' }), { status: 400 });

  const raioMetros = raioKm * 1000;
  const offset = (pagina - 1) * porPagina;

  // Aceita arrays (tipos/modalidades/pagamento) e mantém retrocompatibilidade com
  // os campos singulares antigos (tipo/modalidade).
  const tipos = Array.isArray(filtros.tipos) ? filtros.tipos.filter(Boolean)
    : (filtros.tipo ? [filtros.tipo] : []);
  const modalidades = Array.isArray(filtros.modalidades) ? filtros.modalidades.filter(Boolean)
    : (filtros.modalidade ? [filtros.modalidade] : []);
  const pagamentos = Array.isArray(filtros.pagamento) ? filtros.pagamento.filter(Boolean) : [];
  const { semData, dataDe, dataAte } = janelaPrazo(filtros.prazo || '');

  // RPC v2 via POST (JSON lida com arrays nativamente). Faz TODOS os filtros
  // simultâneos no banco e devolve o total na coluna `total`.
  // REGRA ABSOLUTA: todo filtro da Busca deve valer TAMBÉM aqui (modo raio).
  // Filtros atuais: tipos, estado, modalidades, pagamento, valor_min/max, desconto_min.
  // Ao adicionar um filtro novo, inclua-o aqui, na RPC buscar_por_raio_v2 (SQL) e no
  // helper aplicarFiltrosImoveis do front — os três caminhos precisam ficar em sincronia.
  const filtrosComuns = {
    tipos_filtro: tipos,
    // RAIO CRUZA ESTADO (14/09, pedido do dono): este endpoint é usado só pelo modo raio —
    // travar por UF escondia imóvel do lado da divisa, dentro do raio pedido, só por estar
    // na UF vizinha da cidade-centro. '' aqui é "sem filtro de UF" pro RPC (buscar_por_raio_v2).
    estado_filtro: '',
    modalidades_filtro: modalidades,
    pagamentos_filtro: pagamentos,
    valor_min: filtros.valorMin || 0,
    valor_max: filtros.valorMax || 9999999999,
    desconto_min: filtros.descontoMin || 0,
    data_de: dataDe, data_ate: dataAte, sem_data: semData,
  };

  // 21/09 (pedido do dono, "busca por raio, qual melhor forma de resolver [o gap de
  // imóvel sem geocode sumindo sem aviso]"): junto da RPC de resultados, uma 2ª chamada
  // — só CONTAGEM, sem trazer linha — de quantos imóveis batem nos MESMOS filtros mas
  // não têm coordenada, restrita à cidade escolhida como centro (`cidadeNormCentro`; sem
  // ela não dá pra saber se um imóvel sem geocode "seria" desta busca). Em paralelo com a
  // RPC principal — não atrasa a resposta normal, e se falhar não derruba a busca (só não
  // mostra o aviso).
  const cidadeNormCentro = String(filtros.cidadeNormCentro || '').trim();
  const [rpcRes, semGeocodeRes] = await Promise.all([
    sb('rpc/buscar_por_raio_v2', {
      method: 'POST',
      body: JSON.stringify({
        lat, lng,
        raio_metros: raioMetros,
        lim: porPagina,
        off: offset,
        ...filtrosComuns,
        // 17/09 (achado do dono): faltava — a RPC sempre ordenava por distância e o dropdown
        // "Menor valor primeiro"/desconto/data não tinha efeito nenhum no modo raio.
        ordenacao: sortAtivo || 'distancia',
      }),
    }),
    cidadeNormCentro
      ? sb('rpc/buscar_por_raio_v2_sem_geocode_count', {
          method: 'POST',
          body: JSON.stringify({ cidade_norm_filtro: cidadeNormCentro, ...filtrosComuns }),
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!rpcRes.ok) {
    const err = await rpcRes.text().catch(() => '');
    if (err.includes('does not exist') || err.includes('function')) {
      return new Response(JSON.stringify({
        error: 'Função buscar_por_raio_v2 não existe no banco. Execute a migração SQL.',
        detalhes: err,
      }), { status: 503 });
    }
    return new Response(JSON.stringify({ error: 'Erro ao buscar por raio', detalhes: err }), { status: 500 });
  }

  const dados = await rpcRes.json();
  // total vem repetido em cada linha (window-less count via subselect); 0 linhas → 0
  const total = (dados && dados.length > 0 && dados[0].total != null) ? Number(dados[0].total) : 0;

  // Falha nesta 2ª chamada não é erro da busca — só fica sem o aviso (0).
  let semGeocode = 0;
  if (semGeocodeRes && semGeocodeRes.ok) {
    const val = await semGeocodeRes.json().catch(() => null);
    semGeocode = typeof val === 'number' ? val : Number(val ?? 0) || 0;
  }

  return new Response(JSON.stringify({
    resultados: dados || [],
    pagina,
    porPagina,
    total,
    semGeocode,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
