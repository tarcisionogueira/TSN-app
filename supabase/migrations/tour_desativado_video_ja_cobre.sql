-- CAIXA DE "PRIMEIROS PASSOS" DESLIGADA — o vídeo já faz esse papel (dono, 15/08).
--
-- O QUE ELE VIU. No primeiro acesso pelo celular apareceram, na MESMA tela, o modal do vídeo de
-- boas-vindas ("VÍDEO 1 DE 2") e a caixa do tour ("NOVIDADE, 2026-08 — 1/5, Anterior/Próximo"),
-- uma sobre a outra. A fila de modais (`src/utils/filaModais.js`, mesmo dia) resolveu a
-- SOBREPOSIÇÃO: agora aparecem em sequência, nunca empilhados. Mas o dono foi além e apontou o
-- excesso: *"você já tem o vídeo, então acredito que seja desnecessária aquela caixa"*. São dois
-- onboardings dizendo a mesma coisa; um em sequência do outro continua sendo dois.
--
-- POR QUE POR DADO, E NÃO APAGANDO CÓDIGO. O `TourGuia` não é um componente de conteúdo fixo: ele
-- lê `tour_etapas` do banco e desenha o que estiver publicado e ativo. Desligar a versão é a
-- forma REVERSÍVEL de dizer "não há tour agora" — o componente devolve `null` sozinho quando não
-- encontra etapas, sem nenhum ramo especial. Se o dono quiser o tour de volta (ou publicar uma
-- versão nova, com outro roteiro), é um `update` de uma linha, sem tocar em React.
--
-- POR QUE ESTE ARQUIVO EXISTE, se a mudança é de dado: porque um banco recriado a partir de
-- `supabase/migrations/` traria as 8 etapas ativas de volta e a caixa reapareceria sem ninguém
-- entender por quê. É a forma 7b do CLAUDE.md pelo avesso — mudança que só vive no banco. Aqui
-- ela vive nos dois lugares.
--
-- ⚠️ NÃO apaga nada: as etapas continuam gravadas, só inativas. A versão 2026-06 já estava
-- assim desde que a 2026-08 a substituiu.
update public.tour_etapas
   set ativo = false
 where versao = '2026-08' and ativo;
