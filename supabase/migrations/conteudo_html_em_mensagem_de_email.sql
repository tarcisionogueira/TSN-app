-- =====================================================================================
-- E-MAIL NO ATENDIMENTO COM A FORMATAÇÃO ORIGINAL (18/08)
--
-- O corpo do e-mail passou a chegar (GET /emails/receiving/{id}), mas só o TEXTO PLANO —
-- e a tela ainda o achatava: `{m.conteudo}` num <div> comum colapsa \n em espaço, e um
-- e-mail de 4 linhas virava uma linha só. O pedido do dono: mesmo formato do e-mail —
-- parágrafos, espaçamento, imagens, hiperlinks.
--
-- Esta coluna guarda a versão HTML, que a API do Resend já devolvia e nós descartávamos.
--
-- ⚠️ REGRA DE RENDERIZAÇÃO (o motivo do comentário na coluna): o remetente é QUALQUER UM
-- da internet, e a tela que exibe é a do ADMIN — a sessão mais privilegiada do sistema.
-- HTML cru ali é XSS servido de bandeja. A tela renderiza SÓ dentro de <iframe sandbox>
-- sem allow-scripts e sem allow-same-origin: nenhum script executa, nada enxerga a
-- página-mãe; sobra o layout, que é o que se quer. Links abrem em aba nova. Custo
-- conhecido: imagem remota carrega, então o remetente pode saber que o e-mail foi aberto
-- — igual a qualquer cliente de e-mail sem proxy de imagem.
--
-- `conteudo` (texto plano) continua sendo a fonte para IA, busca e notificação.
-- =====================================================================================

alter table public.chamados_mensagens add column if not exists conteudo_html text;

comment on column public.chamados_mensagens.conteudo_html is
  'Versao HTML do corpo, so em mensagens vindas por E-MAIL (GET /emails/receiving/{id} do Resend). NUNCA renderizar fora de iframe sandbox: o remetente e qualquer um da internet, e HTML cru no navegador do ADMIN e um vetor de XSS contra a sessao mais privilegiada do sistema. `conteudo` (texto plano) continua sendo a fonte para IA, busca e notificacao.';
