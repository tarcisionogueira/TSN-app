-- ─────────────────────────────────────────────────────────────────────────────────────────
-- perfis.role: o DEFAULT da coluna violava o CHECK da própria coluna — 17/08/2026
--
--     column_default : 'aluno'::text
--     perfis_role_check : role IN (admin, explorador, top1, top2, assessorado, clube,
--                                  consultor, analista, advogado)
--
-- 'aluno' é papel de uma encarnação ANTIGA do produto, que não existe mais — o mesmo que a
-- limpeza de 10/08 tirou do helper `signUp` (ver o comentário em src/utils/supabase.js:91) e
-- que sobreviveu aqui, no default, onde ninguém olha.
--
-- EFEITO: **todo INSERT em `perfis` que não escreve `role` explicitamente falha**, porque o
-- valor que o banco preenche sozinho é justamente o único que a restrição proíbe. Não é um
-- caso de borda: é o caminho normal.
--
-- COMO APAREÇEU. O dono perguntou se o mercadológico estava ok. Estava — a falha dele foi um
-- `anthropic_http_529` (sobrecarga do fornecedor) às 14:11, recuperado na retentativa, com o
-- relatório saindo `concluida` às 14:13. Mas nos mesmos logs estava isto, às 16:22:33:
--
--     [assinar-com-cadastro] perfil NÃO gravado user=ad5c4357… status=400
--     new row for relation "perfis" violates check constraint "perfis_role_check"
--
-- e, no MESMO segundo, o `/checkout` "Failed to fetch" que estava aberto e sem causa
-- identificada desde 16/08 (4 ocorrências). São o mesmo evento visto dos dois lados: o
-- endpoint morre no constraint, o navegador vê a requisição falhar.
--
-- A IRONIA: `assinar-com-cadastro.js:151` diz, em letras maiúsculas, "NUNCA role/plano aqui"
-- — e está CERTO. Foi a correção de 16/08, quando gravar `plano:'top2'` violava
-- `perfis_plano_check` e derrubava o upsert inteiro dentro de um try/catch que só logava.
-- Consertou-se o código para parar de escrever o campo, e aí o banco passou a escrever
-- sozinho um valor pior. A regra "não escreva role aqui" só é segura se o DEFAULT for válido.
--
-- QUEM PAGOU A CONTA: o cliente de 16:22 teve o cadastro criado pelo gatilho de auth.users
-- (por isso o perfil existe) e depois pagou às 17:01, então o acesso saiu. O que se perdeu
-- foi o que ESTE endpoint grava: os **dados fiscais para NFS-e**. Nota fiscal de um cliente
-- pagante, sem os dados, é problema de outra natureza.
--
-- 'explorador' é o default correto: é o papel do usuário recém-criado sem pagamento, o mesmo
-- que `assinar-com-cadastro.js:87` já coloca no metadata da conta, e o mesmo para onde toda
-- a lógica de rebaixamento converge.
-- ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.perfis alter column role set default 'explorador';

-- Nenhuma linha existente muda: DEFAULT só vale para INSERT que omite a coluna. O reparo é
-- de comportamento futuro, e é onde o dano estava.

comment on column public.perfis.role is
  'Papel do usuário. O DEFAULT precisa SEMPRE ser um valor aceito por perfis_role_check — até 17/08 era ''aluno'', papel de uma encarnação antiga do produto que a própria restrição proíbe, e por isso todo INSERT que omitisse role falhava (era a causa do "Failed to fetch" no /checkout). Ao mexer na restrição, confira o default junto.';
