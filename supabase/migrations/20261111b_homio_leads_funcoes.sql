-- Funções de apoio de `homio_leads` (11/11). Ficam no banco porque são escritas que precisam ser
-- atômicas (juntar um evento no jsonb sem ler-e-regravar) e um cruzamento com `perfis` que o
-- PostgREST não faz numa chamada só. Só o service role chama (RLS + sem grant novo).

-- Grava o desfecho de um aviso à Homio: sucesso carimba `homio_avisado[evento]` e tira o evento da
-- fila; falha põe na fila (sem duplicar), soma tentativa e guarda o motivo.
create or replace function public.homio_lead_registrar_aviso(p_id uuid, p_evento text, p_ok boolean, p_erro text default null)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.homio_leads set
    homio_avisado          = case when p_ok then homio_avisado || jsonb_build_object(p_evento, now()) else homio_avisado end,
    homio_aviso_pendente   = case when p_ok then array_remove(homio_aviso_pendente, p_evento)
                                  when p_evento = any(homio_aviso_pendente) then homio_aviso_pendente
                                  else array_append(homio_aviso_pendente, p_evento) end,
    homio_aviso_tentativas = case when p_ok then homio_aviso_tentativas else homio_aviso_tentativas + 1 end,
    homio_aviso_erro       = case when p_ok then null else left(p_erro, 300) end,
    atualizado_em          = now()
  where id = p_id;
$$;

-- Marca como ATIVADA a conta cuja dona já definiu a senha (perfis.senha_pendente = false) e põe o
-- aviso `conta_ativada` na fila para a Homio. Não marca no clique do link: leitor de antivírus
-- abre links sozinho, e isso viraria "ativou" sem ninguém ter entrado.
create or replace function public.homio_leads_marcar_ativados()
returns setof uuid
language sql
security invoker
set search_path = public
as $$
  update public.homio_leads h set
    ativado_em           = now(),
    homio_aviso_pendente = case when 'conta_ativada' = any(h.homio_aviso_pendente) then h.homio_aviso_pendente
                                else array_append(h.homio_aviso_pendente, 'conta_ativada') end,
    atualizado_em        = now()
  from public.perfis p
  where p.id = h.user_id
    and h.situacao = 'conta_criada'
    and h.ativado_em is null
    and p.senha_pendente = false
  returning h.id;
$$;
