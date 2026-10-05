-- REGRA acervo.vaga_garagem (dono, 05/10): "vaga de garagem e box de garagem não são interessantes — remova
-- da base e não traga mais esse tipo de lote".
-- Só sai o lote que É a vaga. Apartamento/sala/cobertura COM vaga continua: o objeto da venda é a unidade.
-- Calibrada sobre o acervo ativo ANTES de aplicar (85 barrados em 17 fontes, amostra 100% vaga/box) e com 3
-- guardas que nasceram de casos reais:
--  · título que nomeia uma unidade (apartamento/casa/sala/loja/terreno/cobertura/conjunto comercial) = vaga é acessório;
--  · área ≥ 45 m² no título não é vaga — SUBLIME escreve "2 Vagas | Área privativa 166m²" para um APARTAMENTO;
--  · descrição que ABRE com a unidade ("MATRÍCULA: DIREITOS AQUISITIVOS SOBRE O APARTAMENTO Nº 44") = não é vaga.
-- "Chácara/sítio/fazenda" ficaram FORA da guarda do título: em título que começa por "Box", é nome de bairro
-- ("Box Nº 07 e 08 … Chácara das Pedras, Porto Alegre") — rural de verdade cai pela área.
-- Espelho JS: ehVagaGaragem em scripts/lib/scraper-core.mjs (teste: npm run testar:vaga-garagem). Mudou aqui → mude lá.
create or replace function public.vaga_garagem_barrada(p_titulo text, p_descricao text)
 returns boolean language plpgsql immutable set search_path to 'public' as $function$
-- Aplica a regra acervo.vaga_garagem: lote que E so vaga/box de garagem nao entra no acervo.
declare
  tit text := coalesce(p_titulo, '');
  t text;
  seg text;
  re_inicio text := '^((uma?|01|02|03|04|duas|tr[eê]s|[0-9]{1,2})\s*(\([^)]*\)\s*)?)?(vagas?|box(es)?|garage(m|ns))\M';
  m text[];
  area numeric;
  d text;
begin
  t := regexp_replace(lower(tit), '^\s*(\(?\s*lote\s*[0-9]+\s*\)?\s*[-:]?\s*|oportunidade\s*:\s*|im[oó]vel\s*:\s*|[-–:.\s]+|[0-9]+\s*[-–.)]\s+)*', '');
  seg := case when tit ~ '^[A-Z]{2}\s+-\s' and position('|' in tit) > 0 then btrim(lower(split_part(tit, '|', 2))) else '' end;
  if not (t ~ re_inicio or seg ~ re_inicio) then return false; end if;
  if tit ~* '(apartament|\mapto\M|\mcasa\M|sobrado|\msala\M|\mloja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|kitnet|\mstudio\M|\mflat\M|conjunto\s+comercial)' then return false; end if;
  for m in select regexp_matches(tit, '([0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?|[0-9]+([.,][0-9]+)?)\s*m(²|2)', 'gi') loop
    area := nullif(replace(replace(m[1], '.', ''), ',', '.'), '')::numeric;
    if area >= 45 then return false; end if;
  end loop;
  d := regexp_replace(lower(left(coalesce(p_descricao, ''), 260)), '^\s*(matr[ií]cula\s*:?\s*|bem\s*:?\s*|im[oó]vel\s*:?\s*|descri[cç][aã]o\s*:?\s*|(os\s+)?direitos\s+(aquisitivos\s+)?(sobre|do|da|de)\s+(o|a)?\s*|[0-9]+[.)]\s*|\(?[0-9]+\)?\s*(um|uma)?\s*\)?\s*)*', '');
  if d ~ '^(o\s+|a\s+|um\s+|uma\s+)?(apartament|casa\M|sobrado|sala\M|loja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|unidade\s+aut[oô]noma\s+residencial)' then return false; end if;
  return true;
end $function$;

create or replace function public.imovel_barrar_vaga_garagem()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.ativo and public.vaga_garagem_barrada(new.titulo, new.descricao) then
    new.ativo := false;
    new.suprimido_motivo := 'vaga_garagem';
  end if;
  return new;
end $function$;

-- Aplicado em produção em passos separados (05/10): a versão de uma transação só esbarrou em lock da tabela
-- (timeout de 60 s, rollback total). Trigger e limpeza foram com `set local lock_timeout = '8s'`.
drop trigger if exists trg_imovel_vaga_garagem on public.imoveis_leilao;
create trigger trg_imovel_vaga_garagem before insert or update on public.imoveis_leilao
  for each row execute function public.imovel_barrar_vaga_garagem();

revoke all on function public.vaga_garagem_barrada(text, text) from public, anon, authenticated;
revoke all on function public.imovel_barrar_vaga_garagem() from public, anon, authenticated;
grant execute on function public.vaga_garagem_barrada(text, text) to service_role;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('acervo.vaga_garagem',
  '{"excluir": true, "so_quando_o_lote_e_a_vaga": true, "area_max_m2": 45}'::jsonb,
  'Vaga e box de garagem NÃO entram no acervo (dono, 05/10: "não são interessantes"). Só sai o lote que É a vaga; apartamento/sala/cobertura com vaga continua. Guardas: título que nomeia unidade, área ≥ 45 m² e descrição que abre com a unidade mantêm o lote.',
  array['vaga_garagem_barrada'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true;

-- Uma vez: os lotes ativos que a regra barra (o trigger só age na próxima escrita de cada um).
-- Resultado medido: 86 removidos; 0 ativos ainda barráveis; o apartamento da SUBLIME e 32 "apartamento … vaga de garagem" seguem ativos.
with alvo as (select id from public.imoveis_leilao where ativo and public.vaga_garagem_barrada(titulo, descricao))
update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'vaga_garagem' from alvo where i.id = alvo.id;
