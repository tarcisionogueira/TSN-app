-- Fecha o vazamento de PII em contratos_link (auditoria id=9, achado 16).
--
-- Problema: a policy "Público acessa contrato pelo token" (SELECT p/ role public)
-- tinha qual = status IN ('aguardando','aguardando_assinatura') AND expira_em>now(),
-- SEM predicado de token → qualquer anônimo fazia `select * from contratos_link
-- where status='aguardando'` e lia kyc_fotos (fotos de identidade em Data URL) +
-- assinante_email de TODOS os contratos pendentes.
--
-- Correção: acesso público passa a ser SÓ pelo token exato, via RPC SECURITY
-- DEFINER (o ContratoLink.jsx chama supabase.rpc('get_contrato_por_token')). Sem o
-- token secreto do link não há como enumerar contratos. Os demais acessos
-- (equipe/criador/assinante logado) seguem por suas policies próprias.
--
-- ORDEM DE APLICAÇÃO EM PRODUÇÃO: (1) criar a RPC; (2) subir o client que usa a
-- RPC; (3) só então derrubar a policy pública (o client novo funciona com ou sem
-- ela, então derrubar antes do deploy quebraria o client antigo).

create or replace function public.get_contrato_por_token(p_token text)
returns setof public.contratos_link
language sql
security definer
set search_path to 'public'
as $function$
  select * from public.contratos_link
  where token = p_token
  limit 1;
$function$;

revoke all on function public.get_contrato_por_token(text) from public;
grant execute on function public.get_contrato_por_token(text) to anon, authenticated;

-- Passo 3 (aplicar após o deploy do client que usa a RPC):
drop policy if exists "Público acessa contrato pelo token" on public.contratos_link;
