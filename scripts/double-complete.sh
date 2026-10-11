#!/usr/bin/env bash
# 완료 요청 두 개를 '동시에' 보내 DB가 한 건만 남기는지 확인한다 (버튼 잠금과 무관한 시험).
# 사용: ./scripts/double-complete.sh https://내-주소 할일ID
set -euo pipefail
BASE="${1:?주소를 주세요}"; TASK="${2:?할 일 ID를 주세요}"
echo "== 되돌려서 진행 중으로 만들기"
curl -s -X POST "$BASE/api/tasks/$TASK/reopen" -o /dev/null
for i in 1 2; do
  curl -s -X POST "$BASE/api/tasks/$TASK/complete" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)" \
    -w "  요청 $i → HTTP %{http_code}\n" -o /dev/null &
done
wait
echo "== 201 한 번, 200 한 번이 나오면 통과 (201 = 새 완료 기록, 200 = 겹친 요청이라 기록 안 함)"
echo "== 내보내기에서 이 할 일의 reopened_at이 비어 있는 완료 기록 수:"
curl -s "$BASE/api/export" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ',j.task_completions.filter(c=>String(c.task_id)==='$TASK'&&!c.reopened_at).length,'건 (1이면 통과)')})"
