/**
 * GOOGLE ADS SCRIPT — "BidPro — métricas diárias" (versão 2, 18/08)
 *
 * Cole este script no Google Ads (Ferramentas → Ações em massa → Scripts), SUBSTITUINDO o
 * script v1 já agendado — mesma agenda diária (07:00–08:00). O que muda: além das métricas
 * por campanha (comportamento idêntico ao v1), passa a enviar os TERMOS DE PESQUISA — o que
 * as pessoas de fato digitaram — para `marketing_termos_dia`. É o que permite auditar
 * desperdício (termo que gasta e não converte) direto do banco, sem abrir o painel.
 *
 * ⚠️ Troque SECRET pelo valor de ADS_INGEST_SECRET (painel da Vercel). NUNCA commite o valor.
 */
function main() {
  var URL = 'https://www.bidprobrasil.com.br/api/ads-metrics-ingest';
  var SECRET = 'COLE_AQUI_O_ADS_INGEST_SECRET';

  var tz = AdsApp.currentAccount().getTimeZone();
  var hoje = new Date();
  var ini = new Date(hoje.getTime() - 7 * 24 * 3600 * 1000); // 7 dias: reenvio corrige retroativo
  var de = Utilities.formatDate(ini, tz, 'yyyy-MM-dd');
  var ate = Utilities.formatDate(hoje, tz, 'yyyy-MM-dd');

  // ── Métricas diárias por campanha (idêntico ao v1) ──────────────────────────────
  var linhas = [];
  var q1 = "SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks, " +
           "metrics.impressions, metrics.conversions FROM campaign " +
           "WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'";
  var it1 = AdsApp.search(q1);
  while (it1.hasNext()) {
    var r = it1.next();
    linhas.push({
      data: r.segments.date, canal: 'Google Ads', campanha: r.campaign.name,
      gasto: Number(r.metrics.costMicros || 0) / 1e6,
      cliques: Number(r.metrics.clicks || 0),
      impressoes: Number(r.metrics.impressions || 0),
      conversoes: Number(r.metrics.conversions || 0),
    });
  }

  // ── Termos de pesquisa (novo na v2) ─────────────────────────────────────────────
  var termos = [];
  try {
    var q2 = "SELECT campaign.name, segments.date, search_term_view.search_term, " +
             "segments.keyword.info.text, metrics.cost_micros, metrics.clicks, " +
             "metrics.impressions, metrics.conversions FROM search_term_view " +
             "WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'";
    var it2 = AdsApp.search(q2);
    while (it2.hasNext() && termos.length < 500) {
      var t = it2.next();
      var kw = null;
      try { kw = t.segments.keyword && t.segments.keyword.info ? t.segments.keyword.info.text : null; } catch (e) {}
      termos.push({
        data: t.segments.date, campanha: t.campaign.name,
        termo: t.searchTermView.searchTerm,
        palavra_chave: kw,
        gasto: Number(t.metrics.costMicros || 0) / 1e6,
        cliques: Number(t.metrics.clicks || 0),
        impressoes: Number(t.metrics.impressions || 0),
        conversoes: Number(t.metrics.conversions || 0),
      });
    }
  } catch (e) {
    // Termos falharem não pode impedir as métricas: loga e segue só com `linhas`.
    Logger.log('termos de pesquisa falharam: ' + e);
  }

  if (!linhas.length && !termos.length) { Logger.log('Sem dados no período.'); return; }

  var resp = UrlFetchApp.fetch(URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ads-secret': SECRET },
    payload: JSON.stringify({ linhas: linhas, termos: termos }),
    muteHttpExceptions: true,
  });
  Logger.log('HTTP ' + resp.getResponseCode() + ' — ' + resp.getContentText().slice(0, 200));
}
