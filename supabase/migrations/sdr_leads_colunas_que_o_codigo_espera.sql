-- LEADS SILENCIOSAMENTE PERDIDOS — schema de `sdr_leads` não bate com quem escreve NEM com
-- quem lê (achado do bug bounty 02/08; `select count(*) from sdr_leads` = **0**, nenhum lead
-- jamais gravado).
--
-- Quem ESCREVE manda colunas que não existem → PostgREST 400 → catch vazio → lead evapora:
--   api/sdr-capturar.js:113   → respostas, user_id, consultor_id
--   api/promo-capturar.js:143 → respostas, user_id, consultor_id
--   api/duvida.js:69          → whatsapp NULL quando o visitante não informa telefone,
--                               mas a coluna é NOT NULL → viola a constraint
-- Quem LÊ pede as mesmas colunas e recebe 400:
--   src/pages/Admin.jsx:4934 (consultor_id,status) · :7133 (user_id,origem)
--   api/health-check.js:292  (consultor_id=is.null → o item de saúde nunca acusa nada)
--
-- Impacto agora: os formulários públicos de dúvida (Landing e Planos — exatamente onde cai o
-- tráfego PAGO do Google Ads) e as promoções gravam o lead em lugar nenhum, sem erro visível.
-- Ainda não houve perda real (0 dúvidas enviadas até 02/08) — a armadilha está armada para o
-- primeiro visitante que preencher.
--
-- `sdr_produtos.perguntas` idem: `src/pages/ProdutoLanding.jsx:110` lê `produto.perguntas`
-- para montar o questionário; sem a coluna o passo de perguntas simplesmente não aparece.

alter table public.sdr_leads
  add column if not exists respostas    jsonb,
  add column if not exists user_id      uuid references auth.users(id) on delete set null,
  add column if not exists consultor_id uuid references public.perfis(id) on delete set null;

-- Dúvida pública não exige telefone (o formulário da Landing tem o campo opcional).
alter table public.sdr_leads alter column whatsapp drop not null;

-- Índices das FKs (o lead é lido por dono/consultor; evita seq scan quando o volume crescer).
create index if not exists sdr_leads_user_id_idx      on public.sdr_leads (user_id)      where user_id is not null;
create index if not exists sdr_leads_consultor_id_idx on public.sdr_leads (consultor_id) where consultor_id is not null;

alter table public.sdr_produtos
  add column if not exists perguntas jsonb;

comment on column public.sdr_leads.respostas    is 'Respostas do questionário da landing do produto/promoção (ProdutoLanding.jsx).';
comment on column public.sdr_leads.user_id      is 'Conta criada junto com a captura do lead (sdr-capturar/promo-capturar).';
comment on column public.sdr_leads.consultor_id is 'Vendedor/consultor dono do lead — nulo = lead sem responsável (o health-check cobra).';
