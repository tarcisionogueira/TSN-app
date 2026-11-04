-- CHAMADO DE DOCUMENTOS: fechar também quando não há pedido ligado (04/11, achado no teste)
--
-- O chamado aberto pela tela de Análise da EQUIPE ("Pedir estas informações ao leiloeiro", prévia
-- sem contato) não grava pedido em `documental_pedidos_leiloeiro` — então o gatilho não sabia o
-- que tinha sido pedido e o chamado NUNCA fechava sozinho, nem com matrícula e edital no lote.
--
-- Agora, sem nenhum item reconhecível nos pedidos ligados, a régua é a mesma que o painel do
-- chamado usa para mostrar "Falta no lote": matrícula E (edital ou regras) presentes no lote —
-- pelo anexo OU pelo selo do lote (`tem_matricula_doc`/`tem_edital_doc`, que também conta edital
-- por link). Com pedido ligado, nada muda: fecha quando chegou o que foi pedido.

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
  selo_mat boolean; selo_ed boolean;
  fecha boolean;
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

  if pede_mat or pede_ed or pede_rv then
    fecha := (not pede_mat or tem_mat) and (not pede_ed or tem_ed) and (not pede_rv or tem_rv);
  else
    -- Sem pedido ligado: o selo já foi recalculado (gatilhos AFTER rodam em ordem alfabética e
    -- este é `zz_`), então ele conta também o edital que veio por link.
    select coalesce(tem_matricula_doc, false), coalesce(tem_edital_doc, false)
      into selo_mat, selo_ed
      from imoveis_leilao where id = new.imovel_id;
    fecha := (tem_mat or coalesce(selo_mat, false)) and (tem_rv or coalesce(selo_ed, false));
  end if;

  if fecha then
    update chamados set status = 'finalizado', atualizado_em = now() where id = v_chamado;
    insert into chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo)
    values (v_chamado, 'sistema', 'Sistema',
            '✅ Os documentos que faltavam já estão no lote. Chamado encerrado automaticamente; as análises que esperavam por eles são geradas de novo.');
  else
    update chamados set atualizado_em = now() where id = v_chamado;
  end if;
  return null;
end
$function$;
