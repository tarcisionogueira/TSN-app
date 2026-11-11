// Teste do parser da API da Montenegro (11/11) com o formato medido ao vivo. node scripts/testes/montenegro-api.mjs
import { lotesDaApi, coordDoMapa, modalidadeDe, dataIso, textoDescricao } from '../lib/montenegro-api.mjs';
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.error('✗', m); } else console.log('✓', m); };

const iframeSV = '&lt;iframe src=\\"https://www.google.com/maps/embed?pb=!4v1793218285437!6m8!1m7!1sRAr!2m2!1d-5.58871165564995!2d-39.37328337779357!3f258\\"&gt;&lt;/iframe&gt;<p>Imóvel comercial.</p>';
const iframeMapa = '<iframe src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d1948.51!2d-38.456575774345595!3d-3.7756434231236815!2m3"></iframe><p>Terreno.</p>';
const json = { status: 'ok', qtd: 2, leiloes: {
  0: { id: 1, titulo: 'Extra', data_hora_inicio: '2026-11-27 10:00:00', data_hora_inicio_segundo_leilao: null, url: 'https://montenegroleiloes.com.br/leiloes/1', tipo_leilao: 'Extra-Judicial', edital: null,
    arquivos_do_leilao: [{ descricao: 'Edital do leilão', url: 'https://montenegroleiloes.com.br/midia/e1' }],
    lotes: [
      { id: 10, url: 'https://montenegroleiloes.com.br/leiloes/1/lotes/10', titulo: 'Imóvel Comercial no Centro, em Senador Pompeu/CE.', descricao: iframeSV, lance_minimo: '300000', avaliacao_comitente: null, lance_minimo_segundo_leilao: null, status_lote: { identificador: 'ABERTO' }, imagens_lote: [{ url_imagem: 'https://x/f1' }, { url_imagem: 'https://x/f2' }], vistoria_imobiliaria: { tamanho: '960', subcategoria_imobiliaria: { nome: 'Comerciais' } } },
      { id: 11, url: 'u11', titulo: 'Terreno no Edson Queiroz, em Fortaleza/CE', descricao: iframeMapa, lance_minimo: '90000', avaliacao_comitente: '180000', status_lote: { identificador: 'ABERTO' }, imagens_lote: [], vistoria_imobiliaria: { subcategoria_imobiliaria: { nome: 'Terrenos' } } },
      { id: 12, url: 'u12', titulo: 'Sala em Fortaleza/CE', descricao: '', lance_minimo: '50000', status_lote: { identificador: 'RETIRADO' }, imagens_lote: [], vistoria_imobiliaria: {} },
    ] },
  1: { id: 2, titulo: 'TJCE', data_hora_inicio: '2026-12-01 10:00:00', url: 'l2', tipo_leilao: 'TJCE', lotes: [
      { id: 20, url: 'u20', titulo: 'Imóvel Rural em Mombaça/CE', descricao: '<p><strong>Processo Judicial:</strong> 0006497-47.2013.8.06.0126 (PJe). Matrícula nº 1.234.</p>', lance_minimo: '120000', status_lote: { identificador: 'ABERTO' }, imagens_lote: [], vistoria_imobiliaria: { subcategoria_imobiliaria: { nome: 'Rurais' } } },
      { id: 21, url: 'u21', titulo: 'Prédio comercial em Bela Vista, São Paulo/SP', descricao: iframeMapa, lance_minimo: '4500000', status_lote: { identificador: 'ABERTO' }, imagens_lote: [], vistoria_imobiliaria: { subcategoria_imobiliaria: { nome: 'Comerciais' } } },
    ] },
} };

const { rows, resumo } = lotesDaApi(json);
const por = Object.fromEntries(rows.map((r) => [r.fonte_id, r]));
ok(resumo.lotes === 5 && resumo.abertos === 4, `contagem (${JSON.stringify(resumo)})`);
ok(!por.montenegro_12, 'RETIRADO fica fora');
ok(por.montenegro_10?.cidade === 'Senador Pompeu' && por.montenegro_10?.estado === 'CE', `cidade do título (${por.montenegro_10?.cidade})`);
ok(por.montenegro_10?.tipo === 'comercial' && por.montenegro_10?.modalidade === 'extrajudicial', 'tipo e modalidade');
ok(por.montenegro_10?.latitude === -5.58871165564995 && por.montenegro_10?.geocod_nivel === 'endereco', 'pino do Street View');
ok(por.montenegro_11?.latitude === -3.7756434231236815 && por.montenegro_11?.longitude === -38.456575774345595, 'pino do mapa (2d=lng, 3d=lat)');
ok(por.montenegro_11?.desconto_percentual === 50, 'desconto com avaliação');
ok(por.montenegro_21 && !('latitude' in por.montenegro_21), 'pino de Fortaleza num lote de São Paulo é descartado');
ok(por.montenegro_20?.numero_processo === '0006497-47.2013.8.06.0126' && por.montenegro_20?.numero_matricula === '1234', 'processo e matrícula');
ok(por.montenegro_20?.modalidade === 'judicial' && por.montenegro_20?.data_leilao === '2026-12-01T10:00:00-03:00', 'judicial e data com fuso');
ok(por.montenegro_10?.fotos?.length === 2 && por.montenegro_10?.link_foto === 'https://x/f1', 'fotos');
ok(por.montenegro_10?.anexos?.[0]?.tipo === 'edital' && por.montenegro_10?.link_edital === 'https://montenegroleiloes.com.br/midia/e1', 'edital do leilão');
ok(!/iframe|google\.com/.test(por.montenegro_10?.descricao || 'x'), 'descrição sem o iframe');
ok(modalidadeDe('Particular') === 'venda_direta' && dataIso(null) === null && coordDoMapa('') === null && textoDescricao('') === '', 'auxiliares');
let lancou = false; try { lotesDaApi({ status: 'erro' }); } catch { lancou = true; }
ok(lancou, 'API sem lista LANÇA (não vira acervo vazio)');
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log('ok — montenegro-api');
