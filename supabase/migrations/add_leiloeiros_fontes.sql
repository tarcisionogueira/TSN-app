-- ════════════════════════════════════════════════════════════════════════════
-- FASE 1 — Infraestrutura de cobertura nacional de leiloeiros
-- 1) leiloeiros_fontes : registro de leiloeiros por UF (liga/desliga sem código)
-- 2) proxy_uso         : contador de requisições + limitador/alerta de custo
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. REGISTRO DE LEILOEIROS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leiloeiros_fontes (
  id              bigserial PRIMARY KEY,
  uf              varchar(2)   NOT NULL,
  nome            text         NOT NULL,
  url_base        text         NOT NULL,           -- ex.: https://site.com/imoveis?page=
  paginacao_param text         DEFAULT 'page',     -- nome do parâmetro de página
  perfil_parser   text         DEFAULT 'generico', -- generico | json_api | custom_<nome>
  -- Canal de integração: 'api' assume como principal; cai para 'scraper' na falha.
  canal_preferido text         DEFAULT 'scraper',  -- 'api' | 'scraper'
  api_url         text,                            -- endpoint oficial do leiloeiro (quando houver)
  api_status      text         DEFAULT NULL,       -- 'ok' | 'falha' | NULL (última checagem)
  api_ultimo_ok   timestamptz,
  max_paginas     int          DEFAULT 10,
  prioridade      int          DEFAULT 5,          -- 1 (alta) .. 9 (baixa)
  ativo           boolean      DEFAULT true,
  -- métricas operacionais (preenchidas pelo scraper)
  ultima_execucao timestamptz,
  ultima_contagem int          DEFAULT 0,
  taxa_qualidade  numeric(5,2) DEFAULT NULL,       -- % de imóveis "completos"
  observacao      text,
  criado_em       timestamptz  DEFAULT now(),
  UNIQUE (nome, url_base)
);

CREATE INDEX IF NOT EXISTS idx_leiloeiros_fontes_uf    ON leiloeiros_fontes (uf);
CREATE INDEX IF NOT EXISTS idx_leiloeiros_fontes_ativo ON leiloeiros_fontes (ativo);

-- ── 2. CONTROLE DE USO DO PROXY (limitador + alerta) ────────────────────────
CREATE TABLE IF NOT EXISTS proxy_uso (
  id                  bigserial PRIMARY KEY,
  mes                 varchar(7) NOT NULL,         -- 'YYYY-MM'
  requisicoes         int        DEFAULT 0,
  requisicoes_falha   int        DEFAULT 0,
  custo_estimado_usd  numeric(10,2) DEFAULT 0,
  alerta_80_enviado   boolean    DEFAULT false,
  alerta_100_enviado  boolean    DEFAULT false,
  atualizado_em       timestamptz DEFAULT now(),
  UNIQUE (mes)
);

-- ── 3. SEED — principais leiloeiros nacionais e regionais (somente imóveis) ──
-- Os grandes nacionais cobrem vários estados; regionais entram por UF.
-- prioridade 1-2 = maiores acervos; expanda inserindo novas linhas.
INSERT INTO leiloeiros_fontes (uf, nome, url_base, paginacao_param, perfil_parser, prioridade, ativo, observacao) VALUES
  -- Nacionais (acervo distribuído por todo o país)
  ('BR', 'Zuk (Zukerman)',   'https://www.portalzuk.com.br/leilao-de-imoveis?pagina=', 'pagina', 'generico', 1, true, 'Líder nacional ~1000+ imóveis'),
  ('BR', 'Mega Leilões',     'https://www.megaleiloes.com.br/imoveis?pagina=',         'pagina', 'generico', 2, true, 'Nacional'),
  ('BR', 'Sold Leilões',     'https://www.sold.com.br/categorias/imoveis?page=',       'page',   'generico', 2, true, 'Nacional'),
  ('BR', 'Superbid',         'https://www.superbid.net/categorias/imoveis?pagina=',    'pagina', 'json_api', 2, true, 'Marketplace nacional'),
  ('BR', 'Frazão Leilões',   'https://www.frazaoleiloes.com.br/imoveis?page=',         'page',   'generico', 3, true, 'Nacional'),
  ('BR', 'Biasi Leilões',    'https://www.biasileiloes.com.br/imoveis?page=',          'page',   'generico', 3, true, 'Nacional'),
  ('BR', 'Banco do Brasil',  'https://www.seuimovelbb.com.br/imoveis?page=',           'page',   'generico', 2, true, 'Portal do banco'),
  ('BR', 'HastaPública',     'https://www.hastapublica.com.br/busca?categoria=imoveis&pagina=', 'pagina', 'generico', 4, true, 'Nacional'),
  ('BR', 'eLeilões',         'https://www.eleiloes.com.br/imoveis?pagina=',            'pagina', 'generico', 4, true, 'Nacional'),
  -- Regionais por UF (sementes — validar acervo real no piloto)
  ('SP', 'KC Leilões',       'https://www.kcleiloes.com.br/imoveis?page=',             'page',   'generico', 5, true, 'SP'),
  ('SP', 'Pátio Rocha',      'https://www.patiorocha.com.br/imoveis?page=',            'page',   'generico', 5, true, 'SP'),
  ('SP', 'Alberto Macedo',   'https://www.albertomacedo.com.br/imoveis?page=',         'page',   'generico', 6, true, 'SP'),
  ('RS', 'Grupo Lance',      'https://www.grupolance.com.br/imoveis?page=',            'page',   'generico', 5, true, 'RS/Sul'),
  ('SP', 'VIP Leilões',      'https://www.vipleiloes.com.br/imoveis?page=',            'page',   'generico', 5, true, 'SP/Nacional')
ON CONFLICT (nome, url_base) DO NOTHING;

-- Garante que a tabela de imóveis tenha as colunas de documentos (idempotente)
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS link_matricula text;
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS qualidade_ok   boolean DEFAULT NULL;
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS qualidade_faltando text;

-- ── 4. DEDUPLICAÇÃO ─────────────────────────────────────────────────────────
-- Chave determinística do imóvel (preenchida pelo scraper via chaveDedup()).
-- O mesmo bem em fontes diferentes recebe a MESMA chave.
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS dedup_chave text;
CREATE INDEX IF NOT EXISTS idx_imoveis_dedup ON imoveis_leilao (dedup_chave);

-- Auditoria: lista grupos de imóveis com a mesma chave (duplicados entre fontes).
-- Use no Admin/SQL para conferir a deduplicação manualmente.
CREATE OR REPLACE VIEW imoveis_duplicados AS
SELECT dedup_chave,
       COUNT(*)                         AS qtd,
       array_agg(DISTINCT fonte)        AS fontes,
       array_agg(id)                    AS ids,
       MIN(valor_minimo)                AS menor_valor,
       MAX(valor_minimo)                AS maior_valor
FROM imoveis_leilao
WHERE dedup_chave IS NOT NULL AND ativo = true
GROUP BY dedup_chave
HAVING COUNT(*) > 1
ORDER BY qtd DESC;
