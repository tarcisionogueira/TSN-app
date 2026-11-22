-- Chamado de WhatsApp com SEGMENTO (22/11): sem ele, todo chamado de cliente cadastrado caía em
-- 'outro' e a fila de cada papel (consultor = não-clientes, analista = clientes) ficava errada.
-- Mesmo mapa de `segmentoDoRole` em src/components/ChatSuporte.jsx — mudou lá, mude aqui.
create or replace function public.wa_segmento_do_usuario(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p.role when 'explorador' then 'explorador' when 'top2' then 'investidor'
                     when 'assessorado' then 'assessorado' when 'clube' then 'clube' else 'outro' end
    from perfis p where p.id = p_user
$$;
revoke all on function public.wa_segmento_do_usuario(uuid) from public, anon, authenticated;

create or replace function public.wa_espelhar_no_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c        public.wa_conversas%rowtype;
  ch_id    uuid;
  ch_st    text;
  rotulo   text;
begin
  if new.chamado_msg_id is not null then return new; end if;
  select * into c from public.wa_conversas where telefone = new.telefone;
  if not found then return new; end if;

  if c.chamado_id is not null then
    select id, status into ch_id, ch_st from public.chamados where id = c.chamado_id;
  end if;
  rotulo := coalesce(nullif(c.nome, ''), case when new.telefone like '%@%' then 'contato' else '+' || new.telefone end);

  if ch_id is null or ch_st = 'finalizado' then
    insert into public.chamados (user_id, user_nome, titulo, status, canal, origem, segmento, criado_em, atualizado_em)
    values (c.user_id, rotulo, left('WhatsApp · ' || rotulo, 80),
            case when new.autor = 'pessoa' then 'aberto' else 'saudacao' end,
            'whatsapp', 'whatsapp',
            case when c.user_id is not null then public.wa_segmento_do_usuario(c.user_id) end,
            now(), now())
    returning id, status into ch_id, ch_st;
    update public.wa_conversas set chamado_id = ch_id where telefone = new.telefone;
  end if;

  insert into public.chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo, canal, criado_em)
  values (ch_id,
          case new.autor when 'pessoa' then 'cliente' when 'ia' then 'ia' else 'atendente' end,
          case new.autor when 'pessoa' then rotulo when 'ia' then 'BidPro Assistente' else 'Equipe (celular)' end,
          coalesce(nullif(new.texto, ''), '[' || coalesce(new.tipo, 'mensagem') || ']'),
          'whatsapp', coalesce(new.ocorrido_em, now()));

  update public.chamados
     set atualizado_em = now(),
         status = case when new.autor = 'pessoa' and status = 'saudacao' then 'aberto' else status end
   where id = ch_id;
  return new;
end $$;

create or replace function public.wa_conversa_sincroniza_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.chamado_id is null then return new; end if;
  if new.escalada_em is distinct from old.escalada_em and new.escalada_em is not null then
    update public.chamados set status = 'aguardando_atendente', atualizado_em = now()
     where id = new.chamado_id and status in ('saudacao', 'aberto');
  end if;
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    update public.chamados set user_id = new.user_id,
           segmento = coalesce(segmento, public.wa_segmento_do_usuario(new.user_id))
     where id = new.chamado_id and user_id is null;
  end if;
  return new;
end $$;
