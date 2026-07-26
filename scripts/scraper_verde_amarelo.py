#!/usr/bin/env python3
"""
Scraper — Verde Amarelo Leilões (plataforma Vlance)
===================================================
SPA que serve os dados por APIs JSON internas (mapeadas no console do navegador):

  ENDPOINT 1  GET  /core/api/get-leiloes           -> eventos (leilão-pai)
  ENDPOINT 2  POST /core/api/get-lotes  body=page=N -> LOTES (dados reais), paginado
              (aceita "leilao_id=<ID>&page=N" p/ filtrar por evento; GET => "Metodo nao permitido!")

O get-lotes traz TODAS as categorias (imóveis, veículos, equipamentos, rural) de uma vez.
Filtro por categoria é feito no cliente (o endpoint não filtra por parâmetro).

Uso:
  python3 scraper_verde_amarelo.py                      # só Imóveis (default) -> CSV + JSON
  python3 scraper_verde_amarelo.py --todas             # todas as categorias
  python3 scraper_verde_amarelo.py --categoria Veiculos
  python3 scraper_verde_amarelo.py --delay 2 --out ./saida
  python3 scraper_verde_amarelo.py --ignorar-robots    # pula a checagem de robots.txt

Respeita robots.txt por padrão (aborta se /core/api/ estiver bloqueado p/ o nosso UA).
Standalone (requests). Não integra ao BidPro — para onboard no acervo, ver a versão Node
(padrão scraper-soleon.mjs) que grava em imoveis_leilao como fonte 'VLANCE'.
"""

import argparse
import csv
import json
import sys
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

import requests

BASE = "https://www.verdeamareloleiloes.com.br"
EP_LEILOES = "/core/api/get-leiloes"
EP_LOTES = "/core/api/get-lotes"

# UA realista + headers que SPAs internas costumam exigir (X-Requested-With, Accept JSON, Referer).
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": urljoin(BASE, "/leilao/index/imoveis"),
    "Origin": BASE,
}

# Campos do lote que interessam (o restante fica no JSON bruto). Enriquecidos com o leilão-pai.
CAMPOS_LOTE = [
    "lote_id", "leilao_id", "id", "nm_titulo_lote", "nm_titulo_leilao",
    "nm_categoria", "nm_subcategoria", "nm_segmento", "nm_cidade", "nm_estado",
    "vl_lanceminimo", "vl_lanceinicial", "vl_venda", "vl_incremento", "vl_lance",
    "vl_lanceinicialsegundoleilao", "nu_parcelas", "vl_percentualentrada",
    "dt_fechamento", "dt_fechamento_formatado", "nm_statuslote",
    "imovel_id", "veiculo_id", "equipamento_id",
    "nm_leiloeiro", "nm_url_leiloeiro", "nu_visitas", "nu_qtdelances",
]
# Colunas do CSV = campos do lote + os do leilão-pai (prefixo leilao_*).
CAMPOS_LEILAO_PAI = ["leilao_nome", "leilao_data", "leilao_hora", "leilao_leiloeiro",
                     "leilao_judicial", "leilao_qtde_lotes", "leilao_local", "fotos_qtde"]


def norm(s):
    """minúsculas, sem acento — p/ comparar categoria ('Imóveis' == 'imoveis')."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return s.lower().strip()


def pedir(session, method, path, data=None, tentativas=4):
    """GET/POST com retry + backoff exponencial (2s,4s,8s,16s) em erro de rede/5xx."""
    url = urljoin(BASE, path)
    for i in range(tentativas):
        try:
            if method == "POST":
                r = session.post(url, data=data, timeout=30)
            else:
                r = session.get(url, timeout=30)
            if r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            espera = 2 ** (i + 1)
            if i == tentativas - 1:
                print(f"  ! falha em {method} {path}: {e} (desistindo)", file=sys.stderr)
                return None
            print(f"  . {method} {path} falhou ({e}); retry em {espera}s", file=sys.stderr)
            time.sleep(espera)
    return None


def checar_robots(ignorar):
    """Respeita robots.txt: aborta se /core/api/ estiver bloqueado (a menos que --ignorar-robots)."""
    if ignorar:
        print("robots.txt: IGNORADO por flag (--ignorar-robots).")
        return True
    rp = RobotFileParser()
    rp.set_url(urljoin(BASE, "/robots.txt"))
    try:
        rp.read()
    except Exception as e:  # noqa: BLE001
        print(f"robots.txt: não foi possível ler ({e}) — prosseguindo com cautela.")
        return True
    permitido = rp.can_fetch(UA, urljoin(BASE, EP_LOTES))
    if not permitido:
        print("robots.txt: /core/api/ está BLOQUEADO para o nosso User-Agent. "
              "Abortando (use --ignorar-robots por sua conta e risco).", file=sys.stderr)
    else:
        print("robots.txt: acesso a /core/api/ permitido.")
    return permitido


def coletar_leiloes(session):
    """ENDPOINT 1 — mapa leilao_id -> metadados do evento (p/ enriquecer os lotes)."""
    dados = pedir(session, "GET", EP_LEILOES)
    mapa = {}
    if not dados:
        return mapa
    for ev in dados.get("items", []) or []:
        lid = ev.get("id") or ev.get("leilao_id")
        if lid is None:
            continue
        mapa[str(lid)] = {
            "leilao_nome": ev.get("nm") or ev.get("nm_descricao") or "",
            "leilao_data": ev.get("dt_formatada") or ev.get("dt") or "",
            "leilao_hora": ev.get("hr_formatada") or "",
            "leilao_leiloeiro": ev.get("nm_url_leiloeiro") or "",
            "leilao_judicial": ev.get("tp_judicial_extrajudicial") or "",
            "leilao_qtde_lotes": ev.get("nu_qtdelotes") or "",
            "leilao_local": ev.get("nm_local") or "",
        }
    print(f"Eventos (get-leiloes): {len(mapa)}")
    return mapa


def coletar_lotes(session, delay):
    """ENDPOINT 2 — POST get-lotes paginado (page=N) até a última página. Retorna todos os lotes."""
    todos = []
    page = 1
    while True:
        dados = pedir(session, "POST", EP_LOTES, data={"page": str(page)})
        if not dados:
            break
        itens = dados.get("items", []) or []
        todos.extend(itens)
        atual = int(dados.get("currentPage") or page)
        total = int(dados.get("totalPages") or atual)
        prox = dados.get("nextPage")
        print(f"  página {atual}/{total}: +{len(itens)} lotes (total {len(todos)})")
        if atual >= total or not prox:
            break
        page = atual + 1
        time.sleep(delay)
    return todos


def linha_csv(lote, leiloes):
    out = {c: lote.get(c, "") for c in CAMPOS_LOTE}
    pai = leiloes.get(str(lote.get("leilao_id")), {})
    for c in CAMPOS_LEILAO_PAI:
        if c == "fotos_qtde":
            fotos = lote.get("fotos")
            out[c] = len(fotos) if isinstance(fotos, list) else ""
        else:
            out[c] = pai.get(c, "")
    return out


def main():
    ap = argparse.ArgumentParser(description="Scraper Verde Amarelo Leilões (Vlance API JSON).")
    ap.add_argument("--categoria", default="Imoveis",
                    help="Filtra por categoria (default 'Imoveis'; ignore acentos/caixa). Use --todas p/ tudo.")
    ap.add_argument("--todas", action="store_true", help="Coleta TODAS as categorias (sem filtro).")
    ap.add_argument("--delay", type=float, default=1.5, help="Segundos entre páginas (default 1.5).")
    ap.add_argument("--out", default=".", help="Diretório de saída (default: atual).")
    ap.add_argument("--ignorar-robots", action="store_true", help="Pula a checagem de robots.txt.")
    args = ap.parse_args()

    if not checar_robots(args.ignorar_robots):
        sys.exit(2)

    session = requests.Session()
    session.headers.update(HEADERS)
    # 1ª visita à página real: pega cookies de sessão (same-origin) antes das APIs.
    try:
        session.get(urljoin(BASE, "/leilao/index/imoveis"), timeout=30)
    except Exception:  # noqa: BLE001
        pass

    leiloes = coletar_leiloes(session)
    time.sleep(args.delay)
    lotes = coletar_lotes(session, args.delay)
    print(f"Lotes coletados (todas categorias): {len(lotes)}")

    if not args.todas:
        alvo = norm(args.categoria)
        lotes = [l for l in lotes if norm(l.get("nm_categoria")) == alvo]
        print(f"Após filtro categoria '{args.categoria}': {len(lotes)} lotes")

    if not lotes:
        print("Nenhum lote para salvar.")
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base_nome = f"verde_amarelo_{'todas' if args.todas else norm(args.categoria)}_{ts}"
    out_dir = args.out.rstrip("/")

    # JSON bruto (todos os campos de cada lote + os leilões, p/ inspeção completa).
    caminho_json = f"{out_dir}/{base_nome}.json"
    with open(caminho_json, "w", encoding="utf-8") as f:
        json.dump({"gerado_em": ts, "base": BASE, "leiloes": leiloes, "lotes": lotes},
                  f, ensure_ascii=False, indent=2)

    # CSV enxuto com os campos relevantes + enriquecimento do leilão-pai.
    caminho_csv = f"{out_dir}/{base_nome}.csv"
    colunas = CAMPOS_LOTE + CAMPOS_LEILAO_PAI
    with open(caminho_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=colunas, extrasaction="ignore")
        w.writeheader()
        for lote in lotes:
            w.writerow(linha_csv(lote, leiloes))

    print(f"\nOK: {len(lotes)} lotes")
    print(f"  JSON: {caminho_json}")
    print(f"  CSV : {caminho_csv}")


if __name__ == "__main__":
    main()
