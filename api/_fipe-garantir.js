// GARANTE A FIPE DE UM VEÍCULO (02/10, dono: "não podemos ficar sem uma referência FIPE ao avaliar um
// veículo, principalmente ao gerar um relatório"). Extraído de api/veiculo-fipe.js para a TELA e a
// GERAÇÃO DO RELATÓRIO (gerar-analise-veiculo) usarem a mesma régua: ano pelo edital/página quando
// falta, cache de 25 dias (`fipe_cache`), cota diária (`registrar_uso_fipe`) e, no motor
// (api/_fipe.js), a triangulação por ano+combustível. `forcar` ignora a espera de 90 dias de um
// `sem_match` antigo — o relatório não pode sair sem tentar de novo.
// Devolve o mesmo payload que a tela sempre recebeu (valor_fipe, fipe_status, …).
import { anoPorDocumento } from './_ano-veiculo.js';
import { criarFipeFetch, buscarFipe, fipeEstaVelho, RETENTAR_OK_DIAS, TETO_DIARIO_FIPE } from './_fipe.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export const COLUNAS_FIPE = 'id,titulo,marca,modelo,placa,chassi,anexos,link_lote,ano_fabricacao,ano_modelo,tipo_veiculo,valor_fipe,fipe_codigo,fipe_mes_referencia,fipe_status,fipe_atualizado_em';

export async function garantirFipe(v, { forcar = false } = {}) {
  const id = v.id;
  if (!forcar && !fipeEstaVelho(v.fipe_status, v.fipe_atualizado_em)) {
    return { valor_fipe: v.valor_fipe, fipe_codigo: v.fipe_codigo, fipe_mes_referencia: v.fipe_mes_referencia, fipe_status: v.fipe_status, de_cache: true };
  }
  // Sem marca/modelo na fonte, `buscarFipe` tenta pelo título (24/09) e devolve 'sem_dados'
  // quando nem o título tem — sem gastar cota.
  // SEM ANO → procura no EDITAL e na página do lote (26/09, dono: "quase todos disponibilizam
  // um edital"). Só para o veículo aberto; custo zero (PDF com texto + HTML público). Não achou →
  // grava 'sem_dados' com data, e a próxima abertura não repete a leitura (fipeEstaVelho: 90 dias).
  if (!v.ano_fabricacao) {
    const lotesPorDoc = async (url) => {
      const r = await sb(`veiculos_leilao?anexos=cs.${encodeURIComponent(JSON.stringify([{ url }]))}&select=id&limit=2`);
      if (!r.ok) return 2; // não consegui contar → trata como documento de vários lotes (não usa o texto inteiro)
      return (await r.json().catch(() => [])).length;
    };
    const achado = await anoPorDocumento(v, lotesPorDoc);
    if (!achado.ano) {
      console.log(`[veiculo-fipe] ${id}: ano não achado (${achado.motivos.join(' · ') || 'sem edital nem página'})`);
      const r = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fipe_status: 'sem_dados', fipe_atualizado_em: new Date().toISOString() }) });
      if (!r.ok) console.error(`[veiculo-fipe] ${id}: não gravei sem_dados (${r.status})`);
      return { valor_fipe: null, fipe_status: 'sem_dados', de_cache: false, motivo: achado.motivos[achado.motivos.length - 1] || null };
    }
    // Placa que já é de OUTRO veículo do acervo = o trecho lido era de outro lote → descarta tudo.
    if (achado.placa) {
      const rP = await sb(`veiculos_leilao?placa=eq.${encodeURIComponent(achado.placa)}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`);
      const outro = rP.ok ? await rP.json().catch(() => []) : [];
      if (!rP.ok || outro.length) {
        console.log(`[veiculo-fipe] ${id}: placa ${achado.placa} ${rP.ok ? 'é de outro veículo' : 'não conferida'} — leitura descartada`);
        return { valor_fipe: null, fipe_status: v.fipe_status || null, de_cache: false, motivo: 'leitura do documento não confiável' };
      }
    }
    const patchAno = { ano_fabricacao: achado.ano[0], ano_modelo: achado.ano[1] };
    if (achado.placa && !v.placa) patchAno.placa = achado.placa;
    const gAno = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patchAno) });
    const [comAno] = gAno.ok ? await gAno.json().catch(() => []) : [];
    if (!comAno) console.error(`[veiculo-fipe] ${id}: ano achado (${achado.fonte}) mas não gravou (${gAno.status}) — segue a FIPE com ele assim mesmo`);
    console.log(`[veiculo-fipe] ${id}: ano ${achado.ano.join('/')} pelo ${achado.fonte}${achado.placa ? ` · placa ${achado.placa}` : ''}`);
    Object.assign(v, patchAno);
  }
  // Mesmo cache de respostas do cron (`fipe_cache`, 25 dias) — acerto não gasta cota.
  const validoDesde = new Date(Date.now() - RETENTAR_OK_DIAS * 86400000).toISOString();
  const cacheFipe = {
    async ler(path) {
      const r = await sb(`fipe_cache?path=eq.${encodeURIComponent(path)}&obtido_em=gte.${validoDesde}&select=resposta`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const [linha] = await r.json();
      return linha?.resposta;
    },
    async gravar(path, resposta) {
      const r = await sb('fipe_cache', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ path, resposta, obtido_em: new Date().toISOString() }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  };

  const fipeGet = criarFipeFetch(async () => {
    const r = await sb('rpc/registrar_uso_fipe', { method: 'POST', body: JSON.stringify({ p_teto: TETO_DIARIO_FIPE }) });
    if (!r.ok) return { permitido: false };
    return r.json();
  }, cacheFipe);
  const resultado = await buscarFipe(fipeGet, v);

  if (resultado.status === 'sem_cota') {
    return { valor_fipe: v.valor_fipe, fipe_codigo: v.fipe_codigo, fipe_mes_referencia: v.fipe_mes_referencia, fipe_status: v.fipe_status, de_cache: true, cota_esgotada: true };
  }

  const agora = new Date().toISOString();
  const patch = resultado.status === 'ok' || resultado.status === 'aproximado'
    ? { valor_fipe: resultado.valor, fipe_codigo: resultado.codigoFipe, fipe_mes_referencia: resultado.mesReferencia, fipe_status: resultado.status, fipe_atualizado_em: agora }
    : { fipe_status: resultado.status, fipe_atualizado_em: agora };

  const grava = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!grava.ok) {
    console.error(`[veiculo-fipe] gravação falhou (veículo ${id}): ${grava.status}`);
    return { valor_fipe: null, fipe_status: 'erro', de_cache: false };
  }
  const [gravado] = await grava.json();
  if (!gravado) {
    console.error(`[veiculo-fipe] update não alcançou nenhuma linha (veículo ${id}) — RLS ou id inexistente`);
    return { valor_fipe: null, fipe_status: 'erro', de_cache: false };
  }
  return ({ valor_fipe: gravado.valor_fipe, fipe_codigo: gravado.fipe_codigo, fipe_mes_referencia: gravado.fipe_mes_referencia, fipe_status: gravado.fipe_status, de_cache: false,
    ano_fabricacao: gravado.ano_fabricacao, ano_modelo: gravado.ano_modelo, placa: gravado.placa });
}
