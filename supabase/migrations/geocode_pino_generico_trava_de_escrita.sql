-- ─────────────────────────────────────────────────────────────────────────────
-- PINO GENÉRICO — TRAVA DE ESCRITA (06/08/2026)
--
-- Continuação direta de `geocode_pino_generico_detectar_refazer.sql` (05/08). Aquela
-- migração detectou e re-enfileirou 3.458 lotes; a correção de código do mesmo dia
-- cobriu os retornos do NOMINATIM. Na abertura de 06/08 a conta não fechou:
--
--   dos 3.415 re-enfileirados, 631 já haviam sido reprocessados
--     → 399 voltaram rotulados 'rua'/'endereco'  (324 ainda em coordenada compartilhada)
--     → 232 voltaram 'cidade'/'bairro'           (rótulo honesto)
--
-- Relapso de ~51%, com o cron horário produzindo mais a cada hora. As rotas que
-- escapavam rotulavam por INTENÇÃO sem evidência do resultado: o CEP (BrasilAPI e
-- Nominatim/postalcode — "CEP geral" do município tem a coordenada do município
-- inteiro; 17 logradouros de Altos/PI no mesmo ponto), o Google (location_type
-- descreve a QUALIDADE do ponto, não O QUE foi casado) e o LocationIQ (catch-all
-- 'bairro'). Corrigidos em api/_geo.js no mesmo commit.
--
-- Esta migração é a rede de baixo: uma trava no BANCO, que vale para todo escritor —
-- crons, scripts de enriquecimento, correção manual e qualquer provedor que entre
-- amanhã. A regra é a mesma que a detecção usa: duas VIAS diferentes não ocupam a
-- mesma coordenada de 7 casas decimais; se ocupam, o ponto é genérico e nenhum
-- rótulo preciso ali é verdade.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Normalização do logradouro. Compara VIA, não endereço: "Rua X, 100" e "Rua X, 250"
-- são a mesma via (prédio/quarteirão — não dispara), "R. Projetada" e "Rua Projetada II"
-- não são. Tira acento, prefixo de tipo de via e pontuação, que variam por leiloeiro e
-- gerariam falso positivo entre grafias do MESMO logradouro.
create or replace function public.via_normalizada(endereco text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(
            lower(btrim(split_part(coalesce(endereco, ''), ',', 1))),
            'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
          '^(r|rua|av|avenida|trav|travessa|tv|al|alameda|rod|rodovia|est|estr|estrada|pc|praca|praça|largo|viela|qd|quadra)\.?\s+',
          ''),
        '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g')),
    '')
$$;

revoke execute on function public.via_normalizada(text) from public, anon, authenticated;
grant execute on function public.via_normalizada(text) to service_role;

-- 2) A trava. Roda BEFORE INSERT/UPDATE e só faz trabalho quando alguém tenta gravar um
-- rótulo PRECISO ('rua'/'endereco') numa coordenada nova — os UPDATEs do scraper (preço,
-- data, status) saem no primeiro `if` sem tocar o índice.
--
-- Ao detectar o conflito, rebaixa DOIS lados: o que está entrando e os que já estavam no
-- mesmo ponto. Sem a segunda parte, o primeiro lote a chegar num ponto genérico ficaria
-- para sempre rotulado preciso — e a detecção seguiria acusando (685 grupos = 685 mentiras
-- remanescentes). 'cidade' é o rótulo honesto: a coordenada continua sendo a melhor que
-- temos, mas o app deixa de vendê-la como exata, e o regeocod-imprecisos a retenta depois.
create or replace function public.trg_geocode_pino_generico()
returns trigger
language plpgsql
set search_path = public
as $$
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

  v_via := public.via_normalizada(new.endereco);
  if v_via is null then return new; end if;

  select exists (
    select 1
    from public.imoveis_leilao i
    where i.ativo
      and i.id <> new.id
      and i.latitude = new.latitude
      and i.longitude = new.longitude
      and public.via_normalizada(i.endereco) is not null
      and public.via_normalizada(i.endereco) <> v_via
  ) into v_conflito;

  if v_conflito then
    new.geocod_nivel := 'cidade';
    -- Rebaixa também o incumbente. Não recursiona: o UPDATE abaixo grava 'cidade',
    -- que sai no primeiro `if` deste mesmo gatilho.
    -- O bloco de exceção existe porque um UPDATE em LOTE que tocasse duas linhas do mesmo
    -- ponto abortaria aqui ("tuple already modified by an operation triggered by the
    -- current command"). Guarda de qualidade não pode derrubar ingestão: o rebaixamento
    -- da linha que está entrando (a parte que importa) já foi feito acima, e o incumbente
    -- é pego pela detecção/monitor.
    begin
      update public.imoveis_leilao i
         set geocod_nivel = 'cidade'
       where i.ativo
         and i.id <> new.id
         and i.latitude = new.latitude
         and i.longitude = new.longitude
         and i.geocod_nivel in ('rua', 'endereco');
    exception when others then null;
    end;
  end if;

  return new;
end;
$$;

-- Nome com `zz_` de propósito: gatilhos BEFORE disparam em ordem ALFABÉTICA, e este
-- precisa ver o endereço FINAL — depois do trg_preservar_endereco, que ainda o deriva
-- do título.
drop trigger if exists trg_zz_geocode_pino_generico on public.imoveis_leilao;
create trigger trg_zz_geocode_pino_generico
before insert or update on public.imoveis_leilao
for each row execute function public.trg_geocode_pino_generico();

-- 3) Re-enfileira o que relapsou desde ontem. Com a trava ativa, o que voltar a cair em
-- ponto genérico já nasce rotulado 'cidade' em vez de mentir de novo.
with genericas as (
  select latitude, longitude from public.geocode_pinos_genericos()
)
update public.imoveis_leilao i
set geocod_nivel = 'refazer', geocod_reproc_em = now()
from genericas g
where i.ativo
  and i.geocod_nivel in ('rua', 'endereco')
  and i.latitude::numeric = g.latitude
  and i.longitude::numeric = g.longitude;
