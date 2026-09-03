-- 01/09 — As 6 tabelas que o health-check acusa há 3 rodadas: REVOGAR, não allowlistar.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O aviso "N tabela(s) com RLS mas SEM escrita do usuário" subiu 3 → 4 → 6 nas rodadas de
-- 31/08 06h, 31/08 22h e 01/09 06h, acompanhando as telas novas da aula e do curso. Ele
-- oferece duas saídas: "adicionar política de INSERT do dono, OU incluir na allowlist se
-- for só-servidor".
--
-- Medido, uma por uma — quem escreve em cada:
--   live_inscricoes ....... api/live-inscrever.js        (SERVICE_KEY)
--   live_convite_envio .... api/convidar-live-cron.js    (SERVICE_KEY)
--   live_reforco_envio .... api/live-reforco-cron.js     (SERVICE_KEY)
--   alerta_cobertura ...... api/enviar-alertas-cron.js   (SERVICE_KEY)
--   whatsapp_disparo_log .. api/admin-whatsapp-fila.js   (SERVICE_KEY)
--   curso_acesso .......... RPC curso_modulos_liberacao  (SECURITY DEFINER)
-- Nenhuma escrita do navegador. O único uso client-side é o Admin LENDO `live_inscricoes`.
-- São seis tabelas só-do-servidor: a segunda saída é a correta.
--
-- ─── MAS ALLOWLIST NÃO É A FORMA CERTA DESSA SAÍDA, E A LIÇÃO É DE ONTEM ──────────────
-- Em 31/08, sobre `registrar_marketing`: *"allowlist é registro de 'isto é público de
-- propósito'; enchê-la de função que só não é perigosa por acidente ensina a confiar menos
-- nela."* Vale igual aqui. Allowlistar deixaria o privilégio no lugar e só calaria o aviso.
--
-- E o privilégio é largo: as seis carregam o default do Supabase — anon E authenticated com
-- DELETE, INSERT, UPDATE e TRUNCATE. Hoje quem segura é só a RLS (todas com RLS ligada, e
-- tabela sem política nega tudo). Uma política de leitura acrescentada por engano numa
-- delas, ou um `enable row level security` que caia numa restauração, e o grant vira
-- escrita real de anônimo. Defesa em profundidade que hoje tem uma camada só.
--
-- Então revoga-se a ESCRITA. O `auditoria_uso` deixa de acusar por consequência — a
-- pré-condição dele é `has_table_privilege('authenticated', INSERT)` —, e não por exceção:
-- o aviso some porque o fato mudou, não porque foi silenciado.
--
-- SELECT fica INTACTO de propósito: o Admin lê `live_inscricoes` como `authenticated` e
-- `curso_acesso` tem política de leitura do próprio aluno. Revogar leitura aqui quebraria
-- a tela de inscritos na véspera da aula. Conferido depois de aplicar:
--   authenticated: SELECT em live_inscricoes = true · INSERT = false
--   service_role : INSERT em live_inscricoes e curso_acesso = true (intacto)
revoke insert, update, delete, truncate on public.live_inscricoes      from anon, authenticated;
revoke insert, update, delete, truncate on public.live_convite_envio   from anon, authenticated;
revoke insert, update, delete, truncate on public.live_reforco_envio   from anon, authenticated;
revoke insert, update, delete, truncate on public.alerta_cobertura     from anon, authenticated;
revoke insert, update, delete, truncate on public.whatsapp_disparo_log from anon, authenticated;
revoke insert, update, delete, truncate on public.curso_acesso         from anon, authenticated;
