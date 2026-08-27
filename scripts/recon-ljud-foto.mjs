/**
 * RECON LJUD FOTO — a fonte NÃO TEM a foto, ou nós é que a perdemos?
 *
 * POR QUE ESTE SCRIPT EXISTE (27/08). O LJUD tem 462 lotes ativos sem foto — a segunda maior
 * parcela do invariante `sem_foto`. Do ambiente da sessão o proxy recusa CONNECT tanto ao
 * portal quanto à API, então a pergunta não pôde ser respondida lá. O que DEU para medir no
 * banco aponta forte para "a fonte não tem":
 *
 *   • 843 dos 1.305 ativos TÊM foto (65%) — o parser claramente funciona;
 *   • em 97 grupos (dia de coleta × leiloeiro) vieram lotes COM e SEM foto no MESMO run
 *     (ex.: 26/08, alvaroleiloes: 29 com foto, 2 sem). Parser quebrado traria o run inteiro
 *     vazio, não dois terços dele cheio;
 *   • a taxa varia de 16% a 85% POR LEILOEIRO — assinatura de quem publica ou não publica
 *     foto, não de defeito técnico;
 *   • nenhum dos 462 tem imagem nos anexos (0 de 462), então não há de onde tirar.
 *
 * Isso é forte, mas é INDÍCIO — e indício não fecha a questão. Este recon fecha, indo à
 * fonte: pega no NOSSO banco os lotes que estão sem foto, procura cada um na API pública e
 * responde qual dos dois mundos é o verdadeiro.
 *
 * ⚠️ O VEREDITO É O PONTO, e ele tem que ser inequívoco nos dois sentidos:
 *   • a API traz foto para lotes que aqui estão vazios  → É BUG NOSSO, e o script imprime
 *     exatamente quais campos trazem a imagem, para o parser passar a ler;
 *   • a API também não tem                              → ENCERRADO: não é defeito, é
 *     ausência na origem, e o número para de ser tratado como dívida técnica.
 *
 * Só leitura, não grava nada. Roda no GitHub Actions (recon-ljud-foto.yml), onde a rede
 * funciona. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const API = 'https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGINAS = Number(process.env.RECON_PAGINAS || 8);

// Qualquer valor que PAREÇA uma imagem, venha de que campo vier. Procurar por nome de campo
// conhecido ('foto') seria assumir a resposta: se a API renomeou o campo, o parser está
// cego e é exatamente isso que precisamos descobrir.
const EH_IMAGEM = /\.(jpe?g|png|webp|gif)(\?|$)/i;

function camposComImagem(obj, prefixo = '', achados = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if (typeof v === 'string' && EH_IMAGEM.test(v)) achados.push({ campo: caminho, valor: v.slice(0, 120) });
    else if (Array.isArray(v)) v.slice(0, 3).forEach((x, i) => {
      if (typeof x === 'string' && EH_IMAGEM.test(x)) achados.push({ campo: `${caminho}[${i}]`, valor: x.slice(0, 120) });
      else if (x && typeof x === 'object') camposComImagem(x, `${caminho}[${i}]`, achados);
    });
    else if (v && typeof v === 'object') camposComImagem(v, caminho, achados);
  }
  return achados;
}

async function paginaApi(pg) {
  const r = await fetch(`${API}?tipo=3&pg=${pg}`, {
    headers: {
      'User-Agent': UA, Accept: 'application/json',
      Origin: 'https://www.leiloesjudiciais.com.br', Referer: 'https://www.leiloesjudiciais.com.br/',
    },
    signal: AbortSignal.timeout(30000),
  });
  // `.ok` conferido: um 4xx devolvendo HTML viraria "a API não tem lote nenhum" — e o recon
  // concluiria "encerrado, a fonte não tem foto" a partir de um erro de rede. É o defeito que
  // este projeto já pagou várias vezes; aqui ele produziria um veredito falso e definitivo.
  if (!r.ok) throw new Error(`API HTTP ${r.status}`);
  const j = await r.json();
  const items = j?.data || j?.bens || j?.items || (Array.isArray(j) ? j : []);
  if (!Array.isArray(items)) throw new Error('corpo inesperado da API');
  return items;
}

(async () => {
  console.log('=== RECON LJUD FOTO — a fonte tem a imagem que nos falta? ===\n');

  // 1) O QUE ESTÁ SEM FOTO NO NOSSO BANCO
  const { data: semFoto, error } = await supabase
    .from('imoveis_leilao')
    .select('fonte_id, titulo, cidade, estado, url_lote')
    .eq('fonte', 'LJUD').eq('ativo', true).or('link_foto.is.null,link_foto.eq.')
    .limit(500);
  if (error) { console.error('Supabase falhou:', error.message); process.exit(1); }
  const idsSemFoto = new Set((semFoto || []).map((l) => String(l.fonte_id).replace(/^ljud_/, '')));
  console.log(`Nosso banco: ${idsSemFoto.size} lotes ATIVOS sem foto.\n`);

  // 2) O QUE A API DIZ
  const vistos = new Map();
  for (let pg = 1; pg <= PAGINAS; pg++) {
    let items;
    try { items = await paginaApi(pg); } catch (e) { console.log(`  pg ${pg}: ${e.message}`); break; }
    if (!items.length) break;
    for (const it of items) vistos.set(String(it.lote_id ?? it.bem_id ?? ''), it);
    console.log(`  pg ${pg}: ${items.length} itens (acumulado ${vistos.size})`);
  }
  if (!vistos.size) { console.log('\nA API não devolveu nada — recon INCONCLUSIVO (não confunda com "sem foto").'); process.exit(2); }

  // 3) O CRUZAMENTO — só os lotes que aqui estão vazios
  const cruzados = [...vistos.entries()].filter(([id]) => idsSemFoto.has(id));
  console.log(`\nDos que a API devolveu, ${cruzados.length} estão SEM FOTO no nosso banco.`);
  if (!cruzados.length) {
    console.log('Nenhum coincidiu nesta amostra — aumente RECON_PAGINAS. INCONCLUSIVO.');
    process.exit(2);
  }

  let comImagemNaApi = 0;
  const camposVistos = new Map();
  for (const [id, it] of cruzados) {
    const achados = camposComImagem(it);
    if (achados.length) {
      comImagemNaApi++;
      for (const a of achados) camposVistos.set(a.campo, (camposVistos.get(a.campo) || 0) + 1);
      if (comImagemNaApi <= 5) {
        console.log(`\n  lote ${id} — A API TEM IMAGEM:`);
        achados.slice(0, 4).forEach((a) => console.log(`      ${a.campo} = ${a.valor}`));
      }
    }
  }

  console.log('\n══════════════════ VEREDITO ══════════════════');
  console.log(`  lotes conferidos (sem foto aqui) : ${cruzados.length}`);
  console.log(`  destes, a API TEM imagem         : ${comImagemNaApi}`);
  if (comImagemNaApi === 0) {
    console.log('\n  ✅ ENCERRADO — a fonte também não tem. Não é defeito nosso, é ausência');
    console.log('     na origem. Estes lotes não devem ser tratados como dívida técnica.');
  } else {
    console.log('\n  🔴 É BUG NOSSO — a API traz a imagem e o parser não está lendo.');
    console.log('     Campos que carregam a imagem (usar no parser):');
    [...camposVistos.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([campo, n]) => console.log(`       ${campo}  (em ${n} lotes)`));
  }
  console.log('══════════════════════════════════════════════');
})();
