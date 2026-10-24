-- UNIVERSO OFICIAL DE LEILOEIROS POR ESTADO (24/10, pedido do dono).
--
-- Por que existe: o portal leilaoimovel.com.br agrega ~900 leiloeiros; numa amostra de 24, 7 não
-- estavam no nosso acervo (PR, RS, MT, RN). Em vez de descobrir leiloeiro por acaso, a fonte de
-- verdade passa a ser a LISTA PÚBLICA de cada Junta Comercial (matriculados), já feita para
-- JUCESP/JUCEMG em `leiloeiro_site_descoberto`/`leiloeiro_triagem`.
--
-- Uma linha por (uf, matricula). `site` é o que a Junta publica OU o descoberto depois (pelo
-- domínio do e-mail / busca) — `site_origem` diz qual, para não confundir dado oficial com
-- inferência (forma nº 10 do CLAUDE.md). `situacao` é o texto da Junta normalizado em
-- ATIVO / SUSPENSO / CANCELADO / OUTRO; `situacao_raw` guarda o original.
--
-- Contém PII de profissional (e-mail, telefone, cidade) publicada pela própria Junta — mesmo
-- assim fica com RLS LIGADA e SEM política: só o service_role lê/escreve (é insumo interno de
-- triagem, não tem uso de cliente).
create table if not exists public.leiloeiro_junta (
  id            bigint generated always as identity primary key,
  uf            text not null,
  junta         text not null,
  matricula     text not null,
  nome          text not null,
  nome_norm     text,
  situacao      text,
  situacao_raw  text,
  site          text,
  site_origem   text,          -- 'junta' | 'email' | 'busca'
  dominio       text,          -- host normalizado (sem www) do site, chave do cruzamento
  email         text,
  telefone      text,
  cidade        text,
  coletado_status text,        -- 'coletado' | 'agregador' | 'nao_coletado' | 'sem_site'
  coletado_via  text,          -- fonte/tenant/parser que já cobre (evidência do cruzamento)
  fonte_url     text,
  coletado_em   timestamptz not null default now(),
  unique (uf, matricula)
);

create index if not exists leiloeiro_junta_dominio_idx on public.leiloeiro_junta (dominio);
create index if not exists leiloeiro_junta_uf_sit_idx on public.leiloeiro_junta (uf, situacao);

comment on table public.leiloeiro_junta is
  'Leiloeiros matriculados por Junta Comercial (lista pública). Base do universo oficial por UF e do cruzamento com o que já coletamos (por domínio e nome). Só service_role.';

alter table public.leiloeiro_junta enable row level security;
-- Sem política de propósito: anon/authenticated não leem nada; service_role ignora RLS.
