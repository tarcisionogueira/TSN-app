-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VIGIA DE MARKETING QUE SE APAGAVA SOZINHO — 28/09/2026
--
-- mkt_ingestao_atrasada contava canal parado só com o último dia ENTRE D-10 e D-3
-- (`c.ult >= current_date - 10`). Google Ads (último dia 14/09) e Meta Ads (13/09) passaram de
-- 10 dias sem dado e o vigia voltou a "ok" — justo quando o problema ficou grave. Medido no
-- mesmo dia: visitas 2.091 → 598 → 111 → 14 por semana, cadastros 44 → 33 → 10 → 4, cliques
-- pagos do Google 0 desde 21/09. Ninguém foi avisado. Agora só sai da conta canal sem dado há
-- mais de 60 dias (aposentado de propósito); abaixo disso, silêncio é alarme.
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare d text; antes text := 'c.ult < current_date - 2 and c.ult >= current_date - 10), 0)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'qa_invariantes' and p.pronargs = 0 and p.pronamespace = 'public'::regnamespace;
  if position('c.ult < current_date - 2 and c.ult >= current_date - 60' in d) > 0 then return; end if;
  if position(antes in d) = 0 then raise exception 'qa_invariantes: âncora de mkt_ingestao_atrasada não encontrada'; end if;
  d := replace(d, antes, 'c.ult < current_date - 2 and c.ult >= current_date - 60), 0)');
  execute d;
end $$;
