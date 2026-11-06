-- LACUNA DE CAPTAÇÃO POR LEILOEIRO (06/11, pedido do dono): "quantos lotes o site lista × quantos estão no acervo".
-- (Nome: `fonte_cobertura()` já existe e mede outra coisa — % de campos preenchidos por fonte. Não confundir.)
-- Nasceu do mapeamento da SOLEON: Site Leilões listava 595 e o acervo tinha 300; João Emílio 462 × 197 — a lista já
-- era lida inteira e o número estava em fonte_saude.enumerados desde outubro, mas ninguém cruzava com o acervo.
-- security invoker: quem chama só enxerga o que a RLS já lhe dá (anon não lê fonte_saude). Leitura (custo zero): select * from public.fonte_captacao_lacuna();
-- ⚠️ Forma nº 10: `enumerados` é o que CADA coletor conta na listagem — pode incluir lote sustado/encerrado, outra
-- categoria (ex.: o feed inteiro de bens) ou gêmeo da Caixa escondido de propósito. Linha aqui é SUSPEITA a
-- conferir no coletor, não prova de perda. Fontes *_VEICULOS cruzam com veiculos_leilao (fonte sem o sufixo).
create or replace function public.fonte_captacao_lacuna(p_min int default 20, p_pct numeric default 85)
returns table (fonte text, no_site int, no_acervo bigint, faltam bigint, pct numeric, medido_em timestamptz, status text)
language sql stable security invoker set search_path = public as $$
  with ult as (
    select distinct on (s.fonte) s.fonte, s.enumerados, s.executado_em, s.status
      from fonte_saude s
     where s.enumerados is not null and s.status <> 'sem_cota' and s.executado_em > now() - interval '10 days'
     order by s.fonte, s.executado_em desc),
  im as (select i.fonte, count(*) n from imoveis_leilao i where i.ativo group by 1),
  ve as (select v.fonte, count(*) n from veiculos_leilao v where v.ativo group by 1)
  select u.fonte, u.enumerados,
         coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0) as no_acervo,
         u.enumerados - coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0) as faltam,
         round(100.0 * coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0) / nullif(u.enumerados, 0)) as pct,
         u.executado_em, u.status
    from ult u
    left join im on im.fonte = u.fonte
    left join ve on ve.fonte = replace(u.fonte, '_VEICULOS', '')
   where u.enumerados >= p_min
     and coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0) < u.enumerados * p_pct / 100.0
   order by 4 desc;
$$;
