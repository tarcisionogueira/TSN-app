-- 09/09: pedido do dono — "as pessoas que se inscreverem ainda não estão no grupo. preciso de
-- mensagens que chamem a atenção pra ficar lá."
--
-- ACHADO: `whatsapp_fila_live` (a fila de "Convite por WhatsApp") EXCLUI explicitamente quem já
-- está em `live_inscricoes` desta edição — ela existe pra convidar quem AINDA NÃO se inscreveu.
-- No momento em que alguém se inscreve, ela some da fila e não recebe NENHUM WhatsApp de
-- acompanhamento — só o e-mail de confirmação, que já tem o link do grupo, mas como linha
-- opcional/discreta ("Se quiser acompanhar os avisos por lá também"). Zero atenção, zero
-- urgência, um canal só (e-mail tem taxa de abertura muito menor que WhatsApp).
--
-- Esta migração cria a fonte de dados pra uma NOVA fila, irmã da existente, mas para quem JÁ
-- se inscreveu e ainda não foi convidado a entrar no grupo — tabela de log SEPARADA (não mexe
-- em whatsapp_disparo_log/whatsapp_disparo_unico, que já funciona pra "convite pra aula") para
-- zero risco de regressão na fila existente.

create table if not exists public.whatsapp_disparo_grupo_log (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos_live(id) on delete cascade,
  edicao date not null,
  user_id uuid references public.perfis(id) on delete cascade,
  enviado_por uuid references public.perfis(id),
  criado_em timestamptz not null default now()
);

create unique index if not exists whatsapp_disparo_grupo_unico
  on public.whatsapp_disparo_grupo_log (evento_id, edicao, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.whatsapp_disparo_grupo_log enable row level security;
-- Mesma política de acesso de `whatsapp_disparo_log`: zero policy para authenticated/anon —
-- só o service_role (usado pela API admin) lê/escreve. Telefone e e-mail de inscrito são PII.

-- Fila de quem se inscreveu na aula viva e ainda não recebeu o convite pro grupo, nesta
-- edição. Fonte é `live_inscricoes` (não `perfis`) porque o WhatsApp da INSCRIÇÃO é o dado
-- mais fresco e mais provável de estar certo — pode divergir do perfil se a pessoa já tinha
-- conta com outro número cadastrado.
create or replace function public.whatsapp_fila_grupo(p_evento uuid, p_edicao date)
returns table(user_id uuid, nome text, cidade text, uf text, telefone_wa text, inscrito_em timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.user_id, i.nome, i.cidade, i.uf,
         case when length(regexp_replace(coalesce(i.whatsapp,''), '\D', '', 'g')) in (10, 11)
              then '55' || regexp_replace(i.whatsapp, '\D', '', 'g')
              else regexp_replace(i.whatsapp, '\D', '', 'g') end,
         i.criado_em
    from public.live_inscricoes i
   where i.evento_id = p_evento and i.edicao = p_edicao
     and length(regexp_replace(coalesce(i.whatsapp,''), '\D', '', 'g')) between 10 and 13
     and not exists (select 1 from public.whatsapp_disparo_grupo_log g
                      where g.evento_id = p_evento and g.edicao = p_edicao
                        and coalesce(g.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
                          = coalesce(i.user_id, '00000000-0000-0000-0000-000000000000'::uuid))
   order by i.criado_em asc;
$function$;
