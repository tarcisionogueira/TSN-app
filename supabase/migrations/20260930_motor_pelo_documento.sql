-- 30/09 — MOTOR DO VEÍCULO TAMBÉM PELO DOCUMENTO (item 8 do HANDOFF).
--
-- Medido: 662 de ~9.570 veículos ativos (7%) dizem algo do motor no título/descrição. 895 dos que
-- não dizem têm PDF. O script `local-e-area-do-documento.mjs` (alvo `motor`) lê esses PDFs de
-- graça (pdf-parse, sem IA) e grava em `motor_doc_texto` SÓ os trechos que falam do motor, do
-- bloco DESTE lote (edital de vários lotes sem bloco identificável não entra — "motor queimado"
-- pode ser do lote vizinho).
--
-- A regra continua UMA SÓ, aqui: o gatilho aplica `motor_status_do_texto` sobre título +
-- descrição + trecho do documento. Título/descrição vêm primeiro (é o que o leiloeiro declara
-- hoje na página). Guardar o TRECHO, e não o veredito, deixa a evidência auditável e faz a
-- próxima melhoria da regra valer também para o que já foi lido, sem reler PDF nenhum.
--
-- A regra aprendeu, no seco sobre PDFs reais do LJUD, frases que escapavam: "motor parado sem
-- funcionamento", "motor inservível", "parte do motor queimado", "parado sem funcionar desde 2020",
-- "sem funcionamento há algum tempo", "motorização funcionando", "bom estado de conservação e
-- funcionamento". Seco sobre as descrições do acervo: +580 (574 "sucata — motor inservível", a
-- classificação do DETRAN/PRF; 6 "bom estado… e funcionamento"), contextos conferidos um a um.

alter table public.veiculos_leilao add column if not exists motor_doc_texto text;
alter table public.veiculos_leilao add column if not exists motor_doc_em timestamptz;

create or replace function public.motor_status_do_texto(p text) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := lower(coalesce(p, '')); v text;
begin
  v := substring(t from 'motor\s*:\s*([^:]{1,45})');
  if v is not null then
    if v ~ '^\s*(n[ãa]o testado|n[ãa]o verificado|n[ãa]o informado|sem informa)' then return null; end if;
    if v ~ '^\s*(avariad|n[ãa]o funciona|travad|fundid|sem funcionamento|danificad|desmontad|faltando|inexistente|ausente|retirad|com defeito|quebrad|inserv[íi]vel|queimad)' then return 'nao_funciona'; end if;
    if v ~ '^\s*(funcionando|funciona\M|em funcionamento|ok\M|bom\M|regular\M)' then return 'funciona'; end if;
  end if;
  if t ~ '\msem motor\M|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido|inserv[íi]vel|queimad[oa])|motor\s+parado\s+sem\s+funcionamento|(ve[íi]culo|motor)[^.;]{0,30}parado\s+sem\s+funcionar|sem\s+funcionamento\s+h[áa]\s|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M)|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento' then
    return 'funciona';
  end if;
  return null;
end $f$;

create or replace function public.trg_veiculo_motor_status() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.motor_status := coalesce(
    public.motor_status_do_texto(coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '')),
    public.motor_status_do_texto(new.motor_doc_texto));
  return new;
end $f$;

drop trigger if exists trg_veiculo_motor_status on public.veiculos_leilao;
create trigger trg_veiculo_motor_status before insert or update of titulo, descricao, motor_doc_texto
  on public.veiculos_leilao for each row execute function public.trg_veiculo_motor_status();

-- ── 2ª parte (mesmo dia), depois do SECO no GitHub: 800 lotes, 489 PDFs, 34 vereditos revistos
-- um a um. "Não funciona" pelas frases fortes: todos certos. "Funciona" vindo de DOCUMENTO: não
-- confiável — "anúncios de veículos equivalentes em bom estado de conservação e funcionamento"
-- (metodologia do avaliador), "som original do veículo em funcionamento", "O MOTOR FUNCIONA?"
-- (pergunta de checklist sem a resposta), "motor refeito, em montagem". E "sem motor DE ARRANQUE"
-- casava "sem motor". Por isso o documento só contribui com NÃO FUNCIONA pelas frases fortes
-- (função própria abaixo); "funciona" continua só vindo do título/descrição.
create or replace function public.motor_nao_funciona_do_documento(p text) returns text
language sql immutable set search_path = public as $f$
  select case when lower(coalesce(p, '')) ~ 'motor\s+(inserv[íi]vel|queimad[oa]|fundid[oa]|travad[oa])|\msem motor\M(?!\s+de\s+arranque)|sem\s+funcionamento\s+h[áa]\s|parado\s+sem\s+funcionar|motor\s+parado\s+sem\s+funcionamento'
              then 'nao_funciona' end
$f$;

-- "sem motor de arranque" (peça) não é "sem motor"; "motor funciona?" (pergunta) não é resposta.
create or replace function public.motor_status_do_texto(p text) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := lower(coalesce(p, '')); v text;
begin
  v := substring(t from 'motor\s*:\s*([^:]{1,45})');
  if v is not null then
    if v ~ '^\s*(n[ãa]o testado|n[ãa]o verificado|n[ãa]o informado|sem informa)' then return null; end if;
    if v ~ '^\s*(avariad|n[ãa]o funciona|travad|fundid|sem funcionamento|danificad|desmontad|faltando|inexistente|ausente|retirad|com defeito|quebrad|inserv[íi]vel|queimad)' then return 'nao_funciona'; end if;
    if v ~ '^\s*(funcionando|funciona\M|em funcionamento|ok\M|bom\M|regular\M)' then return 'funciona'; end if;
  end if;
  if t ~ '\msem motor\M(?!\s+de\s+arranque)|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido|inserv[íi]vel|queimad[oa])|motor\s+parado\s+sem\s+funcionamento|(ve[íi]culo|motor)[^.;]{0,30}parado\s+sem\s+funcionar|sem\s+funcionamento\s+h[áa]\s|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M(?!\s*\?))|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento' then
    return 'funciona';
  end if;
  return null;
end $f$;

create or replace function public.trg_veiculo_motor_status() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.motor_status := coalesce(
    public.motor_status_do_texto(coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '')),
    public.motor_nao_funciona_do_documento(new.motor_doc_texto));
  return new;
end $f$;
