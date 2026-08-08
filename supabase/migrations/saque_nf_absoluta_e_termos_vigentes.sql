-- ============================================================================
-- NF ABSOLUTA PARA TODA CLASSE + ACEITE DOS TERMOS COMO PRÉ-REQUISITO DE SAQUE
-- (08/08, correções do dono sobre a primeira versão de `regras_negocio_saque_teto_nf`)
--
-- 1. NOTA FISCAL ACIMA DE R$ 2.500/MÊS É ABSOLUTA. Palavras do dono: "essa regra
--    deve ser absoluta para todas as classes incluindo equipe, visto questões
--    fiscais. Toda classe incluindo a equipe deveria emitir nota fiscal, mas isso
--    seria uma trava nessa fase inicial." Ou seja: o teto mensal é o meio-termo —
--    abaixo dele o dinheiro flui, acima dele a nota é obrigatória para QUALQUER
--    beneficiário. A versão anterior isentava a equipe; deixa de isentar.
--    O que continua restrito a PARCEIRO é a exigência de "estar em plano pago":
--    mandar um analista assinar plano para receber pelo próprio trabalho não faz
--    sentido, e não é disso que a regra fiscal trata.
--
-- 2. TERMOS NOVOS, TODO PARCEIRO RE-ACEITA. "Atualiza os termos e todos os que já
--    são parceiros devem aceitar. Essas atualizações de termo não precisa bater
--    foto nenhuma novamente, basta aceitar." Então: nada de KYC novo — o gate é o
--    aceite, e ele vive AQUI, no servidor. O popup de re-aceite já existia
--    (`TermosAtualizadosModal`), mas popup se fecha; regra de saque, não.
--    A versão exigida (`termos_uso-v3.3`) precisa casar com `TERMOS_VERSAO` em
--    `src/utils/termos.js` — as duas pontas sobem juntas.
--
-- Equipe operacional fica de fora SÓ do aceite (recebe por função, não por adesão
-- a um programa de parceiros) — mas está DENTRO do teto e da nota fiscal.
--
-- Idempotente. As alterações em `saque_avaliar` são feitas por substituição
-- verificada sobre a definição VIVA: cada troca confere que encontrou exatamente
-- uma ocorrência e aborta a migração se o código mudou de forma — melhor falhar
-- alto do que aplicar meia mudança numa função que decide pagamento.
-- ============================================================================

insert into public.regra_negocio (chave, valor, descricao, aplicada_por) values
  ('saque.exige_termos_vigentes',
   '{"ativo": true, "versao": "termos_uso-v3.3", "escopo": "parceiro"}'::jsonb,
   'Saque de parceiro exige aceite da versão VIGENTE dos termos. Sobe junto com TERMOS_VERSAO em src/utils/termos.js — as duas pontas precisam casar. Sem KYC novo: basta aceitar. Equipe operacional isenta (recebe por função, não por adesão a programa).',
   array['saque_avaliar'])
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, atualizado_em = now();

update public.regra_negocio
   set valor = valor || '{"escopo": "todos", "exige_pagante_escopo": "parceiro"}'::jsonb,
       descricao = 'Teto de saque, por mês-calendário, que dispensa nota fiscal. ABSOLUTO: vale para TODA classe, inclusive equipe — a exigência de NF acima do teto é FISCAL (decisão do dono, 08/08: o ideal seria nota em qualquer valor, mas travaria a fase inicial). A exigência adicional de ESTAR EM PLANO PAGO acima do teto vale só para PARCEIRO. Para virar teto vitalício, troque "janela" para "vitalicio".',
       atualizado_em = now()
 where chave = 'saque.teto_sem_nf';

do $do$
declare src text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'saque_avaliar';
  if src is null then raise exception 'saque_avaliar não encontrada'; end if;

  -- (1) A equipe volta a ser alcançada pelo teto/NF.
  n := (length(src) - length(replace(src, '  if v_equipe then v_acima := false; end if;', ''))) / length('  if v_equipe then v_acima := false; end if;');
  if n <> 1 then raise exception 'isencao: esperava 1, achei %', n; end if;
  src := replace(src, '  if v_equipe then v_acima := false; end if;', '');

  -- ...mas "precisa assinar um plano" continua sendo coisa de parceiro.
  n := (length(src) - length(replace(src, ')::boolean, true) and not v_pagante then', ''))) / length(')::boolean, true) and not v_pagante then');
  if n <> 1 then raise exception 'pagante: esperava 1, achei %', n; end if;
  src := replace(src, ')::boolean, true) and not v_pagante then',
                      ')::boolean, true) and not v_pagante and not v_equipe then');

  -- (2) Aceite dos termos vigentes entra como item de "faltando": some no instante
  --     em que o parceiro aceita, sem exigir nada além do clique.
  n := (length(src) - length(replace(src, '  if v_pagante then' || chr(10) || '    if v_p.cnpj is null', ''))) / length('  if v_pagante then' || chr(10) || '    if v_p.cnpj is null');
  if n <> 1 then raise exception 'ancora termos: esperava 1, achei %', n; end if;
  src := replace(src, '  if v_pagante then' || chr(10) || '    if v_p.cnpj is null',
    '  if coalesce((public.regra(''saque.exige_termos_vigentes'')->>''ativo'')::boolean, false)' || chr(10) ||
    '     and not v_equipe' || chr(10) ||
    '     and coalesce(v_p.termos_uso_versao, '''') <> coalesce(public.regra(''saque.exige_termos_vigentes'')->>''versao'', '''') then' || chr(10) ||
    '    v_faltando := array_append(v_faltando, ''aceite da versão atual dos Termos (basta aceitar — nenhum documento novo)'');' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    '  if v_pagante then' || chr(10) || '    if v_p.cnpj is null');

  n := (length(src) - length(replace(src, 'pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada', ''))) / length('pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada');
  if n <> 1 then raise exception 'select perfil: esperava 1, achei %', n; end if;
  src := replace(src, 'pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada',
                      'pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada, termos_uso_versao');

  execute src;
end $do$;

revoke all on function public.saque_avaliar(uuid, numeric) from public, anon, authenticated;
