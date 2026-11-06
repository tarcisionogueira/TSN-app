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
  -- `no_acervo` = captado: ativo no acervo + escondido por regra + recusado com motivo (abaixo).
  im as (select i.fonte, count(*) n from imoveis_leilao i where i.ativo group by 1),
  -- Veículo escondido por REGRA (sucata etc., suprimido_motivo) conta como captado: foi lido e recusado de propósito.
  ve as (select v.fonte, count(*) n from veiculos_leilao v where v.ativo or v.suprimido_motivo is not null group by 1),
  -- Lote LIDO e RECUSADO com motivo (encerrado, não-imóvel, fração ideal…) também foi captado: a memória #238 guarda
  -- o porquê. Sem isto DH (124 encerrados), Vianna (102 não-imóveis) e Curiaú (140) pareciam perda. Exceção:
  -- 'descartado: valor' NÃO desconta — é o parser que não achou o preço, pode ser defeito (Bolsa: 260 em 06/11).
  rc as (select r.fonte, count(*) n from coleta_lote_recusado r where r.motivo not like 'descartado: valor%' group by 1),
  acv as (
    select u.fonte, u.enumerados, u.executado_em, u.status,
           coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0)
             + case when u.fonte like '%\_VEICULOS' then 0 else coalesce(rc.n, 0) end as n
      from ult u
      left join im on im.fonte = u.fonte
      left join ve on ve.fonte = replace(u.fonte, '_VEICULOS', '')
      left join rc on rc.fonte = u.fonte)
  select a.fonte, a.enumerados, least(a.n, a.enumerados)::bigint as no_acervo,
         greatest(a.enumerados - a.n, 0)::bigint as faltam,
         round(100.0 * least(a.n, a.enumerados) / nullif(a.enumerados, 0)) as pct,
         a.executado_em, a.status
    from acv a
   where a.enumerados >= p_min
     -- 'vazio' = o coletor leu tudo e o site não tinha nada arrematável (ex.: SAVOY 2.306 de 2.319 só para empresa
     -- credenciada). Recusa por regra, não perda — 06/11 a 1ª versão acusou SAVOY e SHIOKAWA (sucata) assim.
     and a.status <> 'vazio'
     and a.n < a.enumerados * p_pct / 100.0
   order by 4 desc;
$$;
