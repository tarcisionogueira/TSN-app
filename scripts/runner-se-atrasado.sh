#!/usr/bin/env bash
# RECUPERA A RODADA PERDIDA (25/09, pedido do dono: "caso eu desligue o computador, deixe organizado
# para no próximo momento disponível rodar").
#
# O cron do runner (02/08/14/20h) só dispara se a máquina estiver ligada NAQUELE minuto; computador
# desligado ou WSL fechado = rodada perdida até o próximo horário (até 6 h depois). Este verificador
# roda a cada 30 min e dispara o runner quando a última rodada COMPLETA (carimbo escrito só no fim de
# runner-residencial.sh) tem mais de 6 h — ou seja, na primeira meia hora em que a máquina volta.
# Não duplica: o runner tem trava de instância única (flock), e os gates de cada fonte continuam
# valendo (72 h por leiloeiro), então rodar "a mais" custa só o que estiver vencido.
#
# crontab:  */30 * * * * /home/<usuario>/tsn-app/scripts/runner-se-atrasado.sh >> ~/bidpro-runner.log 2>&1
set -u
LIMITE_S=$(( 6 * 3600 ))
ULTIMO="$(cat "$HOME/.bidpro-runner.ultimo" 2>/dev/null || echo 0)"
AGORA="$(date +%s)"
IDADE=$(( AGORA - ULTIMO ))
if [ "$IDADE" -lt "$LIMITE_S" ]; then exit 0; fi   # em dia: silêncio (roda a cada 30 min, não polui o log)
# Já tem runner rodando (o do horário, ou outro recuperador)? Não atropela — o flock do runner
# também seguraria, mas assim o log não ganha uma linha de "já há um runner" a cada 30 min.
if command -v flock >/dev/null 2>&1 && ! flock -n "$HOME/.bidpro-runner.lock" true; then exit 0; fi
echo "[$(date)] recuperando rodada atrasada: última completa há $(( IDADE / 3600 )) h — iniciando o runner"
exec "$(cd "$(dirname "$0")" && pwd)/runner-residencial.sh"
