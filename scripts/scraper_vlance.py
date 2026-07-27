#!/usr/bin/env python3
"""
Scraper — plataforma VLANCE (multi-tenant)
==========================================
Um ÚNICO scraper para todos os leiloeiros que rodam a plataforma Vlance (mesma API JSON):
verdeamarelo, sudeste, capitalvalor (e futuros tenants — é só somar o domínio).

APIs (mapeadas no console do navegador — ver docs/RECON_LEILOEIROS_PLAYBOOK.md):
  GET  {base}/core/api/get-leiloes            -> eventos (leilão-pai)
  POST {base}/core/api/get-lotes  body=page=N -> LOTES (dados reais), paginado
       (GET => "Metodo nao permitido"; traz TODAS as categorias; filtra-se no cliente)

Uso:
  python3 scraper_vlance.py                                  # os 3 tenants, só Imóveis -> CSV+JSON
  python3 scraper_vlance.py --dominios sudesteleiloes.com.br # um domínio
  python3 scraper_vlance.py --todas                          # todas as categorias
  python3 scraper_vlance.py --supabase                       # + GRAVA no acervo (fonte VLANCE)

Ingestão no BidPro (--supabase): upsert em imoveis_leilao por fonte_id (dedup, idempotente).
Requer env SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_KEY. Pula lotes de
SIMULAÇÃO/TESTE e lotes não-ativos. Rode da sua máquina (IP residencial): a API dá 403 em
IP de datacenter (por isso não roda na CI sem Bright Data). Respeita robots.txt por padrão.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urljoin, urlencode
from urllib.robotparser import RobotFileParser

import requests

TENANTS_PADRAO = ["verdeamareloleiloes.com.br", "sudesteleiloes.com.br", "capitalvalorleiloes.com.br"]
EP_LEILOES = "/core/api/get-leiloes"
EP_LOTES = "/core/api/get-lotes"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

CAMPOS_LOTE = [
    "lote_id", "leilao_id", "id", "nm_titulo_lote", "nm_titulo_leilao",
    "nm_categoria", "nm_subcategoria", "nm_segmento", "nm_cidade", "nm_estado",
    "vl_lanceminimo", "vl_lanceinicial", "vl_venda", "vl_lanceinicialsegundoleilao",
    "nu_parcelas", "dt_fechamento", "dt_fechamento_formatado", "nm_statuslote",
    "imovel_id", "veiculo_id", "equipamento_id", "nm_leiloeiro", "nu_visitas", "nu_qtdelances",
]
CAMPOS_LEILAO_PAI = ["leilao_nome", "leilao_data", "leilao_leiloeiro", "leilao_judicial", "fotos_qtde"]

RE_SIMULACAO = re.compile(r"simula|teste|homolog|sandbox", re.I)
STATUS_ATIVO = re.compile(r"aberto|recebendo|lance|propost|dispon", re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return s.lower().strip()


def slug(dom):
    return re.sub(r"leiloes?$", "", norm(dom).split(".")[0]).strip("-") or norm(dom).split(".")[0]


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def inferir_tipo(cat, sub, titulo):
    t = norm(f"{cat} {sub} {titulo}")
    if re.search(r"apartament|apto|flat|kitnet|studio|cobertura", t):
        return "apartamento"
    if re.search(r"casa|sobrado|residenc", t):
        return "casa"
    if re.search(r"terreno|lote|gleba|area|chacara", t):
        return "terreno"
    if re.search(r"comercial|loja|sala|galp|predio|escritorio", t):
        return "comercial"
    if re.search(r"rural|fazenda|sitio", t):
        return "rural"
    return "outros"


# Bright Data Web Unlocker: a API Vlance dá 403 em IP de datacenter (CI/Vercel). Com
# BRIGHTDATA_API_TOKEN/ZONE no ambiente, roteamos as chamadas pela Web Unlocker (/request,
# format=raw → devolve o corpo cru da fonte = o JSON). Sem os envs, cai no fetch DIRETO (uso
# local, IP residencial da máquina do dono). Suporta GET (get-leiloes) e POST (get-lotes page=N).
BD_TOKEN = os.environ.get("BRIGHTDATA_API_TOKEN")
BD_ZONE = os.environ.get("BRIGHTDATA_ZONE")
USA_BD = bool(BD_TOKEN and BD_ZONE)


def bd_request(url, method="GET", data=None, timeout=60):
    payload = {"zone": BD_ZONE, "url": url, "method": method, "format": "raw"}
    if data is not None:
        payload["data"] = urlencode(data)
        payload["headers"] = {"Content-Type": "application/x-www-form-urlencoded"}
    return requests.post(
        "https://api.brightdata.com/request",
        headers={"Authorization": f"Bearer {BD_TOKEN}", "Content-Type": "application/json"},
        json=payload, timeout=timeout,
    )


def pedir(session, method, base, path, data=None, tentativas=4):
    url = urljoin(base, path)
    for i in range(tentativas):
        try:
            if USA_BD:
                r = bd_request(url, method=method, data=data)
            else:
                r = session.post(url, data=data, timeout=30) if method == "POST" else session.get(url, timeout=30)
            if not r.ok:
                raise requests.HTTPError(f"HTTP {r.status_code}: {str(getattr(r, 'text', ''))[:300]}")
            return r.json()
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"  ! {method} {path} falhou: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** (i + 1))
    return None


def checar_robots(base, ignorar):
    if ignorar:
        return True
    rp = RobotFileParser()
    rp.set_url(urljoin(base, "/robots.txt"))
    try:
        rp.read()
    except Exception:  # noqa: BLE001
        return True
    ok = rp.can_fetch(UA, urljoin(base, EP_LOTES))
    if not ok:
        print(f"  robots.txt bloqueia /core/api/ em {base} — pulando (use --ignorar-robots).", file=sys.stderr)
    return ok


def coletar_leiloes(session, base):
    dados = pedir(session, "GET", base, EP_LEILOES)
    mapa = {}
    for ev in (dados or {}).get("items", []) or []:
        lid = ev.get("id") or ev.get("leilao_id")
        if lid is None:
            continue
        mapa[str(lid)] = {
            "leilao_nome": ev.get("nm") or ev.get("nm_descricao") or "",
            "leilao_data": ev.get("dt") or ev.get("dt_formatada") or "",
            "leilao_leiloeiro": ev.get("nm_url_leiloeiro") or "",
            "leilao_judicial": ev.get("tp_judicial_extrajudicial") or "",
        }
    return mapa


def coletar_lotes(session, base, delay):
    todos, page = [], 1
    while True:
        dados = pedir(session, "POST", base, EP_LOTES, data={"page": str(page)})
        if not dados:
            break
        itens = dados.get("items", []) or []
        todos.extend(itens)
        atual = int(dados.get("currentPage") or page)
        total = int(dados.get("totalPages") or atual)
        print(f"    página {atual}/{total}: +{len(itens)} (total {len(todos)})")
        if atual >= total or not dados.get("nextPage"):
            break
        page = atual + 1
        time.sleep(delay)
    return todos


def data_leilao(lote, pai):
    for cand in (lote.get("dt_fechamento"), pai.get("leilao_data")):
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(cand or ""))
        if m:
            return m.group(0)
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", str(cand or ""))
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def foto_url(lote):
    fotos = lote.get("fotos")
    if isinstance(fotos, list) and fotos:
        f = fotos[0]
        if isinstance(f, str):
            return f
        if isinstance(f, dict):
            for k in ("url", "nm_foto", "nm_arquivo", "src", "link"):
                if f.get(k):
                    return str(f[k])
    return None


def montar_row(lote, pai, base, dom):
    """Mapeia um lote Vlance -> linha de imoveis_leilao (mesma forma dos scrapers Node)."""
    va = next((num(lote.get(k)) for k in ("vl_venda", "vl_lanceinicial", "vl_lanceminimo") if num(lote.get(k)) > 0), 0.0)
    vm = next((num(lote.get(k)) for k in ("vl_lanceminimo", "vl_lanceinicial") if num(lote.get(k)) > 0), 0.0)
    if va > 0 and vm > va:  # evita desconto negativo (mín > avaliação): trata mín como piso
        va = vm
    desconto = round((1 - vm / va) * 100) if va > 0 and vm > 0 else None
    judicial = norm(pai.get("leilao_judicial")) or norm(lote.get("tp_judicial_extrajudicial"))
    modalidade = "judicial" if "jud" in judicial and "extra" not in judicial else "extrajudicial"
    return {
        "fonte": "VLANCE",
        "fonte_id": f"vlance_{slug(dom)}_{lote.get('lote_id')}",
        "titulo": (lote.get("nm_titulo_lote") or f"Lote {lote.get('lote_id')}")[:180],
        "tipo": inferir_tipo(lote.get("nm_categoria"), lote.get("nm_subcategoria"), lote.get("nm_titulo_lote")),
        "modalidade": modalidade,
        "cidade": lote.get("nm_cidade") or None,
        "estado": (lote.get("nm_estado") or "")[:2].upper() or None,
        "valor_avaliacao": va,
        "valor_minimo": vm,
        "descricao": (lote.get("nm_titulo_lote") or "")[:500],
        "link_edital": urljoin(base, f"/leilao/index/imoveis"),
        "url_lote": base,
        "link_foto": foto_url(lote),
        "leiloeiro": lote.get("nm_leiloeiro") or pai.get("leilao_leiloeiro") or f"{slug(dom).capitalize()} Leilões",
        "data_leilao": data_leilao(lote, pai),
        "forma_pagamento": "a_vista",
        "ativo": True,
        "viavel": (1 - vm / va) >= 0.3 if va > 0 and vm > 0 else None,
        "score_viabilidade": min(100, round((1 - vm / va) * 150)) if va > 0 and vm > 0 else 30,
        "desconto_percentual": desconto if (desconto is not None and desconto >= 0) else None,
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
    }


def eh_ingerivel(lote):
    """Só grava no acervo lotes REAIS e ATIVOS (pula simulação/teste e encerrados)."""
    txt = f"{lote.get('nm_titulo_lote','')} {lote.get('nm_titulo_leilao','')}"
    if RE_SIMULACAO.search(txt):
        return False
    if not STATUS_ATIVO.search(str(lote.get("nm_statuslote", ""))):
        return False
    return True


def upsert_supabase(rows):
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("!! --supabase: faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no ambiente.", file=sys.stderr)
        return
    if not rows:
        print("   (nada a gravar no acervo)")
        return
    endpoint = f"{url.rstrip('/')}/rest/v1/imoveis_leilao?on_conflict=fonte_id"
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    total = 0
    for i in range(0, len(rows), 200):
        lote = rows[i:i + 200]
        r = requests.post(endpoint, headers=headers, data=json.dumps(lote), timeout=60)
        if r.status_code >= 300:
            print(f"!! erro upsert ({r.status_code}): {r.text[:300]}", file=sys.stderr)
            return
        total += len(lote)
    print(f"   ✅ acervo: {total} imóvel(is) upsert em imoveis_leilao (fonte VLANCE)")


def main():
    ap = argparse.ArgumentParser(description="Scraper multi-tenant da plataforma Vlance.")
    ap.add_argument("--dominios", default=",".join(TENANTS_PADRAO), help="csv de domínios (default: os 3 tenants).")
    ap.add_argument("--categoria", default="Imoveis", help="Filtra categoria (default Imoveis; --todas p/ tudo).")
    ap.add_argument("--todas", action="store_true", help="Todas as categorias.")
    ap.add_argument("--supabase", action="store_true", help="Grava no acervo (imoveis_leilao, fonte VLANCE).")
    ap.add_argument("--delay", type=float, default=1.5, help="Segundos entre requisições.")
    ap.add_argument("--out", default=".", help="Diretório de saída (CSV/JSON).")
    ap.add_argument("--ignorar-robots", action="store_true")
    args = ap.parse_args()

    dominios = [d.strip() for d in args.dominios.split(",") if d.strip()]
    todos_lotes, rows_acervo = [], []

    for dom in dominios:
        base = f"https://www.{dom.replace('www.', '')}"
        print(f"\n=== {dom} ===")
        if not checar_robots(base, args.ignorar_robots):
            continue
        session = requests.Session()
        session.headers.update({
            "User-Agent": UA, "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest", "Referer": urljoin(base, "/leilao/index/imoveis"), "Origin": base,
        })
        try:
            session.get(urljoin(base, "/leilao/index/imoveis"), timeout=30)  # cookies same-origin
        except Exception:  # noqa: BLE001
            pass

        leiloes = coletar_leiloes(session, base)
        time.sleep(args.delay)
        lotes = coletar_lotes(session, base, args.delay)
        if not args.todas:
            alvo = norm(args.categoria)
            lotes = [l for l in lotes if norm(l.get("nm_categoria")) == alvo]
        print(f"  {dom}: {len(lotes)} lote(s){'' if args.todas else ' (Imóveis)'}")

        for l in lotes:
            l["_dominio"] = dom
            todos_lotes.append(l)
            if args.supabase and eh_ingerivel(l):
                rows_acervo.append(montar_row(l, leiloes.get(str(l.get("leilao_id")), {}), base, dom))
        time.sleep(args.delay)

    if not todos_lotes:
        print("\nNenhum lote coletado.")
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    nome = f"{args.out.rstrip('/')}/vlance_{'todas' if args.todas else norm(args.categoria)}_{ts}"
    with open(f"{nome}.json", "w", encoding="utf-8") as f:
        json.dump({"gerado_em": ts, "lotes": todos_lotes}, f, ensure_ascii=False, indent=2)
    with open(f"{nome}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_LOTE + ["_dominio"], extrasaction="ignore")
        w.writeheader()
        for l in todos_lotes:
            w.writerow(l)
    print(f"\nOK: {len(todos_lotes)} lote(s) -> {nome}.csv / .json")

    if args.supabase:
        print(f"\nIngestão no acervo: {len(rows_acervo)} elegível(is) (após pular simulação/encerrados)")
        upsert_supabase(rows_acervo)


if __name__ == "__main__":
    main()
