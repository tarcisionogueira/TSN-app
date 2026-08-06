/**
 * Núcleo COMPARTILHADO do Índice de mercado (usado pelo endpoint indice-mercado.js e pelo
 * cron indice-reforco-cron.js): montagem do prompt de busca arrojada, parsing e normalização
 * das amostras no formato do ingerir_amostras_indice. SEM efeitos colaterais (não fala com
 * banco nem com a Anthropic) — só funções puras, para o reforço reusar a MESMA lógica do
 * gerador ao vivo e nunca divergir.
 */

export const SEG_TIPOS = ['apartamento', 'casa', 'terreno', 'comercial'];

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Guarda DETERMINÍSTICA anti-leilão (o LLM às vezes inclui um comparável de leilão/Caixa apesar
// do prompt; o preço fica 30–60% abaixo e contamina o índice). Barra pela fonte.
export const FONTE_LEILAO = /leil[ãa]o|arremat|hasta.?p[uú]bl|\bcef\b|caixa\s*econ|aliena[çc]|extrajud|retomad|venda\s*direta|megaleil|zukerman|foreclos/i;

export function extractText(data) {
  try { return (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'); } catch { return ''; }
}

export function parseJSON(txt) {
  if (!txt) return null;
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (fence ? fence[1] : txt).trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

// Um imóvel "todos" faz UMA busca ampla cobrindo os 4 tipos (economia do dono: "puxar tudo o
// que tiver anunciado e a IA só filtra e organiza a cada raio"), com o tipo em CADA amostra.
export const promptIndice = ({ endereco, condominio, bairro, tipo, cidade, uf, compacto = false }) => {
  const todos = tipo === 'todos';
  const cidadeInteira = !endereco && !condominio && !bairro;
  const alvo = todos ? 'de TODOS os tipos (apartamento, casa, terreno, comercial)' : `para o imóvel do tipo "${tipo}"`;
  // MODO COMPACTO — a 2ª tentativa (quando a 1ª falha ou volta com JSON truncado) pede MENOS
  // amostras. Antes ela repetia o mesmo pedido "traga o máximo, não resuma" com menos buscas:
  // se a causa era resposta grande demais para caber, truncava de novo e o usuário via
  // "a pesquisa falhou" sem nenhuma pista. Melhor um índice com 8 amostras do que nenhum.
  const regraTipo = todos
    ? (compacto
      ? '- Cubra os 4 tipos (apartamento, casa, terreno, comercial). Em CADA amostra informe "tipo": exatamente um de apartamento|casa|terreno|comercial. Traga até 8 amostras por tipo por nível — priorize as MAIS PRÓXIMAS e RECENTES. Resposta enxuta: é melhor entregar menos amostras completas do que uma lista longa cortada no meio.'
      : '- Cubra os 4 tipos (apartamento, casa, terreno, comercial). Em CADA amostra informe "tipo": exatamente um de apartamento|casa|terreno|comercial (sem variações). Traga o MÁXIMO de amostras REAIS que encontrar (idealmente 12 a 18 por tipo por nível) — quanto mais anúncios ativos, mais fiel o índice. NÃO resuma nem corte a lista.')
    : (compacto
      ? `- SÓ o MESMO TIPO (${tipo}). Traga até 12 amostras por nível — priorize as MAIS PRÓXIMAS e RECENTES. Resposta enxuta: é melhor entregar menos amostras completas do que uma lista longa cortada no meio.`
      : `- SÓ o MESMO TIPO (${tipo}). Descarte tipos diferentes. Traga o MÁXIMO de amostras REAIS (idealmente 20 a 30 por nível) — não resuma nem limite a lista; quanto mais anúncios ativos, melhor o índice.`);
  const campoTipo = todos ? '"tipo":"apartamento",' : '';
  const niveis = cidadeInteira
    ? `- NÍVEL 1: bairros CENTRAIS / mais valorizados de ${cidade}.
- NÍVEL 2: DEMAIS bairros de ${cidade}.
Como NÃO há endereço/bairro específico, MAPEIE A CIDADE INTEIRA: traga amostras de VÁRIOS bairros diferentes (não concentre num só) para cobrir a cidade.`
    : `- NÍVEL 1: ${condominio ? `MESMO condomínio/empreendimento "${condominio}" (ou o quarteirão)` : bairro ? `bairro "${bairro}"` : 'mesmo condomínio/rua'} — raio de ~250m${endereco ? ' do endereço' : ''}.
- NÍVEL 2: ${bairro ? `bairros vizinhos a "${bairro}"` : 'bairro e adjacências'} (~1km).`;
  return `Você é um perito avaliador imobiliário. Pesquise o MERCADO LIVRE de VENDA e LOCAÇÃO ${alvo} em ${endereco || bairro || cidade}, ${cidade}/${uf}, em DOIS NÍVEIS:
${niveis}

REGRAS:
${regraTipo}
- SÓ MERCADO LIVRE: descarte QUALQUER leilão, praça, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou retomado (preços 30–60% abaixo contaminam o índice).
- Priorize anúncios RECENTES (≤12 meses). Capture a data de cada amostra.
- SEJA ARROJADO: faça VÁRIAS buscas nos portais e VÁRIAS PÁGINAS de resultados (ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Chaves na Mão, Loft, e imobiliárias LOCAIS de ${cidade}). Percorra faixas de preço/tamanho DIFERENTES para não trazer só um padrão — pegue do POPULAR ao ALTO padrão da cidade.
- Informe o BAIRRO de cada amostra (essencial para classificar a cidade por região).${cidadeInteira ? ' TRAGA amostras de bairros DIFERENTES.' : ''}
- Mesmo em CIDADE PEQUENA há anúncios: pesquise "${cidade} ${uf}" + o tipo nesses portais e TRAGA o que encontrar — NÃO retorne listas vazias se existir qualquer anúncio real de mercado (venda/locação). Terreno costuma ter R$/m² BAIXO (ex.: 100–400 R$/m²): isso é normal, capture assim mesmo.

Para CADA amostra capture o MÁXIMO de referência de localização que o anúncio der (traga o que houver — não invente): ${todos ? 'tipo (apartamento|casa|terreno|comercial); ' : ''}bairro (nome do bairro); condominio (nome do condomínio/empreendimento/edifício, se o anúncio citar — âncora precisa); endereco (logradouro + número; ou só o logradouro se não houver número); cep (só os dígitos, se houver); valorM2 (R$/m² de VENDA) nas vendas; aluguelM2 (R$/m²/mês) nas locações; area (m²); data (formato "AAAA-MM"); fonte (portal ou imobiliária); link (URL do anúncio).

ÂNCORA DE LOCALIZAÇÃO (obrigatória): cada amostra precisa de PELO MENOS o "bairro". Sempre que o
anúncio mostrar o logradouro ou o nome do empreendimento — o ZAP/VivaReal costumam exibir a rua no
título ou logo abaixo dele ("Alameda X", "Edifício Y") — traga em "endereco"/"condominio". É essa
âncora que posiciona a amostra no mapa; sem ela o anúncio só conta como média da cidade e perde o
recorte de 250 m. NÃO invente rua: se o anúncio não disser, deixe "".

LINK (obrigatório quando houver): "link" com a URL do anúncio que você abriu. É o que torna a
amostra auditável e re-lível depois; sem link não há como conferir o número.

Retorne SOMENTE JSON válido, sem texto fora do JSON:
{"nivel1":{"vendas":[{${campoTipo}"bairro":"","condominio":"","endereco":"","cep":"","valorM2":0,"area":0,"data":"AAAA-MM","fonte":"","link":""}],"locacoes":[{${campoTipo}"bairro":"","condominio":"","endereco":"","cep":"","aluguelM2":0,"area":0,"data":"AAAA-MM","fonte":"","link":""}]},"nivel2":{"vendas":[],"locacoes":[]}}`;
};

// Monta as amostras (venda e locação) no formato do ingerir_amostras_indice, com fonte_ref
// determinístico (dedup entre re-buscas): regiao|tipo|natureza|valorM2|area.
export function montarAmostras(mercado, ctx) {
  const out = [];
  const dataOk = (d) => (/^\d{4}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 7) + '-01' : null);
  const canonTipo = (t) => {
    const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/apart|apto|\bap\b|flat|kitn|studio|loft/.test(s)) return 'apartamento';
    if (/casa|sobrado|condomin|residenc|geminad/.test(s)) return 'casa';
    if (/terren|lote|\barea\b|gleba|chacara|sitio|fazend|rural/.test(s)) return 'terreno';
    if (/comerci|industri|loja|\bsala\b|galp|ponto|escritor|predio|barrac/.test(s)) return 'comercial';
    if (SEG_TIPOS.includes(s)) return s;
    return null;
  };
  const tipoDe = (s) => ctx.todos ? canonTipo(s?.tipo) : ctx.tipo;
  const bairroDe = (s) => norm(s?.bairro) || ctx.bairroNorm || null;
  const cepDe = (s) => (String(s?.cep || '').replace(/\D/g, '').slice(0, 8) || null);
  const endDe = (s) => (String(s?.endereco || '').trim().slice(0, 180) || null);
  const condDe = (s) => (String(s?.condominio || '').trim().slice(0, 140) || null);
  const urlDe = (s) => { const u = String(s?.link || s?.url || '').trim().slice(0, 500); return /^https?:\/\//i.test(u) ? u : null; };
  // A COORDENADA DA CONSULTA NÃO É A DA AMOSTRA (achado 06/08). Toda amostra nascia carimbada com
  // o lat/lng do endereço CONSULTADO — 85 anúncios de 4 bairros de Brasília no MESMO ponto. Dois
  // efeitos: o recorte de 250 m/1 km virava ficção (na consulta seguinte daquele endereço TODAS
  // apareciam coladas) e o cron de triangulação, que só pega `lat is null`, nunca via essas linhas
  // — o pipeline de posição existia inteiro e estava desligado nas duas pontas. Agora a amostra
  // nasce SEM coordenada: quem tem âncora (endereço/condomínio/CEP) é geocodificado pelo
  // indice-geocodificar-cron; quem só tem bairro casa por TEXTO, que já vale nível 1. É a mesma
  // regra do acervo: rotular pelo que se sabe, não pelo que se pediu.
  const linha = (s, natureza, vm2) => ({ cidade_norm: ctx.cidadeNorm, uf: ctx.uf, bairro_norm: bairroDe(s),
    lat: null, lng: null, tipo: tipoDe(s), origem: 'pesquisa_web', natureza, valor_m2: vm2, area_m2: s?.area || null,
    cep: cepDe(s), endereco: endDe(s), condominio: condDe(s), url: urlDe(s) });
  for (const nivel of [1, 2]) {
    const bloco = mercado?.[`nivel${nivel}`] || {};
    for (const v of (bloco.vendas || [])) {
      const vm = Number(v?.valorM2); const tp = tipoDe(v); const brr = bairroDe(v) || '';
      if (tp && vm > 0 && !FONTE_LEILAO.test(String(v?.fonte || ''))) out.push({ ...linha(v, 'venda', vm), nivel, data_anuncio: dataOk(v?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${brr}|${tp}|venda|${Math.round(vm)}|${Math.round(Number(v?.area) || 0)}|${dataOk(v?.data) || ''}` });
    }
    for (const l of (bloco.locacoes || [])) {
      const am = Number(l?.aluguelM2); const tp = tipoDe(l); const brr = bairroDe(l) || '';
      // TERRENO NÃO TEM MERCADO DE LOCAÇÃO (regra do dono, 03/08): lote não se aluga; o que
      // os portais devolvem como "terreno para alugar" é outro produto (pátio, área de
      // evento) e contamina o Índice do tipo. O gerar-analise já aplicava essa regra, mas
      // ESTE coletor (botão "Gerar índice") não — e por aqui entrou "locação de terreno a
      // R$ 4/m²·mês" em Barueri, puxando a média do tipo para baixo. Mesma regra nos dois.
      if (tp === 'terreno') continue;
      if (tp && am > 0 && am < 500 && !FONTE_LEILAO.test(String(l?.fonte || ''))) out.push({ ...linha(l, 'locacao', am), nivel, data_anuncio: dataOk(l?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${brr}|${tp}|locacao|${am}|${Math.round(Number(l?.area) || 0)}|${dataOk(l?.data) || ''}` });
    }
  }
  return out;
}
