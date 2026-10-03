-- 03/10 — PENDÊNCIAS DO PROJETO: o que está aberto mora no BANCO, não no texto do HANDOFF.
--
-- Por quê (pedido do dono): o HANDOFF tinha 35.700 linhas / 983 seções, 12 checkboxes abertos no topo
-- e a palavra "pendente" 345 vezes enterrada na narrativa. Ninguém relê 35 mil linhas — nem o Claude:
-- cada sessão lê o topo. O que já funcionava bem aqui era o que mora em tabela (`regra_negocio`,
-- `fonte_regressao_explicada`, `qa_invariantes()`): uma consulta responde e o item volta sozinho.
--
-- Regras de uso:
--   · HANDOFF = histórico (o PORQUÊ). Esta tabela = o que está ABERTO. Pendência nova entra AQUI.
--   · prioridade: 0 = dinheiro/cliente afetado agora · 1 = risco · 2 = melhoria · 3 = ideia.
--   · responsavel: 'dono' (decisão/ação humana) ou 'claude' (sessão resolve).
--   · revisar_em: o item volta ao topo de `pendencias_abertas()` nessa data, mesmo sem ninguém lembrar.
--   · como_verificar: a CONSULTA (ou passo) que prova se resolveu — fechar exige prova, não impressão.
--   · fechar: status 'resolvida'/'descartada' + `resolucao` dizendo como foi verificado.

create table if not exists public.pendencias_projeto (
  id             bigserial primary key,
  titulo         text not null unique,
  detalhe        text,
  area           text not null check (area in ('cliente','marketing','captura','documental','financeiro',
                                               'juridico','app','infra','seguranca','processo')),
  prioridade     smallint not null check (prioridade between 0 and 3),
  responsavel    text not null check (responsavel in ('dono','claude')),
  status         text not null default 'aberta' check (status in ('aberta','aguardando','resolvida','descartada')),
  revisar_em     date,
  como_verificar text,
  origem         text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  resolvido_em   timestamptz,
  resolucao      text,
  constraint pendencia_fechada_tem_resolucao
    check (status not in ('resolvida','descartada') or (resolucao is not null and resolvido_em is not null))
);

alter table public.pendencias_projeto enable row level security;
drop policy if exists "Admin gerencia pendencias" on public.pendencias_projeto;
create policy "Admin gerencia pendencias" on public.pendencias_projeto
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.pendencias_projeto from anon;

create or replace function public.pendencias_projeto_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.status in ('resolvida','descartada') and old.status not in ('resolvida','descartada') and new.resolvido_em is null then
    new.resolvido_em := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_pendencias_projeto_touch on public.pendencias_projeto;
create trigger trg_pendencias_projeto_touch before update on public.pendencias_projeto
  for each row execute function public.pendencias_projeto_touch();

-- O que o ritual lê: abertas/aguardando, VENCIDAS primeiro dentro de cada prioridade.
create or replace function public.pendencias_abertas()
returns table(id bigint, p text, vencida boolean, titulo text, responsavel text, area text,
              revisar_em date, idade_dias int, como_verificar text)
language sql stable set search_path = public as $$
  select id, 'P' || prioridade, coalesce(revisar_em <= current_date, false), titulo, responsavel, area,
         revisar_em, (current_date - criado_em::date), como_verificar
    from pendencias_projeto
   where status in ('aberta','aguardando')
   order by prioridade, coalesce(revisar_em <= current_date, false) desc, revisar_em nulls last, criado_em;
$$;
revoke execute on function public.pendencias_abertas() from anon;

-- Carga inicial (03/10): as 12 do fechamento de 02/10 + o que a sessão de 03/10 achou.
-- `on conflict do nothing` = idempotente; reaplicar não duplica nem reabre item fechado.
insert into public.pendencias_projeto (titulo, detalhe, area, prioridade, responsavel, revisar_em, como_verificar, origem) values
 ('Campanha Meta da masterclass aponta para aula FECHADA',
  'Campanha [Leads][LP][Lucre Antes de Arrematar] (01-15/10, R$ 145 em 3 dias) roda com eventos_live lucre-antes-de-arrematar ativo=false e 0 inscrições. Pixel contou 15 leads que não são nossos → LP do anúncio provavelmente não é o app (ou DNS do domínio não aponta para a Vercel). Conferir URL de destino no Gerenciador; se for a nossa, ativar o evento.',
  'marketing', 0, 'dono', '2026-10-04',
  'select ativo, (select count(*) from live_inscricoes where evento_id=e.id) inscricoes from eventos_live e where slug=''lucre-antes-de-arrematar'';',
  'HANDOFF 03/10 — invariante de marketing por canal'),
 ('7 pagantes sem nenhum relatório em 14 dias',
  '3 top2 + 4 assessorados sem análise de mercado em 14 dias — churn em formação.',
  'cliente', 1, 'dono', '2026-10-10',
  'select p.id, p.role from perfis p where p.role in (''top2'',''assessorado'',''clube'') and p.ativo and not exists (select 1 from analises_mercado a where a.user_id=p.id and a.created_at > now()-interval ''14 days'');',
  'Ritual 03/10 (1c-a)'),
 ('Leiloaria Smart: ficha do arrematante + comprovante de renda (imóvel 1825)',
  'Cliente sem a documentação de crédito; prazo de 01/10 18h perdido; proposta mantida em análise sem data nova.',
  'cliente', 1, 'dono', '2026-10-06', null, 'HANDOFF 02/10 — respostas a Leiloaria Smart e Sodré'),
 ('Google Workspace reimob.com.br com pagamento recusado',
  '2 cartões recusados em 01/10 — risco de perder e-mail do domínio.',
  'financeiro', 1, 'dono', '2026-10-05', null, 'HANDOFF fechamento 02/10'),
 ('monitor-fontes-cron não disparou em 02/10 18:10',
  'Sem fonte_metricas_hist nem qa_invariantes_execucao de 02/10. Se faltar em 03/10, investigar os 74 crons do vercel.json. Conferência agendada 03/10 18:25 UTC.',
  'infra', 1, 'claude', '2026-10-03',
  'select max(dia) from fonte_metricas_hist; select max(executado_em) from qa_invariantes_execucao;',
  'HANDOFF 02/10 (18:20)'),
 ('LEJE: liberação do Cloudflare (403) pedida ao leiloeiro',
  'Fonte zerada desde 24/09; marcação em fonte_regressao_explicada vence 16/10. Não evadir.',
  'captura', 1, 'dono', '2026-10-16',
  'select * from public.fonte_regressao_suspeita() where fonte=''LEJE'';', 'HANDOFF 02/10 (manhã)'),
 ('Erro vite:preloadError PRESO para cliente pagante',
  'Marcos (assessorado) em /arrematados 02/10 22:30 — recarga bloqueada pelo anti-loop, mesmo dia da mudança do verificarVersaoNova.',
  'app', 1, 'claude', '2026-10-05',
  'select rota, ocorrencias, ultima_em from erros_cliente where not resolvido and msg ilike ''%preloadError%'';',
  'Ritual 03/10 (1b)'),
 ('Rastreio do Meta: 71 chegadas × 4 visitas com fbclid',
  'Alarme mkt_clique_pago_sem_rastreio (agora por canal). Provável consequência da pendência da campanha da masterclass; reavaliar depois dela.',
  'marketing', 2, 'claude', '2026-10-06',
  'select chave, valor, status from qa_invariantes() where chave=''mkt_clique_pago_sem_rastreio'';', 'HANDOFF 03/10'),
 ('Combinar com gestor de tráfego/lançador: campanhas na NOSSA conta de anúncios',
  'meta-insights-cron só enxerga META_AD_ACCOUNT_ID. Campanha em conta de terceiros não chega ao painel nem aos alarmes.',
  'marketing', 2, 'dono', '2026-10-07', null, 'Sessão 03/10'),
 ('Alertas de captura no painel de invariantes',
  'estado_fora_do_padrao 18 · pino_generico_como_rua 26 · matricula_area_de_outro_lote 4 · tipo_terreno_com_construcao 1 · erro_na_tela_do_cliente 2 · sem_foto 1743.',
  'captura', 2, 'claude', '2026-10-07',
  'select chave, valor, limite from qa_invariantes() where status<>''ok'';', 'Ritual 03/10 (1c-c)'),
 ('Documental: 0 vermelho e 0 confiança alta; 7 de 14 com 3+ pendências essenciais',
  'Acervo documental fraco (ocupação/débitos/processo), não imóvel arriscado.',
  'documental', 2, 'claude', '2026-10-10',
  'select * from public.documental_distribuicao();', 'HANDOFF fechamento 02/10'),
 ('2 veículos SUPERBID com resultado_leilao atrasado',
  'Ofertas 5003803/5007176 (30/09) em 5/6 tentativas; devem virar indeterminado na rodada noturna do runner residencial.',
  'captura', 2, 'claude', '2026-10-04',
  'select chave, valor from qa_invariantes() where chave=''resultado_leilao_atrasado'';', 'HANDOFF 03/10'),
 ('Conferir que o PWA recarregou sozinho após deploy',
  'Rastro esperado: pageview logo após voltar ao app com o bundle novo (verificarVersaoNova).',
  'app', 2, 'claude', '2026-10-05', null, 'HANDOFF fechamento 02/10'),
 ('Triagem das ~345 menções de "pendente" no HANDOFF',
  'Classificar cada uma: resolvida (provar no banco/código) · aberta (vira linha aqui) · obsoleta. Em lotes, para o dono revisar.',
  'processo', 2, 'claude', '2026-10-04', null, 'Sessão 03/10'),
 ('Painel de invariantes frio (13 s): arquivar lotes inativos',
  '~56 mil inativos = 68% do heap de imoveis_leilao; shared_buffers 256 MB < 293 MB da tabela. Projeto maior (retenção/apuração/relatórios). Compute maior DESCARTADO pelo dono (custo).',
  'infra', 3, 'claude', null, 'select count(*) filter (where not ativo), count(*) from imoveis_leilao;', 'HANDOFF 03/10 — painel lento'),
 ('Índice parcial para o item fora_do_acervo do painel (−~350 ms)',
  'Predicado: ativo and fonte in (...) and fora_do_acervo_imovel_veiculo(titulo, descricao).',
  'infra', 3, 'claude', null, null, 'HANDOFF 03/10 — painel lento'),
 ('Varredura multi-agente de bugs (item 6 do ritual) não rodada em 03/10',
  'Pulada por economia; rodar quando houver mudança substancial de código.',
  'processo', 3, 'claude', null, null, 'Ritual 03/10')
on conflict (titulo) do nothing;
