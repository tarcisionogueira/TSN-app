-- ============================================================================
-- KYC ABSOLUTO — A EQUIPE TAMBÉM VERIFICA IDENTIDADE (08/08)
--
-- Decisão do dono: "a equipe coloca pra fazer a mesma verificação, batendo a
-- selfie e anexando o documento de identidade."
--
-- Fica coerente com a nota fiscal: os DOIS controles que protegem pagamento —
-- identidade e nota — passam a não ter exceção por papel. Quem recebe dinheiro
-- da plataforma prova quem é.
--
-- Histórico da regra, que é uma lição em si:
--   1. Nasceu valendo só para o PAGANTE → o parceiro grátis tinha MENOS controle
--      que o assinante, o inverso do pretendido.
--   2. Passou a valer para todo PARCEIRO.
--   3. Agora vale para TODA CLASSE, equipe inclusive.
--
-- Efeito imediato e esperado: nenhum dos usuários com saldo hoje tem identidade
-- validada, então TODOS ficam bloqueados até bater a selfie — inclusive o admin.
-- Isso é o comportamento pedido, não um efeito colateral. O popup do KYC passou a
-- aparecer para quem recebe por função (`KycParceiroModal`), que é o atalho para
-- resolver em um minuto.
-- ============================================================================

update public.regra_negocio
   set valor = valor || '{"escopo": "todos"}'::jsonb,
       descricao = 'Identidade validada (selfie + documento) é pré-requisito de QUALQUER saque, em qualquer valor e para QUALQUER classe — parceiro, prestador e equipe (decisão do dono, 08/08). Quem recebe dinheiro da plataforma prova quem é. Antes valia só para o pagante, o que deixava o grátis com MENOS controle que o assinante; depois passou a valer para parceiro; agora não tem exceção.',
       atualizado_em = now()
 where chave = 'saque.exige_kyc';

do $do$
declare src text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'saque_avaliar';
  if src is null then raise exception 'saque_avaliar não encontrada'; end if;

  n := (length(src) - length(replace(src, 'if v_exige_kyc and not v_equipe and not coalesce(v_p.identidade_validada, false) then', ''))) / length('if v_exige_kyc and not v_equipe and not coalesce(v_p.identidade_validada, false) then');
  if n <> 1 then raise exception 'kyc: esperava 1 ocorrencia, achei %', n; end if;
  src := replace(src, 'if v_exige_kyc and not v_equipe and not coalesce(v_p.identidade_validada, false) then',
                      'if v_exige_kyc and not coalesce(v_p.identidade_validada, false) then');

  execute src;
end $do$;

revoke all on function public.saque_avaliar(uuid, numeric) from public, anon, authenticated;
