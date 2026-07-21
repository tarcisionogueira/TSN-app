-- Item 3: CRUZAR edital (DJEN) + scraper do leiloeiro pela CHAVE DO PROCESSO (CNJ) e preencher,
-- DE GRAÇA, avaliação/área/endereço/cidade que faltam no acervo. Antes só casava por lance ==
-- valor mínimo (fraco). Agora: (A) match FORTE por nº de processo → completa o que faltar do
-- edital do DJEN; (B) mantém o match por lance == mínimo como reforço p/ a avaliação. Trava de
-- credibilidade: nunca preenche avaliação que gere desconto >= 88% (aval > 8,3x o mínimo).
create or replace function public.editais_enriquecer_acervo()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n1 integer := 0; n2 integer := 0;
begin
  -- (A) MATCH FORTE por número de processo (CNJ, só dígitos, completo). Preenche o que FALTA.
  with m as (
    select distinct on (i.id) i.id as imovel_id,
       e.valor_avaliacao as aval, e.imovel_area_m2 as area,
       e.imovel_endereco as endereco, e.imovel_cidade as cidade
    from public.imoveis_leilao i
    join public.editais_leilao e
      on regexp_replace(coalesce(e.numero_processo,''),'\D','','g') = regexp_replace(coalesce(i.numero_processo,''),'\D','','g')
     and length(regexp_replace(coalesce(i.numero_processo,''),'\D','','g')) >= 18   -- nº CNJ completo (20 díg.)
    where i.ativo
      and (coalesce(i.valor_avaliacao,0)=0 or coalesce(i.area_m2,0)=0 or coalesce(i.endereco,'')='')
    order by i.id, e.data_disponibilizacao desc
  )
  update public.imoveis_leilao i set
    valor_avaliacao = case
      when coalesce(i.valor_avaliacao,0)=0 and coalesce(m.aval,0) > 0
       and (coalesce(i.valor_minimo,0) <= 0 or m.aval <= i.valor_minimo * 8.3)   -- trava desconto 88%
      then m.aval else i.valor_avaliacao end,
    area_m2 = case when coalesce(i.area_m2,0)=0 and coalesce(m.area,0) > 0 then m.area else i.area_m2 end,
    endereco = case when coalesce(i.endereco,'')='' and coalesce(m.endereco,'')<>'' then m.endereco else i.endereco end,
    cidade = case when coalesce(i.cidade,'')='' and coalesce(m.cidade,'')<>'' then m.cidade else i.cidade end
  from m where i.id = m.imovel_id;
  get diagnostics n1 = row_count;

  -- recomputa desconto/viabilidade onde a avaliação acabou de ser preenchida.
  update public.imoveis_leilao i
  set desconto_percentual = round((1 - i.valor_minimo/i.valor_avaliacao)*100),
      viavel = ((1 - i.valor_minimo/i.valor_avaliacao) >= 0.3),
      score_viabilidade = least(100, round((1 - i.valor_minimo/i.valor_avaliacao)*150))
  where i.ativo and i.valor_avaliacao > 0 and i.valor_minimo > 0 and i.desconto_percentual is null;

  -- (B) MATCH por lance == valor mínimo (chave existente), só p/ avaliação ainda faltante.
  --     Coerência: avaliação entre o mínimo e 8x o mínimo (equivale à trava de desconto 88%).
  with m2 as (
    select distinct on (i.id) i.id as imovel_id, e.valor_avaliacao as aval
    from public.imoveis_leilao i
    join public.editais_leilao e
      on e.valor_avaliacao > 0 and e.lance_minimo > 10000
     and i.valor_minimo = e.lance_minimo
     and e.valor_avaliacao between i.valor_minimo and i.valor_minimo*8
    where i.ativo and coalesce(i.valor_avaliacao,0)=0
    order by i.id, e.data_disponibilizacao desc
  )
  update public.imoveis_leilao i
  set valor_avaliacao = m2.aval,
      desconto_percentual = round((1 - i.valor_minimo/m2.aval)*100),
      viavel = ((1 - i.valor_minimo/m2.aval) >= 0.3),
      score_viabilidade = least(100, round((1 - i.valor_minimo/m2.aval)*150))
  from m2 where i.id = m2.imovel_id;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $fn$;
revoke execute on function public.editais_enriquecer_acervo() from public, anon, authenticated;
grant execute on function public.editais_enriquecer_acervo() to service_role;
