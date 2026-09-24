-- ─────────────────────────────────────────────────────────────────────────────────────────
-- alerta_acima_do_capital: medir o valor QUE FOI ENVIADO, não o valor de hoje — 24/09/2026
--
-- O invariante acusava 3 envios acima do teto (faixa "ate_150k", teto R$ 200 mil): lotes de
-- R$ 202.589 (ZUK, 18/09) e R$ 220.636 (LEILAOBRASIL, 21/09, 2 clientes). Os 3 saíram de
-- `enviar-alertas-cron`, cuja rede de segurança final BARRA qualquer item acima de
-- `tetoPerfil` (= min(valorMax do filtro, TETO_FAIXA) = R$ 200 mil) — logo, no instante do envio,
-- o valor estava dentro do teto. O invariante comparava o valor ATUAL do lote
-- (`coalesce(i.valor_minimo_ref, i.valor_minimo)`): lote que ficou mais caro DEPOIS (praça
-- mais barata que saiu do anúncio, releitura) aparecia como envio errado. Forma nº 10: o número
-- media "quanto o lote custa hoje" e reportava como "o que mandamos acima do capital".
--
-- Conserto: o cron grava `valor_ref_enviado` (o valor que ele mesmo checou contra o teto) e o
-- invariante julga ESSE valor. Envios antigos, sem o valor gravado, não têm como ser julgados
-- e ficam fora da conta — em vez de acusados pelo valor de hoje.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.alertas_enviados add column if not exists valor_ref_enviado numeric;

do $do$
declare def text; velho text; novo text;
begin
  select pg_get_functiondef('public.qa_invariantes'::regproc) into def;
  velho := 'and coalesce(i.valor_minimo_ref, i.valor_minimo) > t.v), 0),';
  novo  := 'and ae.valor_ref_enviado > t.v), 0),';
  if position(novo in def) > 0 then raise notice 'ja aplicado'; return; end if;
  if (length(def) - length(replace(def, velho, ''))) / length(velho) <> 1 then
    raise exception 'trecho do alerta_acima_do_capital nao encontrado exatamente 1x — revise';
  end if;
  execute replace(def, velho, novo);
end $do$;
