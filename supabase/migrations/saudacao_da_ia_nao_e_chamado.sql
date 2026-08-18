-- =====================================================================================
-- NÓS COMEÇARMOS A CONVERSA NÃO ABRE CHAMADO (18/08)
--
-- A Fila de Atendimento marcava **27 ABERTOS** e **1 EM ATENDIMENTO**. Medido: os 28 tinham
-- ZERO mensagem do cliente. Nenhuma pessoa estava esperando por nada.
--
--   27 × saudação proativa da IA — `origem = 'proativo'`, título "Como está sendo sua
--        experiência?", nascida em `ChatSuporte.saudacaoProativa()`. 38 dos 41 chamados do
--        acervo eram isto. Cada uma aparecia "aberta há N dias" contando do momento em que
--        NÓS falamos — o relógio de espera do cliente medindo a nossa própria mensagem.
--    1 × canal do `/caso`, criado por `Caso.jsx` ao ABRIR a página, com
--        `status: 'em_atendimento'` fixo. Zero mensagens, nenhum atendente, desde 08/08.
--
-- O dado JÁ sabia distinguir (`chamados.origem`); a tela é que somava tudo. Mas filtrar na
-- tela consertaria um leitor e deixaria os outros: o badge do Header conta pela mesma lista
-- de status, e o health-check e o próximo relatório também. Então o estado passa a viver no
-- STATUS, onde todo leitor já olha — e nenhum front precisou mudar para os contadores caírem.
--
--   `saudacao` = nós abrimos o canal e ninguém falou. Não é fila, não tem SLA, não é dívida.
--                Quando o CLIENTE escreve, o gatilho promove para 'aberto' e o relógio
--                começa ALI (`aberto_em`), não quando nós falamos.
--
-- ⚠️ A ORDEM DE APLICAÇÃO IMPORTA, e é esta: constraint + gatilho ANTES do backfill. Se os
-- 28 virassem 'saudacao' sem o gatilho existir, um cliente que respondesse ficaria preso num
-- status que a fila não lê — gente de verdade esperando, invisível. Seria trocar um alarme
-- ruidoso por um silêncio perigoso, que é sempre o pior dos dois.
--
-- Verificado antes do backfill, em transação desfeita: criada como 'saudacao' → mensagem da
-- IA NÃO promove (controle negativo, é o defeito que estamos consertando) → mensagem do
-- CLIENTE promove e carimba `aberto_em` → segunda mensagem do cliente NÃO reescreve o
-- relógio. Depois do backfill: fila = 0, sem_interacao = 28, e nada na fila sem cliente ter
-- falado. O invariante `fila_sem_cliente_falar` foi testado nas duas direções — devolvendo
-- as saudações para 'aberto' ele vai a 28.
-- =====================================================================================

alter table public.chamados drop constraint if exists chamados_status_check;
alter table public.chamados add constraint chamados_status_check
  check (status = any (array['saudacao'::text, 'aberto'::text, 'aguardando_atendente'::text,
                            'em_atendimento'::text, 'finalizado'::text]));

alter table public.chamados add column if not exists aberto_em timestamptz;

comment on column public.chamados.aberto_em is
  'Quando o chamado passou a ser um chamado de verdade (primeira mensagem do CLIENTE). Use este, nao criado_em, para "aberto ha quanto tempo": num canal que o sistema abriu, criado_em e a hora em que NOS falamos.';

-- Para os que já existem, `aberto_em = criado_em`: nada muda na conta deles.
update public.chamados set aberto_em = criado_em where aberto_em is null;

create or replace function public.trg_promove_saudacao()
returns trigger language plpgsql as $$
begin
  if new.autor_tipo = 'cliente' then
    update public.chamados
       set status = case when status = 'saudacao' then 'aberto' else status end,
           aberto_em = coalesce(aberto_em, now()),
           atualizado_em = now()
     where id = new.chamado_id
       and (status = 'saudacao' or aberto_em is null);
  end if;
  return null;
end;
$$;

drop trigger if exists promove_saudacao on public.chamados_mensagens;
create trigger promove_saudacao
  after insert on public.chamados_mensagens
  for each row execute function public.trg_promove_saudacao();

-- ── BACKFILL — só o que o SISTEMA abriu e ninguém respondeu ────────────────────────────────
update public.chamados c
   set status = 'saudacao', aberto_em = null, atualizado_em = now()
 where c.status = 'aberto' and c.origem = 'proativo'
   and not exists (select 1 from public.chamados_mensagens m
                    where m.chamado_id = c.id and m.autor_tipo = 'cliente');

update public.chamados c
   set status = 'saudacao', aberto_em = null, atualizado_em = now()
 where c.status = 'em_atendimento' and c.caso_id is not null
   and not exists (select 1 from public.chamados_mensagens m where m.chamado_id = c.id);

-- Invariante novo em `qa_invariantes()` (aplicado via CREATE OR REPLACE no mesmo dia):
--   `fila_sem_cliente_falar` (limite 0) — chamado na fila sem uma mensagem do cliente.
--   É o que pega o PRÓXIMO criador que puser fantasma na fila, sem depender de ninguém
--   lembrar desta regra.
