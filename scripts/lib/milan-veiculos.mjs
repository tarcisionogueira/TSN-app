/**
 * MILAN — VEÍCULOS (16/11, pedido do dono: "inclua a coleta de veículos do Milan"). Puro, sem rede.
 *
 * Fonte: catálogo JSON da siteback (lib/milan-siteback.mjs#catalogoSiteback). Cada lote traz título com marca/modelo/
 * ano, descrição com KM e condições, `minimo`, foto (`fotoThumbnail.arquivoFoto` no repositório `adm…/Fotos/{localFotos}/`).
 * A conversão para `veiculos_leilao` é a de TODOS os coletores (lib/veiculo-do-lote.mjs): pátio pelo classificador
 * único, só veículo inteiro (empilhadeira fica fora), SEM VALOR NÃO GRAVA.
 *
 * Medido em 16/11: no leilão semanal (15692) só 57 de 209 lotes têm `minimo` publicado; no da Ford (15698), 0 de 51.
 * O resto sai com `minimo: 0` — a Milan não divulga o lance inicial desses. Cada rodada diária relê o catálogo,
 * então o lote entra quando o mínimo aparecer.
 *
 * CICLO DO EVENTO (dono, 16/11): o leilão semanal zera de quarta para quinta e reabastece na segunda. Lote de evento
 * que saiu da agenda depois da data dele é desligado por quem chama (`eventosEncerrados`).
 */
import { veiculoDoLote } from './veiculo-do-lote.mjs';

export const FONTE = 'MILAN';
const BASE = 'https://milanleiloes.com.br';
const ADM = 'https://adm.milanleiloes.com.br';

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
export function textoLimpo(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTIDADES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}

// UF do pátio. O local do leilão de veículos é "Rod. Raposo Tavares - Km 20…": a Raposo Tavares é a SP-270, toda
// dentro de SP — UF certa; a CIDADE não vem escrita e não é inventada.
export function ufDoLocal(local) {
  const s = String(local || '');
  const m = s.match(/(?:[-/,]\s*|\s)([A-Z]{2})\s*\.?\s*$/);
  if (m) return m[1];
  if (/raposo\s+tavares/i.test(s)) return 'SP';
  return null;
}

/** Lote encerrado/retirado não entra (o catálogo continua listando depois do pregão). */
export function loteDisponivel(l) {
  return !!l && !l.retirado && !l.naoVendido && !l.vendaRecusada && l.venda == null && Number(l.estadoLote) === 101;
}

/**
 * evento = detalhe/agenda da siteback (codLeilao, dataInicio, localLeilao, localFotos, nProcesso, comitentes)
 * l      = item de `lotes.conteudo`
 * → { row } para veiculos_leilao, ou { motivo }.
 */
export function veiculoMilan(evento, l) {
  if (!loteDisponivel(l)) return { motivo: 'lote encerrado/retirado' };
  const cod = String(evento.codLeilao);
  const descricao = textoLimpo(l.descricao);
  const km = Number(l.quilometragem) > 0 && !/\bkm\s*:/i.test(descricao) ? ` KM: ${l.quilometragem}` : '';
  const foto = l.fotoThumbnail?.arquivoFoto && evento.localFotos ? `${ADM}/Fotos/${evento.localFotos}/${l.fotoThumbnail.arquivoFoto}` : null;
  const judicial = !!String(evento.nProcesso || '').trim();
  // Visitação do EVENTO ("Dias 16 e 17 de novembro… no local do leilão" + "Rod. Raposo Tavares - Km 20"): os lotes
  // ficam no pátio da Milan. Sem isto o classificador único não vê local nenhum e grava `indefinido`, que a busca
  // esconde (dry-run de 16/11: 55 de 55). Com o local informado, vira `nao_confirmado` (aparece com selo).
  const visita = [textoLimpo(evento.visitacao), textoLimpo(evento.localLeilao)].filter(Boolean).join(' — ').replace(/\.+$/, '');
  const base = {
    titulo: textoLimpo(l.titulo), descricao: `${descricao}${km}${visita ? ` Visitação: ${visita}.` : ''}`,
    valor_minimo: Number(l.minimo) > 0 ? Number(l.minimo) : null, valor_avaliacao: null,
    cidade: null, estado: ufDoLocal(evento.localLeilao),
    url_lote: `${BASE}/leilao/${cod}/lote/${l.lote}`, link_foto: foto,
    data_leilao: evento.dataInicio || null, leiloeiro: 'Milan Leilões',
    modalidade: judicial ? 'judicial' : 'extrajudicial',
  };
  return veiculoDoLote(base, { id: `${cod}_${l.lote}`, fonte: FONTE });
}

/** Códigos de evento dos lotes ativos que o site não lista mais e cuja data já passou → desligar. */
export function eventosEncerrados(ativos, codsNaAgenda, agora = Date.now()) {
  const fora = new Set();
  for (const v of ativos) {
    const cod = (String(v.fonte_id).match(/^milan_veic_(\d+)_/) || [])[1];
    if (!cod || codsNaAgenda.has(cod)) continue;
    if (v.data_leilao && Date.parse(v.data_leilao) < agora) fora.add(cod);
  }
  return fora;
}
