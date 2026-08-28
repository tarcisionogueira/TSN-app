-- ─────────────────────────────────────────────────────────────────────────────────────────
-- "NÃO CONFIGURADO" E "CONFIGURADO COMO GRÁTIS" NÃO SÃO A MESMA COISA — 28/08
--
-- O invariante `geocode_sem_preco` acusava quando havia requests e `custo_usd_micro = 0`.
-- Isso funde duas respostas opostas — a forma nº 1 do CLAUDE.md dentro da própria trava:
--   (a) ninguém configurou o preço   → o custo real é desconhecido, e o alerta está CERTO;
--   (b) o plano contratado é GRATUITO → o custo real É zero, e o alerta está ERRADO.
--
-- No caso (b) NÃO EXISTE valor de `LOCATIONIQ_USD_POR_1000` capaz de fechar o alerta: setar
-- 0 produz custo 0, indistinguível de não ter setado nada. O dono ficaria com um alerta
-- permanentemente vermelho por ter feito exatamente a coisa certa — e painel que não pode
-- ficar verde treina todo mundo a ignorá-lo, que é como um alerta morre.
--
-- O banco não consegue ler `process.env`. Então a DECLARAÇÃO precisa morar onde ele enxerga.
-- Esta tabela NÃO duplica o preço que a env aplica: ela registra que a decisão foi TOMADA,
-- com data e motivo. `api/_geo.js` segue calculando o custo por chamada a partir da env.
--
-- COMO USAR (uma linha, quando o plano for conhecido):
--   -- plano gratuito:
--   insert into integracao_preco (provedor, usd_por_1000, observacao)
--        values ('locationiq', 0, 'Plano gratuito — sem cobranca por chamada');
--   -- plano pago: setar LOCATIONIQ_USD_POR_1000 na Vercel **e** declarar aqui o mesmo valor.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.integracao_preco (
  provedor      text primary key,
  usd_por_1000  numeric not null check (usd_por_1000 >= 0),
  observacao    text,
  declarado_em  timestamptz not null default now()
);

-- Sem PII, mas sem motivo para ser legível por anônimo: só o servidor lê e escreve.
alter table public.integracao_preco enable row level security;

comment on table public.integracao_preco is
  'Declaracao explicita do preco de uma integracao paga. Existe para separar "ninguem configurou" de "o plano e gratuito, o preco E zero" — distincao que o custo gravado sozinho nao carrega. Linha aqui = decisao tomada; a env (ex.: LOCATIONIQ_USD_POR_1000) continua sendo quem aplica o valor por chamada.';

-- O invariante passa a perguntar "a decisão de preço foi tomada?" em vez de "o custo gravado
-- é diferente de zero?". Plano pago com a env setada fecha pelo caminho antigo (o custo
-- aparece); plano gratuito fecha pela declaração.
do $do$
declare src text; novo text; ancora text; add text;
begin
  select prosrc into src from pg_proc where oid = 'public.qa_invariantes'::regproc;
  ancora := $q$         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date), 0),$q$;
  if position(ancora in src) = 0 then raise exception 'ancora do geocode_sem_preco nao encontrada'; end if;
  add := $q$         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date
           and not exists (select 1 from integracao_preco p where p.provedor = 'locationiq')), 0),$q$;
  novo := replace(src, ancora, add);
  execute 'create or replace function public.qa_invariantes() returns table('
        || 'chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) '
        || 'language sql stable set search_path to ''public'' as $f$' || novo || '$f$';
end $do$;
