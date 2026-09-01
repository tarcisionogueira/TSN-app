-- ============================================================================
-- FILA DE WHATSAPP DA AULA — ordenada por quem tem mais chance de responder
--
-- POR QUE EXISTE (01/09). O e-mail já fala com a base inteira, mas 55 pessoas
-- ignoraram convite E reforço. Para elas o WhatsApp é o único canal que sobra —
-- e não há como disparar sozinho: `wa.me` ABRE a conversa com o texto pronto,
-- quem aperta enviar é a pessoa. API oficial exige template aprovado e opt-in
-- explícito; API não-oficial bane o número do próprio negócio. Então a mecânica
-- é assistida, e o que esta migração entrega é a ORDEM e a PROVA.
--
-- A ORDEM É O PRODUTO. Medido em 01/09, dos 82 elegíveis: 6 pagantes · 21 que
-- abriram o e-mail · 55 que ignoraram tudo. Os 27 primeiros levam ~7 minutos e
-- concentram quase todo o valor. Uma lista solta faria o dono começar pelo
-- alfabeto e desistir no meio, tendo falado com quem menos importa.
--
-- O LOG NÃO É BUROCRACIA, É O QUE DEIXA PARAR NO MEIO. Sem ele, interromper aos
-- 12 significa recomeçar do zero ou duplicar mensagem — e mensagem repetida no
-- WhatsApp custa mais caro que mensagem nenhuma.
--
-- ⚠️ A COLUNA DE CIDADE EM `perfis` É `endereco_cidade`, NÃO `cidade`. A primeira
-- versão desta migração usou `p.cidade` e o banco REPROVOU na hora — que é o
-- desfecho certo. Vale registrar porque a família do defeito é conhecida aqui
-- (forma #6, a coluna que não é a mesma em todas as tabelas): `live_inscricoes`
-- tem `cidade`/`uf`, `perfis` tem `endereco_cidade`/`endereco_uf`, e escrever a
-- consulta olhando a tabela errada produz 400 que vira lista vazia no cliente.
-- ============================================================================

create table if not exists public.whatsapp_disparo_log (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos_live(id) on delete cascade,
  edicao     date not null,
  user_id    uuid not null references public.perfis(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  enviado_por uuid references public.perfis(id)
);

-- Uma vez por pessoa por edição. Na semana seguinte a edição muda e a pessoa
-- volta para a fila — que é o certo: a aula é semanal.
create unique index if not exists whatsapp_disparo_unico
  on public.whatsapp_disparo_log (evento_id, user_id, edicao);

alter table public.whatsapp_disparo_log enable row level security;

comment on table public.whatsapp_disparo_log is
  'Quem já recebeu o WhatsApp manual de convite da aula, por edição. Permite parar no meio e retomar sem duplicar.';

-- ─── A fila ──────────────────────────────────────────────────────────────────
-- Devolve telefone SÓ dos dígitos, no formato que o `wa.me` espera (55 + DDD +
-- número). Número mal formado não entra: um `wa.me/5511` abre o WhatsApp num
-- contato inexistente e queima o clique sem avisar.
create or replace function public.whatsapp_fila_live(p_evento uuid, p_edicao date)
returns table (
  user_id uuid, nome text, cidade text, uf text, role text,
  telefone_wa text, prioridade int, motivo text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.nome, p.endereco_cidade as cidade, p.endereco_uf as uf, p.role, p.created_at,
           regexp_replace(p.telefone, '\D', '', 'g') as dig,
           exists(select 1 from public.emails_log l
                   where l.user_id = p.id
                     and l.tipo in ('convite_live','live_reforco_assunto','live_reforco_prova')
                     and l.aberto_em is not null) as abriu
      from public.perfis p
     where p.ativo
       and coalesce(p.role,'') <> 'admin'
       and p.telefone is not null
       -- nunca para quem já está inscrito
       and not exists (select 1 from public.live_inscricoes i
                        where i.evento_id = p_evento and i.user_id = p.id)
       -- nunca para quem pediu para não receber
       and not exists (select 1 from public.alertas_email a
                        where a.user_id = p.id and a.ativo = false)
       -- nunca duas vezes na mesma edição
       and not exists (select 1 from public.whatsapp_disparo_log w
                        where w.evento_id = p_evento and w.edicao = p_edicao and w.user_id = p.id)
  )
  select b.id, b.nome, b.cidade, b.uf, b.role,
         -- 10 ou 11 dígitos = número nacional, prefixa 55. Já com 12-13 dígitos
         -- assume-se que o DDI veio junto. Fora disso, descarta (filtro abaixo).
         case when length(b.dig) in (10, 11) then '55' || b.dig else b.dig end,
         case when b.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual') then 1
              when b.abriu then 2 else 3 end,
         case when b.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual') then 'pagante'
              when b.abriu then 'abriu o e-mail' else 'nao abriu o e-mail' end
    from base b
   where length(b.dig) between 10 and 13
   -- Dentro de cada faixa, o mais RECENTE primeiro: quem se cadastrou há dois
   -- dias lembra de você; quem entrou em junho precisa de contexto antes.
   order by 7, b.created_at desc;
$$;

-- Lê telefone de cliente: SECURITY DEFINER por necessidade, e o EXECUTE não fica
-- no PUBLIC. Revogar dos TRÊS — o Supabase concede a `anon` e `authenticated` por
-- default privilege, e `revoke ... from public` não tira grant de papel. Confira
-- em `pg_proc.proacl`: o esperado é {postgres=X/postgres,service_role=X/postgres}.
revoke all on function public.whatsapp_fila_live(uuid, date) from public, anon, authenticated;
grant execute on function public.whatsapp_fila_live(uuid, date) to service_role;
