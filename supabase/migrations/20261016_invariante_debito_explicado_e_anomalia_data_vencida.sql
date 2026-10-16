-- doc_debito_maior_que_avaliacao (16/10): o único caso é REAL, não contaminação. SUBLIME 3438
-- (apto em Santos, Rua Felipe Camarão 135): o edital diz literalmente "DÉBITOS CONDOMINIAIS ... no
-- valor de R$ 497.627,40 ... em 14 de maio de 2026" contra "AVALIAÇÃO: R$ 409.814,67" (mais IPTU de
-- R$ 113.908,38). O invariante existe para pegar leitura de outro lote; débito acima do imóvel é
-- possível de verdade. Passa a respeitar qa_invariante_explicada, igual a estado_fora_do_padrao.
do $$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
declare velho text := $v$or coalesce((doc_fatos->'custos'->>'condominioDebito')::numeric, 0) > coalesce(valor_avaliacao, valor_minimo_ref)
          )), 0),$v$;
declare novo text := $v$or coalesce((doc_fatos->'custos'->>'condominioDebito')::numeric, 0) > coalesce(valor_avaliacao, valor_minimo_ref)
          )
          and not exists (select 1 from qa_invariante_explicada x where x.chave = 'doc_debito_maior_que_avaliacao'
                            and x.imovel_id = imoveis_leilao.id and x.explicado_ate >= current_date)), 0),$v$;
begin
  if position(velho in d) = 0 then raise exception 'trecho de doc_debito_maior_que_avaliacao não encontrado'; end if;
  execute replace(d, velho, novo);
end $$;

insert into public.qa_invariante_explicada (chave, imovel_id, explicacao, explicado_ate)
select 'doc_debito_maior_que_avaliacao', 'fa6ec9be-36ef-4ef0-a932-79ef88bd8188'::uuid,
       'SUBLIME 3438 (Santos): débito condominial de R$ 497.627,40 está LITERALMENTE no edital (14/05/2026), avaliação R$ 409.814,67. Real, não contaminação — conferido 16/10.',
       current_date + 30
 where exists (select 1 from public.imoveis_leilao where id = 'fa6ec9be-36ef-4ef0-a932-79ef88bd8188')
on conflict do nothing;

-- data_edital_recuou_prazo: anomalia 344 (LEILAOBRASIL, 05/10) dizia acervo 13/10 × edital 09/10.
-- As duas datas passaram e o lote foi remarcado para 13/11 — a divergência não existe mais.
update public.relatorio_anomalias set resolvido = true, atualizado_em = now()
 where id = 344 and tipo = 'data_divergente_edital' and not resolvido;
