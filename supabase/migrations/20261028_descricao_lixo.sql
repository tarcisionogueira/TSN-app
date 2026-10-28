-- #376 (28/10): DESCRIÇÃO-LIXO não entra. Achados da varredura do #374 (mesmo texto em 3+ lotes de títulos diferentes):
--   DEPAULALEILOES  6.000 caracteres de marcação do Word (<!--[if gte mso 9]><xml>…) — texto real cortado fora
--   JINKINGSLEILOES só os rótulos das abas ("Descrição Documentos Localização Histórico Lances/Propostas Informações")
--   LEILOFY         começa no aviso legal ("são meramente ilustrativas… Siga @leiloaria_smart no Instagram")
--   MEGA            lista de OUTROS lotes com código ("… São José - SC X129963 Apartamento 60 m² …")
-- 86 linhas (36 ativas), backup _bkp_descricao_lixo_20261028. Medido antes de ligar: a regra só pega essas 4 fontes —
-- a 1ª versão (aviso legal EM QUALQUER PONTO) condenava 195 descrições boas do COMPREI; ficou só "COMEÇA no aviso".
-- CEF, PROJUDLEIL e CRLEILOES repetem texto por natureza (modelo da Caixa / mesmo edital) e não são lixo.
create or replace function public.descricao_sem_markup(p text) returns text language sql immutable
as $$
  select case when coalesce(p, '') ~ '<!--|<[a-zA-Z/][^>]*>'
    then trim(regexp_replace(regexp_replace(regexp_replace(p, '<!--.*?(-->|$)', ' ', 'g'), '<[^>]*>', ' ', 'g'), '[ \t]+', ' ', 'g'))
    else p end
$$;

create or replace function public.descricao_eh_lixo(p text) returns boolean language sql immutable
as $$
  with t as (select public.sem_acento(coalesce(public.descricao_sem_markup(p), '')) s)
  select case
    -- marcação de Word/HTML que, limpa, não deixa texto nenhum (DEPAULA: comentário cortado no meio)
    when coalesce(p, '') ~* '<!--\[if|<w:|<o:|officedocumentsettings' and length(regexp_replace((select s from t), '\W', '', 'g')) < 40 then true
    when (select s from t) = '' then false
    when (select s from t) ~ '<w:|<o:|w:lsdexception|officedocumentsettings' then true
    -- só rótulos de abas da página
    when regexp_replace((select s from t), '\m(descricao|documentos?|localizacao|historico|lances?|propostas?|informacoes|fotos|mapa|edital|matricula|anexos|detalhes|lote|imovel)\M|[/|·•\s-]', '', 'g') = '' then true
    -- lista de OUTROS lotes: 2+ códigos de lote da MEGA, ou 2+ "Cidade/UF R$ valor" (vitrine de destaques)
    when (select count(*) from regexp_matches(p, '\mX\d{6}\M', 'g')) >= 2 then true
    when (select count(*) from regexp_matches(p, '[A-Za-zÀ-ÿ]\s*/\s*[A-Z]{2}\s+R\$\s*[\d.]+,\d{2}', 'g')) >= 2 then true
    -- o bloco COMEÇA no aviso legal (rodapé da ficha); aviso no MEIO de uma descrição real não conta
    when (select s from t) ~ '^\W*(as\s+)?(fotos\s+|imagens\s+)?(sao\s+)?meramente\s+ilustrativ' then true
    else false end
$$;

-- Mantém a anterior se ela era boa; senão, o título. `trg_zx_` roda depois de preservar_descricao_completa — que só olha
-- TAMANHO e deixava o lixo longo passar por cima de uma descrição boa. Pré-filtro barato no WHEN: a CEF regrava ~22,5 mil
-- linhas por rodada e a função completa (sem_acento + regex) não precisa rodar nelas.
create or replace function public.trg_descricao_lixo()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if public.descricao_eh_lixo(new.descricao) then
    if tg_op = 'UPDATE' and length(coalesce(old.descricao, '')) >= 40 and not public.descricao_eh_lixo(old.descricao) then
      new.descricao := old.descricao;
    else
      new.descricao := left(coalesce(new.titulo, ''), 500);
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_zx_descricao_lixo on public.imoveis_leilao;
create trigger trg_zx_descricao_lixo before insert or update of descricao on public.imoveis_leilao
  for each row when (new.descricao is not null and length(new.descricao) >= 20
    and new.descricao ~* '<!--|<w:|<o:|meramente\s+ilustrativ|X\d{6}|/\s*[A-Z]{2}\s+R\$|^\W*Descri..o\s+Documentos')
  execute function public.trg_descricao_lixo();

create table if not exists public._bkp_descricao_lixo_20261028 as
  select id, fonte, fonte_id, descricao from public.imoveis_leilao where public.descricao_eh_lixo(descricao);
alter table public._bkp_descricao_lixo_20261028 enable row level security;

set local session_replication_role = replica;
update public.imoveis_leilao i set descricao = left(coalesce(i.titulo, ''), 500)
  from public._bkp_descricao_lixo_20261028 b where b.id = i.id;
