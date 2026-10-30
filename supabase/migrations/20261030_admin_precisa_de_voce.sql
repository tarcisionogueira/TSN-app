-- admin_precisa_de_voce() — os contadores "precisa de você" dos botões de família do /admin.
--
-- Arena do painel (30/10): o dono abre o admin e não sabe onde há trabalho. Uma consulta SÓ, com
-- o que normalmente fica em ZERO (contador que nunca zera vira papel de parede em uma semana):
--   financeiro.a_classificar   lançamentos em 9.9 (decide se a DRE fecha)
--   financeiro.chargebacks     contestação aberta (tem prazo de defesa)
--   inicio.clientes_travados   cliente_travou(7) — tentou usar e não saiu nada
--   inicio.chamados_sem_resposta  chamado com mensagem DO CLIENTE parado há 3+ dias
--   operacional.fontes_zeradas fonte_regressao_pendente() com motivo 'zerou'
-- Cada contador roda no seu próprio bloco: se um falhar, ele volta NULL (a tela mostra "?") e os
-- outros seguem. NULL ≠ 0 — "não consegui contar" nunca pode parecer "está tudo em dia".
-- NÃO reaproveita admin_dashboard_contadores, que já estourou o limite de 8 s do `authenticated`.
create or replace function public.admin_precisa_de_voce()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_classificar int; v_cb int; v_travados int; v_chamados int; v_zeradas int;
begin
  if not public.is_admin() then
    raise exception 'acesso restrito a administradores' using errcode = '42501';
  end if;

  begin
    select count(*) into v_classificar from conciliacao_lancamento where conta = '9.9' or conta is null;
  exception when others then v_classificar := null; end;

  begin
    select count(*) into v_cb from chargebacks where status = 'aberto';
  exception when others then v_cb := null; end;

  begin
    select count(*) into v_travados from cliente_travou(7);
  exception when others then v_travados := null; end;

  begin
    select count(*) into v_chamados from chamados c
     where c.status = 'aberto' and c.criado_em < now() - interval '3 days'
       and exists (select 1 from chamados_mensagens m where m.chamado_id = c.id and m.autor_tipo = 'cliente');
  exception when others then v_chamados := null; end;

  begin
    select count(*) into v_zeradas from fonte_regressao_pendente() where motivo = 'zerou';
  exception when others then v_zeradas := null; end;

  return jsonb_build_object(
    'Financeiro',  jsonb_build_object('a_classificar', v_classificar, 'chargebacks', v_cb),
    'Início',      jsonb_build_object('clientes_travados', v_travados, 'chamados_sem_resposta', v_chamados),
    'Operacional', jsonb_build_object('fontes_zeradas', v_zeradas),
    'lido_em', now()
  );
end $$;

-- Sem REVOKE aqui de propósito: o conector MCP trava em REVOKE (CLAUDE.md, 0b). A porta é o
-- is_admin() no topo, que recusa anon e qualquer não-admin antes de ler qualquer coisa.
grant execute on function public.admin_precisa_de_voce() to authenticated;
