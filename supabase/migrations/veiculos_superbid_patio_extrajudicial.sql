-- 23/09 — Decisão do dono: exibir todo veículo em pátio (corporativo, prefeitura, troca de frota,
-- extrajudicial; judicial só com sinal de apreendido/pátio). Mesma regra de
-- classificarPatioSuperbid() em scripts/scraper-puppeteer.mjs, aplicada ao acervo atual.
-- (1) extrajudicial SUPERBID sem sinal de executado → confirmado
update veiculos_leilao set status_patio = 'confirmado',
  status_patio_motivo = 'venda extrajudicial pelo próprio dono do bem (frota/órgão/empresa) — não há executado'
where fonte = 'SUPERBID' and status_patio = 'indefinido'
  and coalesce(raw->'auction'->>'modalityId', '') <> '4'
  and coalesce(jsonb_typeof(raw->'auction'->'judicialPraca'), 'null') = 'null'
  and coalesce(jsonb_typeof(raw->'product'->'judicial'), 'null') = 'null'
  and coalesce(titulo, '') || ' ' || coalesce(descricao, '') !~* '(n[ãa]o localizado|sujeito a busca e apreens[ãa]o|em poder do (executado|devedor)|posse do (executado|devedor)|aguardando localiza[çc][ãa]o|bem n[ãa]o recolhido)';
-- (2) qualquer fonte: texto diz apreendido/recolhido ao depósito, sem sinal de executado → confirmado
update veiculos_leilao set status_patio = 'confirmado',
  status_patio_motivo = 'sinal textual de bem já em pátio/disponível'
where status_patio = 'indefinido'
  and coalesce(titulo, '') || ' ' || coalesce(descricao, '') ~* '(apreendid[oa]|recolhid[oa] ao dep[óo]sito)'
  and coalesce(titulo, '') || ' ' || coalesce(descricao, '') !~* '(n[ãa]o localizado|sujeito a busca e apreens[ãa]o|em poder do (executado|devedor)|posse do (executado|devedor)|aguardando localiza[çc][ãa]o|bem n[ãa]o recolhido)';
