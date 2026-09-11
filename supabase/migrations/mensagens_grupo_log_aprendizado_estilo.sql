-- Pedido do dono (11/09): "veja para permitir eu editar o texto e coloque a IA para aprender
-- com as edições que vou ir fazendo" — a tela GeradorMensagensGrupo.jsx só mostrava um <pre>
-- (sem edição) e o texto final nunca era comparado ao gerado, então não existia sinal nenhum
-- de "o que o dono muda antes de colar no grupo".
--
-- Três colunas, cada uma um estado diferente do MESMO texto, de propósito (mesmo raciocínio de
-- `texto`/`texto_editado` do resto da base — nunca um campo só fazendo dois papéis):
--   • texto            (já existia) — a saída 100% determinística de _mensagens-grupo.js,
--     nunca tocada por IA. Continua sendo a fonte de verdade dos FATOS (link, R$, %, data).
--   • texto_estilizado — o que a IA propôs a partir do estilo aprendido (null quando não rodou:
--     poucos exemplos ainda, chamada falhou, ou a validação de fatos reprovou a saída — ver
--     api/_mensagens-grupo-estilo.js). Nunca é a única cópia do texto: existe pra auditoria.
--   • texto_editado    — o que o dono de fato copiou pro WhatsApp, só quando ele mudou algo
--     (nulo = copiou como veio). É este campo que vira exemplo de estilo pras próximas gerações.
alter table public.mensagens_grupo_log
  add column if not exists texto_estilizado text,
  add column if not exists texto_editado text;

comment on column public.mensagens_grupo_log.texto_estilizado is 'Reescrita da IA a partir do estilo aprendido de edições anteriores do mesmo tipo; null = IA não rodou ou foi descartada pela validação de fatos.';
comment on column public.mensagens_grupo_log.texto_editado is 'Texto final que o dono efetivamente copiou, só quando diferente do que foi mostrado (sinal de edição real, usado como exemplo para o estilo futuro).';
