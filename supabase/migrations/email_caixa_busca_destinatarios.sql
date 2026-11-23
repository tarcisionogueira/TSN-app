-- BUSCA POR DESTINATÁRIO NA CAIXA DE E-MAIL (23/11, pedido do dono — melhoria 9, inspirada no Gmail).
--
-- A busca da Caixa passou a ir ao banco (antes filtrava só as 200 mensagens mais recentes já
-- carregadas — em 23/11 Enviados tinha 218 e as 18 mais antigas nunca apareciam). `para` e `cc` são
-- text[], e o PostgREST não busca TRECHO dentro de array (`cs` só casa o endereço inteiro). Esta
-- coluna gerada junta os dois em texto para o `ilike` da tela achar "fulano" em "fulano@x.com.br".
--
-- `array_to_string` é STABLE e coluna gerada exige IMMUTABLE: a função abaixo só embrulha a junção
-- (para text[] o resultado depende apenas da entrada, então IMMUTABLE é verdadeiro aqui).

create or replace function public._email_lista_texto(p_a text[], p_b text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(coalesce(pg_catalog.array_to_string(p_a, ' '), '') || ' ' || coalesce(pg_catalog.array_to_string(p_b, ' '), ''))
$$;

alter table public.email_caixa
  add column if not exists destinatarios_texto text
  generated always as (public._email_lista_texto(para, cc)) stored;

comment on column public.email_caixa.destinatarios_texto is
  'para + cc em texto (gerada) — só para a busca por trecho da Caixa de e-mail (CaixaEmail.jsx).';
