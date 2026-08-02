-- CEF: lote que VOLTA ao CSV da Caixa precisa voltar a aparecer no app.
--
-- Bug (achado no ritual de 02/08): `desativar_imoveis_cef_vencidos` tira do ar o lote
-- que ficou obsoleto (não veio no último sweep do seu estado) — correto. Mas o upsert
-- do scraper da CEF (scripts/scraper.js → salvarImoveis) NÃO escreve a coluna `ativo`,
-- então o lote que reaparece no CSV é atualizado (atualizado_em, preço, foto...) e
-- continua `ativo=false` PARA SEMPRE — invisível na busca, no Índice e no e-mail de
-- oportunidades, mesmo estando à venda na Caixa.
-- O scraper dos leiloeiros já faz certo (`scraper-puppeteer.mjs`: `ativo: true,
-- // coletado agora ⇒ está ativo (reativa lotes que voltaram)`); só a CEF ficou de fora.
--
-- Medição em 02/08 (CSV do dia = 27.278 lotes): 5.025 (18,4%) estavam `ativo=false`
-- com `status='disponivel'` — acervo perdido em TODOS os estados (GO 1.070, RJ 967, SP 760).
--
-- 1) RPC chamada pelo scraper a cada lote salvo: reativa SÓ o que veio no CSV agora.
--    Guarda: `status='disponivel'` preserva o lote marcado como ARREMATADO pelo cliente
--    (api/arrematacoes.js grava status='arrematado' + ativo=false) — esse não volta.
create or replace function public.reativar_imoveis_cef(p_fonte_ids text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  update imoveis_leilao
     set ativo = true
   where fonte = 'CEF'
     and ativo = false
     and status = 'disponivel'
     and fonte_id = any (p_fonte_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Só o backend (service_role) chama — mesma postura das demais RPCs de manutenção,
-- para não abrir superfície nova ao anon/authenticated (auditoria_seguranca()).
revoke all on function public.reativar_imoveis_cef(text[]) from public;
revoke all on function public.reativar_imoveis_cef(text[]) from anon;
revoke all on function public.reativar_imoveis_cef(text[]) from authenticated;
grant execute on function public.reativar_imoveis_cef(text[]) to service_role;

-- 2) Backfill (idempotente): devolve ao ar os lotes que vieram no ÚLTIMO sweep da CEF
--    e estavam apagados por este bug. A janela (último `fonte_saude` ok da CEF menos
--    90 min) cobre o run inteiro — nenhum lote fora do CSV é tocado.
update imoveis_leilao t
   set ativo = true
 where t.fonte = 'CEF'
   and t.ativo = false
   and t.status = 'disponivel'
   and t.atualizado_em >= (
     select max(s.executado_em) - interval '90 minutes'
       from fonte_saude s
      where s.fonte = 'CEF' and s.status = 'ok'
   );
