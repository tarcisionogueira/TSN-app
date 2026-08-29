-- TODO MUNDO NASCE COM CÓDIGO DE INDICAÇÃO (29/08).
--
-- POR QUE: o dono quis que qualquer cliente da base pudesse convidar um amigo para a aula. O
-- encanamento inteiro já existia — `/aula/<slug>?ref=CODIGO` é repassado por `api/og-share`,
-- guardado pela landing e resolvido por `api/live-inscrever`, que grava `indicado_por` e
-- `indicacao_origem = 'link_parceiro'`. Só que 63 dos 73 perfis ativos NÃO TINHAM CÓDIGO.
--
-- O código era gerado SOB DEMANDA (`gerar_codigo_indicacao`, chamada por algumas telas quando
-- precisavam dele) e a função exige `p_id = auth.uid()` — ou seja, só o próprio usuário, e só
-- estando logado numa dessas telas. Consequências, todas silenciosas:
--   · quem nunca passou por essas telas ficava com o link caindo no UUID cru — feio, e expõe o
--     id interno do usuário em algo que vai para o WhatsApp de terceiros;
--   · o SERVIDOR não conseguia gerar (com a service key `auth.uid()` é nulo, e a função levanta
--     exceção), então nenhum e-mail podia trazer o link pessoal de quem recebe.
--
-- O CONSERTO é mudar o momento: o código passa a nascer com o perfil, por gatilho. Depois disto
-- "usuário sem código" deixa de ser um estado possível, e quem lê o código pode simplesmente
-- LER — sem precisar tratar a ausência, que é onde nasciam os dois defeitos acima.
--
-- `gerar_codigo_indicacao(uuid)` continua existindo e intacta: várias telas a chamam, ela é
-- idempotente (devolve o código atual se já houver) e continua sendo a porta do usuário logado.
-- Este gatilho só faz com que ela nunca mais tenha nada a gerar.
begin;

-- A geração em si, sem checagem de identidade: só o gatilho e o backfill chamam, e o parâmetro
-- é sempre a linha que está sendo inserida. NÃO é exposta a anon/authenticated (o revoke abaixo)
-- — quem é usuário continua entrando por `gerar_codigo_indicacao`, que confere `auth.uid()`.
create or replace function public.codigo_indicacao_novo()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare novo text;
begin
  loop
    novo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.perfis where codigo_indicacao = novo);
  end loop;
  return novo;
end $function$;

revoke all on function public.codigo_indicacao_novo() from public, anon, authenticated;

create or replace function public.perfis_codigo_indicacao_bi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.codigo_indicacao is null or new.codigo_indicacao = '' then
    new.codigo_indicacao := public.codigo_indicacao_novo();
  end if;
  return new;
end $function$;

drop trigger if exists perfis_codigo_indicacao_bi on public.perfis;
create trigger perfis_codigo_indicacao_bi
  before insert on public.perfis
  for each row execute function public.perfis_codigo_indicacao_bi();

-- BACKFILL. Uma linha por vez de propósito: `codigo_indicacao_novo()` confere a unicidade
-- contra o que JÁ está na tabela, e um update em conjunto avaliaria todos contra o mesmo
-- estado inicial — dois perfis poderiam receber o mesmo código, e o `ref` de um resolveria
-- para o outro. Colisão de 1 em 16 milhões por par, mas o efeito seria comissão do amigo
-- errado, sem erro nenhum aparecendo.
do $$
declare r record;
begin
  for r in select id from public.perfis where coalesce(codigo_indicacao,'') = '' loop
    update public.perfis set codigo_indicacao = public.codigo_indicacao_novo() where id = r.id;
  end loop;
end $$;

commit;
