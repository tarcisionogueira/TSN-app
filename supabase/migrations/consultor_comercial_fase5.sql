-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSULTOR COMERCIAL — FASE 5: NPS do cliente (a contraprova independente).
-- 15 dias após o consultor confirmar o atendimento, o SISTEMA pergunta ao cliente:
-- conseguiu contratar? nota? — é a resposta dele que denuncia o "perdido" que
-- fechou por fora e o "ganho" inflado.
--
-- As três funções são de OPERAÇÃO (chamadas pelo cron/API com service key; revogadas
-- de anon/authenticated). A janela e o gatilho são LIDOS de
-- regra('comercial.nps_cliente_15d') — regra é dado; mudar os 15 dias é um UPDATE em
-- regra_negocio, sem deploy. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Pendentes de ENVIO: leads com o evento-gatilho vencido, e-mail presente e sem NPS
-- enviado. Cria a linha (com token) se não existir — criação e listagem numa operação
-- só, para o cron não ter janela de corrida entre "criar" e "enviar".
create or replace function public.nps_alavancagem_pendentes()
returns table (lead_id uuid, nome text, email text, produto text, token text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
-- Os nomes de SAÍDA (lead_id/token) também são colunas nas tabelas usadas — sem o
-- pragma, o plpgsql acusa ambiguidade no INSERT. Aqui, coluna vence.
#variable_conflict use_column
declare
  v_regra jsonb := public.regra('comercial.nps_cliente_15d');
  v_dias int; v_gatilho text;
begin
  if v_regra is null or coalesce((v_regra->>'ativo')::boolean, true) is false then
    return;   -- regra desligada = NPS desligado (sem regra não se envia nada)
  end if;
  v_dias := coalesce((v_regra->>'dias')::int, 15);
  v_gatilho := coalesce(v_regra->>'gatilho', 'atendimento_confirmado');

  -- garante a linha do NPS (token novo) para todo lead elegível ainda sem linha.
  -- Token = 2 UUIDs (64 hex): nativo do Postgres — gen_random_bytes é do pgcrypto,
  -- que na Supabase mora no schema `extensions`, fora do search_path desta função.
  insert into public.sdr_lead_nps (lead_id, token)
  select l.id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    from public.sdr_leads l
   where l.origem like 'alavancagem_%' and l.email is not null
     and exists (select 1 from public.sdr_lead_eventos ev
                  where ev.lead_id = l.id and ev.tipo = v_gatilho
                    and ev.criado_em <= now() - make_interval(days => v_dias))
     and not exists (select 1 from public.sdr_lead_nps n where n.lead_id = l.id)
  on conflict (lead_id) do nothing;

  return query
  select l.id, l.nome, l.email,
         case l.origem when 'alavancagem_home_equity' then 'Home Equity'
                       when 'alavancagem_consorcio' then 'Consórcio' else l.origem end,
         n.token
    from public.sdr_lead_nps n
    join public.sdr_leads l on l.id = n.lead_id
   where n.enviado_em is null and l.email is not null;
end $$;

-- Marca o envio (SÓ depois de o e-mail sair de verdade — o cron confere o resultado
-- do Resend antes de chamar) + evento na trilha.
create or replace function public.nps_alavancagem_marcar_enviado(p_lead uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.sdr_lead_nps set enviado_em = now() where lead_id = p_lead and enviado_em is null;
  if found then
    insert into public.sdr_lead_eventos (lead_id, autor_id, autor_papel, tipo, comentario)
    values (p_lead, null, 'sistema', 'nps_enviado', 'Pesquisa de satisfação enviada ao cliente (regra comercial.nps_cliente_15d)');
  end if;
end $$;

-- Resposta do CLIENTE, pelo token do e-mail (sem login). Uma resposta por lead;
-- token inválido/expirado/já usado = exceção com mensagem própria (a API traduz).
create or replace function public.nps_alavancagem_responder(
  p_token text, p_contratou boolean, p_nota int, p_comentario text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_nps public.sdr_lead_nps;
begin
  select * into v_nps from public.sdr_lead_nps where token = p_token for update;
  if not found then raise exception 'token_invalido'; end if;
  if v_nps.enviado_em is null then raise exception 'token_invalido'; end if;   -- só responde o que foi enviado
  if v_nps.respondido_em is not null then raise exception 'ja_respondido'; end if;
  if p_nota is null or p_nota < 0 or p_nota > 10 then raise exception 'nota_invalida'; end if;
  update public.sdr_lead_nps
     set respondido_em = now(), contratou = p_contratou, nota = p_nota,
         comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), '')
   where id = v_nps.id;
  insert into public.sdr_lead_eventos (lead_id, autor_id, autor_papel, tipo, comentario)
  values (v_nps.lead_id, null, 'cliente', 'nps_respondido',
          'Cliente respondeu: ' || case when p_contratou then 'CONTRATOU' else 'não contratou' end
          || ' · nota ' || p_nota);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.nps_alavancagem_pendentes() from public, anon, authenticated;
revoke all on function public.nps_alavancagem_marcar_enviado(uuid) from public, anon, authenticated;
revoke all on function public.nps_alavancagem_responder(text, boolean, int, text) from public, anon, authenticated;

-- A regra sai da gaveta: ATIVA, aplicada pelas funções acima (a janela/gatilho moram
-- no valor — mudar os 15 dias é editar aqui, sem deploy).
update public.regra_negocio
   set ativo = true,
       valor = '{"ativo":true,"dias":15,"gatilho":"atendimento_confirmado","perguntas":["contratou","nota","comentario"]}',
       descricao = 'NPS ao cliente 15 dias após a confirmação do atendimento (dono, 21/08): contratou? nota? comentário — contraprova do relato do consultor',
       aplicada_por = array['nps_alavancagem_pendentes'],
       atualizado_em = now()
 where chave = 'comercial.nps_cliente_15d';
