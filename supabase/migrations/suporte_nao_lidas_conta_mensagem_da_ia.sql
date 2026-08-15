-- BADGE DE NÃO LIDAS PASSA A CONTAR A MENSAGEM DA IA (15/08, relato do dono sobre o João).
--
-- O CASO: o João criou a conta ontem e, 4,5 s depois, o chat de suporte ABRIU SOZINHO. No
-- celular o painel é `min(420px,100vw) × min(620px,100dvh)` — ou seja, **a tela inteira**. Ele
-- achou que era um erro do site. Foi o primeiro contato dele com o produto.
--
-- A decisão do dono é trocar a interrupção pelo aviso discreto: "apenas um botãozinho em algum
-- local, com um número, assim como funciona no Instagram". O botão flutuante e o badge já
-- existiam — mas o badge contava SÓ `autor_tipo = 'atendente'`. Tirar a abertura automática
-- sem mexer aqui deixaria a saudação (que é `autor_tipo = 'ia'`) **invisível**: nem abre, nem
-- avisa. Trocaríamos "interrompe demais" por "não comunica nada".
--
-- ⚠️ DISTINÇÃO QUE PRECISA FICAR ESCRITA, porque as duas regras convivem neste repositório e
-- parecem contraditórias: em `tempo_processo()`, mensagem da IA **NÃO conta** como resposta —
-- lá a pergunta é "alguém atendeu esta pessoa?", e bot não é SLA. Aqui a pergunta é outra:
-- "há algo que o cliente ainda não leu?". Para essa, a mensagem da IA conta, sim — ela é
-- exatamente o que ele não leu. Mesma tabela, perguntas diferentes, respostas diferentes.
-- Não unifique as duas.
--
-- `sistema` entra junto (avisos do monitor CNJ e afins chegam nos chamados internos). Só o
-- que o próprio cliente escreveu fica de fora, pelo motivo óbvio.
create or replace function public.suporte_respostas_nao_lidas()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(count(distinct c.id), 0)::int
    from public.chamados c
    join public.chamados_mensagens m on m.chamado_id = c.id
   where c.user_id = auth.uid()
     and m.autor_tipo <> 'cliente'
     and m.criado_em > coalesce(c.cliente_visto_em, c.criado_em);
$$;
