-- ORIGEM DA VENDA do veículo (25/09, pedido do dono). `modalidade` só separava judicial ×
-- extrajudicial, e o SUPERBID inteiro (7.492 lotes) vinha "extrajudicial" por padrão. Para quem
-- compra, o que muda risco e preço é QUEM vende:
--   judicial      — há processo (vara, tribunal, execução)
--   financeira    — retomada de financiamento/consórcio/leasing (banco)
--   seguradora    — sinistro ou recuperado de roubo (seguradora)
--   patio         — Detran/PRF/órgão de trânsito: apreendido/removido, pode ter débito e restrição
--   orgao_publico — bem próprio do poder público (prefeitura, estado, autarquia, BNDES…)
--   corporativo   — empresa vendendo a própria frota/ativo (renovação de frota, dissolução)
--   nao_identificado — sem sinal no dado; NUNCA chutado
-- Fontes do sinal, em ordem de confiança: campo explícito do leiloeiro (SODRE `lot_origin` /
-- `lot_is_judicial`), `modalidade` já lida, nome do LEILÃO/comitente (SUPERBID `auction.desc` e
-- `store.name`), título/descrição. O nome do LEILOEIRO não entra (ex.: "Leilões Judiciais" é a casa,
-- não a natureza do lote). `modalidade` continua existindo e passa a ser coerente com a origem.

alter table public.veiculos_leilao add column if not exists origem_venda text
  check (origem_venda is null or origem_venda in ('judicial','financeira','seguradora','patio','orgao_publico','corporativo','nao_identificado'));

create or replace function public.classificar_origem_veiculo(p_fonte text, p_raw jsonb, p_titulo text, p_descricao text, p_modalidade text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare
  v_origem  text := lower(coalesce(p_raw->>'lot_origin', ''));
  v_jud     text := lower(coalesce(p_raw->>'lot_is_judicial', ''));
  v_leilao  text := lower(coalesce(p_raw->'auction'->>'desc', '') || ' ' || coalesce(p_raw->>'auction_name', ''));
  v_loja    text := lower(coalesce(p_raw->'store'->>'name', '') || ' ' || coalesce(p_raw->>'client_name', ''));
  -- META = quem vende (nome do leilão, comitente/loja) + título. A DESCRIÇÃO fica de fora de
  -- tudo menos do sinal judicial: seco de 25/09 mostrou "banco de couro" virando FINANCEIRA
  -- (Heineken, CPFL, 20+ prefeituras) e "no pátio do leiloeiro" (todo lote diz) virando PÁTIO.
  v_meta    text := v_leilao || ' ' || v_loja || ' ' || lower(coalesce(p_titulo, ''));
  v_tudo    text := v_meta || ' ' || lower(coalesce(p_descricao, ''));
begin
  -- 0) CAMPO EXPLÍCITO do leiloeiro vence qualquer texto (SODRE: lot_origin / lot_is_judicial).
  if v_jud = 'true' then return 'judicial'; end if;
  if v_origem = 'seguro' then return 'seguradora'; end if;
  if v_origem in ('financiamento','financeira','banco') then return 'financeira'; end if;
  if v_origem in ('frota','lojista','empresa') then return 'corporativo'; end if;
  -- 1) JUDICIAL: modalidade já lida ou vara/tribunal/processo (aqui a descrição entra).
  if p_modalidade = 'judicial'
     or v_meta ~ '\mjudicial\M'
     or v_tudo ~ '(\d+\s*[ªaº°]?\s*vara\M|\mvara (c[ií]vel|criminal|federal|do trabalho|da fazenda|de execu|[uú]nica)|\mtribunal\M|\mtj[a-z]{2}\M|\mtr[tf]\s*-?\s*\d|justi[cç]a (federal|estadual|do trabalho)|execu[cç][aã]o fiscal|hasta p[uú]blica|\mjuizado\M|\mcomarca\M|processo n?[º°o]?\.?\s*\d)' then
    return 'judicial';
  end if;
  -- 2) SEGURADORA
  if v_meta ~ '(segurador|\mseguros\M)' then return 'seguradora'; end if;
  -- 3) PÁTIO / ÓRGÃO DE TRÂNSITO (antes de órgão público: "Guarda Municipal" é pátio)
  if v_meta ~ '\m(detran|ciretran|prf|dnit|der|semob|renajud|removid[oa]s?|apreendid[oa]s?|cust[oó]dia|guarda municipal|smur|circula[cç][aã]o)\M'
     or v_leilao ~ '(ve[ií]culos conservados|ve[ií]culos sucata|sucata-leil)' then
    return 'patio';
  end if;
  -- 4) FINANCEIRA (só no nome de quem vende — nunca na descrição do carro)
  if v_leilao ~ '\m(banco|financeira|leasing|cons[oó]rcio|aliena[cç][aã]o fiduci[aá]ria|retomad[oa]s?)\M'
     or v_loja ~ '\m(banco|financeira|leasing|cons[oó]rcio)\M' then
    return 'financeira';
  end if;
  -- 5) ÓRGÃO PÚBLICO (bem próprio)
  if v_meta ~ '\m(prefeitura|munic[ií]pio|munic[ií]pal|c[aâ]mara municipal|governo|secretaria|celic|bndes|minist[eé]rio|receita federal|autarquia|universidade federal|ex[eé]rcito|marinha|aeron[aá]utica|pol[ií]cia|cons[oó]rcio intermunicipal|fund[aã]o municipal)\M' then
    return 'orgao_publico';
  end if;
  -- 6) CORPORATIVO: empresa como comitente
  if v_meta ~ '\m(corporativo|frota|locadora|localiza|unidas|movida|ltda|s/?a|transportes|distribuidora|log[ií]stica|energia|petrobras|cpfl|coelba|comg[aá]s|neoenergia|heineken|jadlog|cargill|pepsico|fedex)\M' then
    return 'corporativo';
  end if;
  -- SUPERBID: leilão com nome de empresa (sem "leilão"/"lote"/"praça"…) e loja que não é leiloeiro.
  if p_fonte in ('SUPERBID','SOLD','SBID9','SBID21') and length(trim(v_leilao)) > 2
     and v_leilao !~ '(lei[lã]|lote|pra[cç]a|sucata|diversos|inserv|judicial|oportunidade)'
     and v_loja !~ '(leil|assessoria|consult|arremat|hasta|sold)' then
    return 'corporativo';
  end if;
  return 'nao_identificado';
end $$;

-- Gatilho: todo veículo novo ou atualizado sai classificado, sem depender de cada scraper.
create or replace function public.trg_veiculo_origem_venda() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.origem_venda := public.classificar_origem_veiculo(new.fonte, new.raw, new.titulo, new.descricao, new.modalidade);
  return new;
end $$;

drop trigger if exists veiculo_origem_venda on public.veiculos_leilao;
create trigger veiculo_origem_venda before insert or update of raw, titulo, descricao, modalidade, fonte
  on public.veiculos_leilao for each row execute function public.trg_veiculo_origem_venda();

create index if not exists veiculos_leilao_origem_venda_idx on public.veiculos_leilao (origem_venda) where ativo;

-- Backfill (seco de 25/09 sobre os ativos: patio 5.521 · nao_identificado 2.462 · seguradora 487 ·
-- orgao_publico 420 · judicial 403 · corporativo 403 · financeira 42).
update public.veiculos_leilao
   set origem_venda = public.classificar_origem_veiculo(fonte, raw, titulo, descricao, modalidade)
 where origem_venda is distinct from public.classificar_origem_veiculo(fonte, raw, titulo, descricao, modalidade);
