// OPORTUNIDADE SELECIONADA (07/11): o que a rota da equipe (api/oportunidades-cliente.js) e a do cliente
// (api/minhas-oportunidades.js) precisam ler do mesmo jeito. O texto que o cliente aceita mora aqui, no
// servidor, com versão: a decisão grava o texto exato e o hash dele. Mudou a redação? Suba a versão.
import { createHash } from 'node:crypto';
import { encerradoPorDatas } from './_leilao-encerrado.js';

export const VERSAO_TEXTOS = '2026-11-07';
export const AVISO_NAO_E_LANCE = 'Isso não é lance e não compra nada.';
export const TEXTOS_DECISAO = {
  aprovada: `Aprovo esta oportunidade para a reunião de apresentação. ${AVISO_NAO_E_LANCE} Nenhum lance será dado sem a minha autorização, individual e por escrito, com o valor máximo.`,
  recusada: `Recuso esta oportunidade. ${AVISO_NAO_E_LANCE} Nenhum lance será dado neste imóvel.`,
};
export const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

export const SEL_LOTE = 'id,titulo,endereco,cidade,estado,tipo,modalidade,valor_minimo,valor_minimo_ref,valor_avaliacao,desconto_percentual,data_leilao,data_leilao_2,data_fim,praca1_fim,praca2_fim,link_foto,fonte,latitude,longitude,score_financeiro,score_localizacao,ocupacao,forma_pagamento';

// A data que importa é a PRÓXIMA praça, não a 1ª (02/10, print do dono: lotes com 1ª praça em 22/09 e
// 2ª ainda por vir apareciam como "22/09/2026" — parecia leilão passado).
export function proximaPraca(im) {
  const agora = Date.now();
  const pracas = [[im.data_leilao, '1ª praça'], [im.data_leilao_2, '2ª praça']]
    .map(([d, rot]) => ({ t: Date.parse(d || ''), d, rot })).filter((x) => Number.isFinite(x.t));
  const futura = pracas.filter((x) => x.t >= agora - 12 * 3600e3).sort((a, b) => a.t - b.t)[0];
  if (futura) return { dataLeilao: futura.d, praca: pracas.length > 1 ? futura.rot : null };
  return { dataLeilao: im.data_fim || null, praca: im.data_fim ? 'encerra' : null };
}

export const valorDoLote = (im) => Number(im?.valor_minimo_ref ?? im?.valor_minimo) || null;

// Calculado na leitura, sem cron. `selecionada` vira:
//   aguardando       o cliente ainda pode decidir;
//   equipe_confere   o lote saiu do acervo: pode ser falha de coleta, então não dá para aprovar nem dar por vencido;
//   expirada         a última praça passou. Silêncio não é recusa (termo, 8.6): fica registrado como sem resposta.
export function estadoDaOportunidade(linha, loteVivo) {
  if (linha.status !== 'selecionada') return linha.status;
  if (!loteVivo || loteVivo.ativo === false) return 'equipe_confere';
  return encerradoPorDatas(loteVivo).encerrado ? 'expirada' : 'aguardando';
}

export function visaoDaOportunidade(linha, loteVivo) {
  const r = linha.retrato?.lote || {};
  const base = loteVivo || r;
  const valorRetrato = valorDoLote(r);
  const valorAtual = valorDoLote(loteVivo);
  return {
    id: linha.id, imovel_id: linha.imovel_id, status: linha.status, estado: estadoDaOportunidade(linha, loteVivo),
    titulo: r.titulo || r.tipo || 'Imóvel', cidade: r.cidade || null, uf: r.estado || null, tipo: r.tipo || null,
    modalidade: r.modalidade || null, ocupacao: r.ocupacao || null, foto: r.link_foto || null,
    valor: valorRetrato, avaliacao: Number(r.valor_avaliacao) || null, desconto: Number(r.desconto_percentual) || null,
    valor_atual: valorAtual && valorRetrato && valorAtual !== valorRetrato ? valorAtual : null,
    ...proximaPraca(base),
    motivo_equipe: linha.motivo_equipe, motivos: Array.isArray(linha.retrato?.motivos) ? linha.retrato.motivos : [],
    selecionada_em: linha.selecionada_em, decidida_em: linha.decidida_em, visto_em: linha.visto_em,
    motivo_recusa: linha.motivo_recusa, retirada_em: linha.retirada_em, retirada_motivo: linha.retirada_motivo,
    aviso_status: linha.aviso_status, selecionada_por_nome: linha.selecionada_por_nome,
  };
}
