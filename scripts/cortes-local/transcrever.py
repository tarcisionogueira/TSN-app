# Transcreve com faster-whisper e (opcional) escolhe trechos com gancho.
# Uso:  python transcrever.py <audio.wav> <saida.json> --modelo medium --device cpu --compute int8
# Saída: JSON com segmentos (início, fim, texto), duração do áudio e tempos medidos.
# Pendência 476 (pendencias_projeto). Roda 100% local: nenhum dado sai do computador
# (só o download do modelo na 1ª vez, do Hugging Face).
import argparse
import json
import re
import sys
import time


def transcrever(caminho, modelo, device, compute):
    from faster_whisper import WhisperModel

    t0 = time.perf_counter()
    m = WhisperModel(modelo, device=device, compute_type=compute)
    t_carga = time.perf_counter() - t0

    t1 = time.perf_counter()
    segs, info = m.transcribe(caminho, language="pt", vad_filter=True, beam_size=5)
    lista = [{"ini": round(s.start, 2), "fim": round(s.end, 2), "texto": s.text.strip()} for s in segs]
    t_transc = time.perf_counter() - t1  # o gerador só roda de fato ao ser consumido acima

    dur = info.duration
    return {
        "modelo": modelo, "device": device, "compute": compute,
        "duracao_audio_s": round(dur, 1),
        "carga_modelo_s": round(t_carga, 1),
        "transcricao_s": round(t_transc, 1),
        "x_tempo_real": round(dur / t_transc, 2) if t_transc > 0 else None,
        "segmentos": lista,
    }


# ---------- escolha de trechos (heurística local, sem IA paga) ----------
# Público: investidor em leilão de imóveis, 30+. Gancho = número, caso real, alerta, opinião forte.
GANCHO = [
    (r"r\$|\breais\b|\bmil\b|\bmilh", 3), (r"\d", 2), (r"%|por cento", 2),
    (r"arremat", 3), (r"lucr|desconto|abaixo do (valor|mercado)|metade do preço", 3),
    (r"\berr(o|ei|aram)\b|cuidado|armadilha|perig|prejuízo|perdeu|perdi", 3),
    (r"ningu[eé]m (te )?(fala|conta)|segredo|verdade|mito|nunca|jamais", 2),
    (r"caixa|matr[ií]cula|edital|iptu|condom[ií]nio|d[ií]vida|ocupad|desocupa|imiss[aã]o|despejo", 2),
    (r"caso|cliente|aconteceu|semana passada|ontem|esse im[oó]vel", 2),
]
MULETA_INICIO = re.compile(r"^(é+|e+|então|aí|né|tipo|bom|bem|ah+|hum+|ok|beleza|por exemplo)\b[,.]?", re.I)


def nota(texto):
    t = texto.lower()
    return sum(peso for pad, peso in GANCHO if re.search(pad, t))


def escolher(segs, n=3, minimo=30.0, maximo=60.0):
    cands = []
    for i, s in enumerate(segs):
        if MULETA_INICIO.match(s["texto"]) or not s["texto"][:1].isalpha():
            continue
        # início do trecho: valoriza a 1ª frase (é ela que segura o espectador)
        abertura = nota(s["texto"]) * 2
        texto, fim_j = s["texto"], None
        for j in range(i + 1, len(segs)):
            d = segs[j]["fim"] - s["ini"]
            if d > maximo:
                break
            texto += " " + segs[j]["texto"]
            if d >= minimo and re.search(r"[.!?]$", segs[j]["texto"]):
                fim_j = j  # fecha em fim de frase, nunca no meio (nem num número solto)
        if fim_j is None:
            continue
        txt = " ".join(x["texto"] for x in segs[i:fim_j + 1])
        cands.append({
            "ini": s["ini"], "fim": segs[fim_j]["fim"],
            "nota": round(abertura + nota(txt) * 45 / (segs[fim_j]["fim"] - s["ini"]), 1),
            "abertura": s["texto"], "texto": txt,  # nota por densidade: trecho longo não ganha só por ser longo
        })
    cands.sort(key=lambda c: -c["nota"])
    escolhidos = []
    for c in cands:  # sem sobreposição
        if all(c["fim"] <= e["ini"] or c["ini"] >= e["fim"] for e in escolhidos):
            escolhidos.append(c)
        if len(escolhidos) == n:
            break
    return sorted(escolhidos, key=lambda c: c["ini"])


def srt(segs, ini, fim, caminho):
    def ts(x):
        x = max(0.0, x)
        h, r = divmod(x, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02}:{int(m):02}:{int(s):02},{int(round((s % 1) * 1000)):03}"
    n = 0
    with open(caminho, "w", encoding="utf-8") as f:
        for s in segs:
            if s["fim"] <= ini or s["ini"] >= fim:
                continue
            n += 1
            f.write(f"{n}\n{ts(s['ini'] - ini)} --> {ts(min(s['fim'], fim) - ini)}\n{s['texto']}\n\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("entrada")
    ap.add_argument("saida")
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute", default="int8")
    ap.add_argument("--cortes", type=int, default=0, help="quantos trechos escolher (0 = só transcrever)")
    ap.add_argument("--pasta-srt", default=None)
    a = ap.parse_args()

    r = transcrever(a.entrada, a.modelo, a.device, a.compute)
    if a.cortes:
        r["cortes"] = escolher(r["segmentos"], a.cortes)
        if not r["cortes"]:
            print("AVISO: nenhum trecho de 30-60 s fechando em fim de frase foi achado.", file=sys.stderr)
        if a.pasta_srt:
            for k, c in enumerate(r["cortes"], 1):
                srt(r["segmentos"], c["ini"], c["fim"], f"{a.pasta_srt}/corte{k}.srt")
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in r.items() if k not in ("segmentos",)}, ensure_ascii=False))
