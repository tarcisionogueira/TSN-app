-- 01/09 — Motor do Instagram, peça 2: O RASCUNHO, E A RÉGUA QUE O PROMOVE.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- POR QUE TABELA PRÓPRIA, e não um campo em `ig_mensagens`:
--
--   1. `ig_mensagens` é o CORPUS DE TREINO. Um rascunho que ninguém enviou não é exemplo de
--      nada — e, gravado ali com `autor='bot'`, seria indistinguível de mensagem enviada. O
--      modelo aprenderia com texto que o mundo nunca viu e que talvez fosse justamente o que
--      o dono rejeitou.
--   2. **A RÉGUA DE PROMOÇÃO SÓ EXISTE SE OS DOIS TEXTOS COEXISTIREM.** A regra é "uma classe
--      vira autônoma quando o dono envia o rascunho SEM EDITAR em 8 de 10 casos". Isso exige
--      comparar o que o motor sugeriu com o que de fato saiu. Guardar um campo só apagaria a
--      diferença — e a régua viraria opinião, que é exatamente o que ela existe para não ser.
--
-- ⚠️ ESTE ARQUIVO NÃO ENVIA NADA, e a tabela também não. `enviado_em` e `texto_enviado`
-- nascem NULOS e só são preenchidos pela peça seguinte (`_ig-envio.js`). Enquanto ela não
-- existe, todo rascunho fica aqui esperando — que é o estado seguro.

create table if not exists public.ig_rascunho (
  id             bigint generated always as identity primary key,
  -- UNIQUE = o CLAIM. Duas execuções do cron que se sobreponham não geram dois rascunhos
  -- para a mesma mensagem, e o segundo insert falha em vez de gastar uma chamada de IA a
  -- mais. É a mesma ideia do UNIQUE em `ig_mensagens.mid`, aplicada ao trabalho e não ao dado.
  mid_origem     text not null unique,
  ig_user_id     text not null,
  origem         text,
  janela         text,
  vence_em       timestamptz,
  classe         text,
  classe_conf    numeric,
  texto_sugerido text,
  acao           text not null check (acao in ('enviar', 'rascunho', 'perdido', 'ignorar')),
  motivo         text,
  modelo         text,
  criado_em      timestamptz not null default now(),
  -- Preenchidos SÓ quando a mensagem realmente sai. `texto_enviado` guarda o que o dono
  -- mandou de verdade: se ele editou, os dois diferem, e é essa diferença que a régua lê.
  enviado_em     timestamptz,
  texto_enviado  text
);

comment on table public.ig_rascunho is
  'O que o motor SUGERIU para cada mensagem, com a decisão e o motivo. Separada de ig_mensagens '
  'por dois motivos: não poluir o corpus de treino com texto nunca enviado, e permitir comparar '
  'sugerido × enviado — que é a única forma de medir a régua de promoção.';

comment on column public.ig_rascunho.mid_origem is
  'UNIQUE, e é o CLAIM do cron: duas execuções sobrepostas não geram trabalho duplicado nem '
  'gastam duas chamadas de IA para a mesma mensagem.';

comment on column public.ig_rascunho.motivo is
  'POR QUE esta foi a decisão (classe_nao_autonoma, persona_proibida:<frase>, janela_expirada…). '
  'Quando o dono perguntar "por que isto não saiu sozinho?", a resposta tem de estar no dado.';

create index if not exists ig_rascunho_pendente_idx
  on public.ig_rascunho (criado_em desc) where enviado_em is null;

alter table public.ig_rascunho enable row level security;
revoke insert, update, delete, truncate on public.ig_rascunho from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- A RÉGUA — "8 de 10 enviados sem editar" vira número, não impressão
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Compara `texto_sugerido` com `texto_enviado` normalizando espaço em branco: quebra de linha
-- a mais não é edição de conteúdo, e contá-la como edição faria a régua nunca liberar nada.
create or replace function public.ig_taxa_sem_edicao(minimo int default 10)
returns table (classe text, enviados bigint, sem_edicao bigint, pct numeric, veredito text)
language sql
stable
security definer
set search_path = public
as $$
  with env as (
    select r.classe,
           regexp_replace(btrim(coalesce(r.texto_sugerido, '')), '\s+', ' ', 'g')
             = regexp_replace(btrim(coalesce(r.texto_enviado, '')),  '\s+', ' ', 'g') as igual
      from public.ig_rascunho r
     where r.enviado_em is not null
       and r.texto_enviado is not null
  )
  select e.classe,
         count(*),
         count(*) filter (where e.igual),
         round(100.0 * count(*) filter (where e.igual) / nullif(count(*), 0), 0),
         case
           -- "Não sei" tem saída própria. Sem amostra, qualquer percentual seria plausível e
           -- mediria outra coisa — 1 de 1 daria 100% e liberaria uma classe por acidente.
           when count(*) < minimo then format('AMOSTRA INSUFICIENTE (%s de %s)', count(*), minimo)
           when count(*) filter (where e.igual) * 10 >= count(*) * 8 then 'PODE VIRAR AUTONOMA (>= 80%)'
           else 'AINDA NAO — a persona nao esta pronta para esta classe'
         end
    from env e
   group by e.classe
   order by 2 desc;
$$;

comment on function public.ig_taxa_sem_edicao(int) is
  'A régua de promoção: % de rascunhos que o dono enviou SEM EDITAR, por classe. Abaixo do '
  'mínimo devolve AMOSTRA INSUFICIENTE em vez de um percentual — 1 de 1 daria 100% e liberaria '
  'uma classe por acidente, que é a forma de falha nº 10 dentro do próprio instrumento.';

revoke all on function public.ig_taxa_sem_edicao(int) from public, anon, authenticated;
