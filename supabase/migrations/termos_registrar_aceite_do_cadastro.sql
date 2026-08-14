-- Termos: registrar o aceite que a pessoa JÁ DEU no cadastro (14/08).
--
-- PEDIDO DO DONO: "aceita um termo antes e outro depois fica estranho — poderia juntar no que
-- foi sinalizado antes?"
--
-- Para cadastros NOVOS isso já está resolvido: o formulário passa a enviar a versão aceita no
-- metadata e o `handle_new_user` a persiste (migração `handle_new_user_grava_termos_aceitos`).
-- Falta o meio do caminho — quem se cadastrou enquanto o defeito existia.
--
-- O CRITÉRIO, e por que ele é estreito de propósito. Marcar alguém como tendo aceitado uma
-- versão que essa pessoa nunca viu é FABRICAR REGISTRO DE CONSENTIMENTO, e isso não se faz.
-- Então só entram os perfis em que os três fatos coincidem:
--   (a) `lgpd_aceito = true` — o aceite existe, e o checkbox do cadastro é OBRIGATÓRIO: sem
--       marcá-lo o botão nem habilita, então o `true` prova que a pessoa aceitou o texto;
--   (b) `termos_uso_versao` NULA — o defeito é justamente não termos gravado QUAL;
--   (c) conta criada DEPOIS de 2026-08-08 13:46:55, o primeiro aceite registrado da v3.3 —
--       ou seja, num período em que o texto vigente comprovadamente já era a v3.3.
-- Com os três, a versão aceita não é suposição: é a única que existia para ser aceita.
--
-- Ficam de fora os 20 perfis com versão ANTIGA (v3.0/v3.2) ou anteriores a 08/08. Para esses o
-- modal é o comportamento CORRETO — os termos mudaram desde o aceite deles, e re-aceitar é o
-- que a mudança exige. Não é atrito, é conformidade.
--
-- Alcance medido em 14/08: 3 perfis (emanuel prodelik · Maria Cecília Torres Costa Guerra ·
-- Frederico Luiz Rehder de Freitas). Idempotente.
update public.perfis
   set termos_uso_versao = 'termos_uso-v3.3',
       termos_uso_aceito_em = coalesce(lgpd_data, created_at)
 where coalesce(termos_uso_versao, '') = ''
   and lgpd_aceito
   and created_at > timestamptz '2026-08-08 13:46:55+00';
