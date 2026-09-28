-- ─────────────────────────────────────────────────────────────────────────────────────────
-- "ZEROU" DECLARADO PELO PRÓPRIO SITE NÃO É REGRESSÃO — 28/09/2026
--
-- JOAOEMILIO saiu como `zerou` (mediana 174 → 0). Conferido na fonte (pg_net, 28/09): a busca
-- do site diz "NENHUM LOTE ENCONTRADO NO MOMENTO" e a home não tem link de lote — o leiloeiro
-- fez o evento de 14/09 e não publicou o próximo. O monitor não tinha como separar "zero que o
-- site afirma" de "zero porque o parser quebrou". Agora o coletor grava o motivo
-- "site declara ..." e esta função não acusa `zerou` quando a ÚLTIMA medição diz isso.
-- (Mesmo princípio do LEILOFY de 27/08: consertar parser são é o pior desfecho de um alarme.)
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'fonte_regressao_suspeita' and p.pronamespace = 'public'::regnamespace;
  if position('motivo_saude' in d) > 0 then return; end if;
  if position('select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em from public.fonte_saude s' in d) = 0
     or position('u.total, u.status, u.executado_em,' in d) = 0
     or position('when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 then ''zerou''' in d) = 0 then
    raise exception 'fonte_regressao_suspeita: âncoras não encontradas';
  end if;
  d := replace(d, 'select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em from public.fonte_saude s',
                  'select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em, s.motivo from public.fonte_saude s');
  d := replace(d, 'u.total, u.status, u.executado_em,', 'u.total, u.status, u.executado_em, u.motivo as motivo_saude,');
  d := replace(d, 'when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 then ''zerou''',
                  'when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 and coalesce(u.motivo_saude, '''') not ilike ''site declara%'' then ''zerou''');
  execute d;
end $$;
