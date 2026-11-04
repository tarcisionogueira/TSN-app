-- CHAMADO DE DOCUMENTOS DO LEILOEIRO (04/11, pedido do dono)
--
-- "Sinalizar que tem documentos faltantes fornecidos pelo leiloeiro e encaminhar para o time de
-- atendimento através de um chamado para que mande ao leiloeiro pedindo os anexos."
--
-- O pedido automático por e-mail (api/_pedido-leiloeiro-auto.js) já existia, mas quando ele NÃO
-- consegue andar sozinho — leiloeiro sem e-mail cadastrado (`sem_contato`), leiloeiro que não
-- responde (`equipe_whatsapp`) ou e-mail que não saiu (`falha`) — o lote só aparecia numa lista
-- do Admin, sem dono, sem histórico e sem prazo. Agora vira CHAMADO no Atendimento:
--   * um chamado aberto por LOTE (índice único parcial), não por cliente;
--   * `segmento='interno'` → visível para admin e analista (a RLS de chamados já cobre);
--   * o pedido ao leiloeiro aponta para o chamado (`chamado_id`);
--   * quando o documento entra no lote (e-mail do leiloeiro, upload da equipe ou do cliente), o
--     gatilho abaixo registra no chamado e o ENCERRA sozinho se tudo o que foi pedido chegou.

alter table public.chamados add column if not exists imovel_id uuid;
alter table public.documental_pedidos_leiloeiro add column if not exists chamado_id uuid references public.chamados(id) on delete set null;

-- Um chamado de documentos em aberto por lote. A corrida entre dois pedidos simultâneos cai no
-- 23505 e o servidor relê o que já existe (api/_chamado-documentos.js).
create unique index if not exists uq_chamado_documentos_leiloeiro_aberto
  on public.chamados (imovel_id)
  where tipo = 'documentos_leiloeiro' and status <> 'finalizado';

create index if not exists idx_pedidos_leiloeiro_chamado
  on public.documental_pedidos_leiloeiro (chamado_id) where chamado_id is not null;

-- Documento chegou ao lote → registra no chamado e encerra se cobriu o que foi pedido.
-- Os itens pedidos são RÓTULOS em texto (`itens_pedidos`, ex.: "Matrícula atualizada do imóvel");
-- só os reconhecíveis entram na conta. Pedido manual com pendência em texto livre não fecha sozinho
-- (não há como saber se o arquivo respondeu à pergunta) — a equipe finaliza.
create or replace function public.trg_anexo_chamado_documentos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_chamado uuid;
  v_itens text;
  v_rotulo text;
  pede_mat boolean; pede_ed boolean; pede_rv boolean;
  tem_mat boolean; tem_ed boolean; tem_rv boolean;
begin
  if new.tipo not in ('matricula', 'edital', 'regras_venda', 'regras') then return null; end if;

  select id into v_chamado from chamados
   where tipo = 'documentos_leiloeiro' and imovel_id = new.imovel_id and status <> 'finalizado'
   limit 1;
  if v_chamado is null then return null; end if;

  v_rotulo := case new.tipo when 'matricula' then 'Matrícula' when 'edital' then 'Edital' else 'Regras de venda' end;
  insert into chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo)
  values (v_chamado, 'sistema', 'Sistema',
          format('📎 Chegou %s ao lote: %s%s.', v_rotulo, new.nome,
                 case when coalesce(new.origem_url, '') like 'email-leiloeiro:%' then ' (resposta do leiloeiro por e-mail)'
                      when new.role_criador in ('admin', 'analista', 'advogado') then ' (anexado pela equipe)'
                      else '' end));

  select lower(string_agg(x, ' ')) into v_itens
    from documental_pedidos_leiloeiro p, jsonb_array_elements_text(coalesce(p.itens_pedidos, '[]'::jsonb)) x
   where p.chamado_id = v_chamado;
  pede_mat := coalesce(v_itens ~ 'matr[ií]c', false);
  pede_ed  := coalesce(v_itens ~ 'edital', false);
  pede_rv  := coalesce(v_itens ~ 'regras de venda', false);

  select coalesce(bool_or(tipo = 'matricula'), false),
         coalesce(bool_or(tipo = 'edital'), false),
         coalesce(bool_or(tipo in ('regras_venda', 'regras', 'edital')), false)
    into tem_mat, tem_ed, tem_rv
    from imovel_anexos where imovel_id = new.imovel_id;

  if (pede_mat or pede_ed or pede_rv)
     and (not pede_mat or tem_mat) and (not pede_ed or tem_ed) and (not pede_rv or tem_rv) then
    update chamados set status = 'finalizado', atualizado_em = now() where id = v_chamado;
    insert into chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo)
    values (v_chamado, 'sistema', 'Sistema',
            '✅ Tudo o que foi pedido ao leiloeiro já está no lote. Chamado encerrado automaticamente; as análises que esperavam pelos documentos são geradas de novo.');
  else
    update chamados set atualizado_em = now() where id = v_chamado;
  end if;
  return null;
end
$function$;

-- Nome com `zz_` de propósito: gatilhos AFTER do mesmo evento rodam em ordem alfabética, e este
-- precisa vir depois do `imovel_anexos_recalcula_selo`.
create or replace trigger zz_anexo_chamado_documentos
  after insert on public.imovel_anexos
  for each row execute function public.trg_anexo_chamado_documentos();
