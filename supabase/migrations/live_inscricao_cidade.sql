-- Cidade e UF na inscrição (26/08, pedido do dono). Não é campo a mais por capricho: a
-- cidade permite abrir a plataforma na aula e buscar ONDE o público está, em vez de mostrar
-- São Paulo para uma sala cheia de gente da Bahia. E vira o primeiro filtro salvo do novo
-- usuário — quem entra sem região vê o acervo do país inteiro e não reconhece nada.
alter table public.live_inscricoes
  add column if not exists cidade text,
  add column if not exists uf text;

comment on column public.live_inscricoes.cidade is
  'Cidade declarada na inscrição. Alimenta perfis.endereco_cidade e diz em que praça o '
  'público está — dado que a aula ao vivo usa para buscar imóveis perto de quem assiste.';

create or replace function public.live_cidades(p_slug text)
returns table(cidade text, uf text, inscritos bigint)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(i.cidade,''), '(não informou)') as cidade,
         coalesce(nullif(i.uf,''), '') as uf, count(*) as inscritos
    from live_inscricoes i join eventos_live e on e.id = i.evento_id
   where e.slug = p_slug group by 1, 2 order by 3 desc;
$$;
revoke all on function public.live_cidades(text) from public, anon, authenticated;
