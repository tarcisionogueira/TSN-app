-- 01/11 — #305 etapa 2: os gatilhos de imoveis_leilao deixam de refazer trabalho quando nada do que leem mudou.
--
-- POR QUE: a coleta grava por upsert (PostgREST, on_conflict=fonte_id) e regrava o acervo inteiro todo dia. Num lote que
-- JÁ existe, o Postgres roda a cadeia BEFORE INSERT inteira sobre a linha proposta (vira EXCLUDED) e depois a cadeia
-- BEFORE UPDATE — e `UPDATE OF col` não filtra nada, porque o upsert põe todas as colunas do payload no SET.
-- Medido em 01/11 (200 upserts de imóveis existentes, transação desfeita): 8,0 s só em gatilhos = 40 ms/linha;
-- `preservar_e_derivar_endereco` sozinho 4,6 s (57%), fração + fração ideal 1,5 s, bem móvel 0,36 s. É esse custo, no pico
-- de coleta, que empurrava as leituras dos crons para além dos 8 s do statement_timeout (57014).
--
-- O QUE MUDA (só retorno antecipado dentro das funções — nenhuma DDL de gatilho, a ordem alfabética fica igual):
--  (A) Caminho INSERT com linha EXISTENTE (mesmo fonte_id): a escrita vai virar UPDATE (ou erro de unicidade), e a
--      cadeia de UPDATE recalcula o que mudou. Aplicado onde o resultado do INSERT só importa para linha nova:
--      situação geo, pino genérico, fração e as 4 barreiras. Endereço: só quando o gravado já tem número e o texto é o mesmo.
--      `cidade_pelo_ibge` NÃO entra: o upsert diário ainda normaliza cidade gravada antes da regra (medido: 1 de 280).
--  (B) Caminho UPDATE: pula quando os campos que a função lê são iguais aos de OLD. OLD já passou pela mesma função quando
--      foi gravado, e todas estas são determinísticas sobre os campos da linha (nenhuma lê outra tabela que mude por fora
--      — por isso `zzzz_set_tem_edital_doc`, que lê imovel_anexos, NÃO entra).
--  BARREIRAS (bem móvel, vaga, consórcio, fração ideal): rodam SEMPRE que o lote está sendo REATIVADO (old inativo →
--      new ativo), mesmo com texto igual — senão um lote barrado voltaria à vitrine na próxima coleta.
--  FRAÇÃO: no pulo, `fracionado` herda o de OLD (o payload costuma vir sem ele ou false; antes o recálculo devolvia o true).
--
-- ⚠️ CONSEQUÊNCIA PARA QUEM MEXER NAS REGRAS: mudar `bem_movel_barrado`, `vaga_garagem_barrada`, `lote_e_cota_consorcio`,
--    `fracao_ideal_barrada`, `lote_eh_fracao`, `limpar_html_texto`, `anexo_lixo`, `foto_placeholder` ou a derivação de
--    endereço NÃO reaplica mais sozinho na próxima coleta a lote com texto igual. Regra nova = migração com backfill.

create or replace function public.imovel_fonte_id_existe(p_fonte_id text)
returns boolean language sql stable set search_path = public as $f$
  select p_fonte_id is not null and exists (select 1 from public.imoveis_leilao where fonte_id = p_fonte_id);
$f$;

create or replace function public.preservar_e_derivar_endereco()
returns trigger language plpgsql set search_path = public, pg_temp as $f$
declare v_novo text; v_desc text[];
begin
  -- (A) upsert de lote existente cujo endereço gravado JÁ É COMPLETO (tem número) e com o mesmo texto: a cadeia de UPDATE
  -- devolve o endereço de OLD. Endereço vazio ou sem número continua sendo derivado a cada coleta, como antes — é assim que
  -- linhas antigas ganham o que a regra de derivação aprendeu depois (medido 01/11: 5 de 280 seriam congeladas sem isto).
  if tg_op = 'INSERT' and coalesce(btrim(new.endereco),'') = '' and new.fonte_id is not null and exists (
       select 1 from public.imoveis_leilao o
        where o.fonte_id = new.fonte_id and o.endereco ~ ',\s*\d{1,5}'
          and o.titulo is not distinct from new.titulo and o.descricao is not distinct from new.descricao) then
    return new;
  end if;

  if tg_op <> 'INSERT' then
    if coalesce(btrim(new.endereco),'') = '' and coalesce(btrim(old.endereco),'') <> '' then
      new.endereco := old.endereco;
    end if;
    if coalesce(btrim(new.bairro),'') = '' and coalesce(btrim(old.bairro),'') <> '' then
      new.bairro := old.bairro;
    end if;
    if coalesce(btrim(new.cidade),'') = '' and coalesce(btrim(old.cidade),'') <> '' then
      new.cidade := old.cidade;
    end if;
    if coalesce(new.estado,'') !~ '^[A-Za-z]{2}$' and coalesce(old.estado,'') ~ '^[A-Za-z]{2}$' then
      new.estado := old.estado;
    end if;
    if ((coalesce(btrim(old.cidade),'') = '' and coalesce(btrim(new.cidade),'') <> '')
        or (coalesce(old.estado,'') !~ '^[A-Z]{2}$' and coalesce(new.estado,'') ~ '^[A-Z]{2}$'))
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
    if coalesce(new.endereco,'') ~ ',\s*\d{1,5}' and coalesce(old.endereco,'') is distinct from coalesce(new.endereco,'')
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'bairro', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
  end if;

  if coalesce(btrim(new.endereco),'') = '' then
    v_novo := public.endereco_do_titulo(new.titulo, new.cidade);
    if v_novo is not null then
      new.endereco := v_novo;
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;

  if coalesce(btrim(new.endereco),'') = '' then
    v_desc := public.endereco_da_descricao(new.descricao, new.cidade);
    if v_desc is not null then
      new.endereco := v_desc[1];
      if coalesce(btrim(new.bairro),'') = '' and coalesce(v_desc[2],'') <> '' then new.bairro := v_desc[2]; end if;
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'bairro', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  return new;
end $f$;

-- Só o gatilho de INSERT usa esta função (o de UPDATE tem WHEN sobre lat/lng/nível/UF).
create or replace function public.trg_situacao_geo()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  new.situacao_geo := public.situacao_geo(new.latitude, new.longitude, new.geocod_nivel, new.estado);
  new.situacao_geo_em := now();
  new.restricoes_geo := public.restricoes_geo(new.latitude, new.longitude, new.geocod_nivel);
  new.restricoes_geo_em := now();
  return new;
end $f$;

create or replace function public.trg_geocode_pino_generico()
returns trigger language plpgsql set search_path = public as $f$
declare
  v_via text;
  v_conflito boolean;
begin
  if new.geocod_nivel is null or new.geocod_nivel not in ('rua', 'endereco') then
    return new;
  end if;
  if new.latitude is null or new.longitude is null or new.latitude = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.latitude is not distinct from old.latitude
     and new.longitude is not distinct from old.longitude
     and new.geocod_nivel is not distinct from old.geocod_nivel
     and new.endereco is not distinct from old.endereco then
    return new;
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)

  v_via := public.via_atual(new.endereco);
  if v_via is null then return new; end if;

  select exists (
    select 1
    from public.imoveis_leilao i
    where i.ativo
      and i.id <> new.id
      and i.latitude = new.latitude
      and i.longitude = new.longitude
      and public.via_atual(i.endereco) is not null
      and not public.mesma_via(i.endereco, new.endereco)
  ) into v_conflito;

  if v_conflito then
    new.geocod_nivel := 'cidade';
  end if;

  return new;
end;
$f$;

create or replace function public.trg_imovel_fracao()
returns trigger language plpgsql set search_path = public, pg_temp as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao then
    new.fracionado := coalesce(new.fracionado, false) or coalesce(old.fracionado, false);  -- (B)
    return new;
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  new.fracionado := coalesce(new.fracionado, false) or public.lote_eh_fracao(new.titulo, new.descricao);
  return new;
end $f$;

create or replace function public.imovel_barrar_fracao_ideal()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then
    return new;  -- (B) texto igual e não é reativação
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  if public.fracao_ideal_barrada(new.titulo, new.descricao) then
    new.ativo := false;
  end if;
  return new;
end;
$f$;

create or replace function public.imovel_barrar_bem_movel()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then
    return new;  -- (B)
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  if new.ativo and (public.bem_movel_barrado(new.titulo, new.descricao) or public.equipamento_no_titulo(new.titulo)) then
    new.ativo := false;
  end if;
  return new;
end;
$f$;

create or replace function public.imovel_barrar_vaga_garagem()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then
    return new;  -- (B)
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  if new.ativo and public.vaga_garagem_barrada(new.titulo, new.descricao) then
    new.ativo := false;
    new.suprimido_motivo := 'vaga_garagem';
  end if;
  return new;
end $f$;

create or replace function public.imovel_barrar_consorcio()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then
    return new;  -- (B)
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;  -- (A)
  if new.ativo and public.lote_e_cota_consorcio(new.titulo) then
    new.ativo := false;
    new.suprimido_motivo := 'nao_imovel';
  end if;
  return new;
end;
$f$;

-- (B) só: estas normalizam colunas do PAYLOAD; no upsert de lote existente o resultado do INSERT vira o NEW do UPDATE.
create or replace function public.trg_descricao_sem_html()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.descricao is not distinct from old.descricao then return new; end if;
  new.descricao := public.limpar_html_texto(new.descricao);
  return new;
end $f$;

create or replace function public.trg_anexo_lixo_remove()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.anexos is not distinct from old.anexos then return new; end if;
  if jsonb_typeof(new.anexos) = 'array' and exists (
       select 1 from jsonb_array_elements(new.anexos) a
        where jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome')) then
    new.anexos := coalesce((
      select jsonb_agg(a order by o)
        from jsonb_array_elements(new.anexos) with ordinality as t(a, o)
       where not (jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome'))
    ), '[]'::jsonb);
  end if;
  return new;
end $f$;

create or replace function public.trg_foto_placeholder_nula()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.link_foto is not distinct from old.link_foto then return new; end if;
  -- Placeholder gravado como foto e AUSENCIA ENTREGUE COMO CONTEUDO (ver histórico desta função).
  if new.link_foto is not null and public.foto_placeholder(new.link_foto) then
    new.link_foto := null;
  end if;
  return new;
end $f$;

create or replace function public.trg_tipo_construido_pelo_titulo()
returns trigger language plpgsql set search_path = public as $f$
declare novo text;
begin
  if tg_op = 'UPDATE' and new.tipo is not distinct from old.tipo and new.titulo is not distinct from old.titulo then
    return new;
  end if;
  if new.tipo = 'terreno' then
    novo := public.tipo_construido_pelo_titulo(new.titulo);
    if novo is not null then new.tipo := novo; end if;
  end if;
  return new;
end $f$;
