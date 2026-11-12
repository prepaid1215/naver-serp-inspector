# 기존 ChatGPT 예약 작업용 프롬프트

대상 작업: `네이버 4인 발행 키워드 배정` (`6af51febd6308191a5d6655dad3101d5`)

새 예약 작업을 만들지 말고 기존 작업의 지침만 아래 내용으로 갱신한다. 예약 시각은 기존 08:55, 10:55, 13:55 KST를 유지한다.

```text
매 실행마다 다음 공개 JSON을 읽어 네이버 블로그 발행 관제 보고를 작성해줘.

https://raw.githubusercontent.com/prepaid1215/naver-serp-inspector/main/web/ops-data/latest.json

반드시 schema가 naver-blog-ops-v2인지 확인하고, captured_at_kst와 현재 Asia/Seoul 시각의 차이를 계산해줘. 45분을 넘으면 STALE로 보고하고 현재 순위나 발행자를 확정하지 마.

운영 기준은 INTEGRATED_FEED_BLOG_CARDS_TOP10 표면이다. 이것은 네이버 모바일 통합검색 피드에서 광고·AI 브리핑을 제외한 블로그 카드의 관측 순번(rank)이며 카페 카드를 포함한 피드 순번(feed_rank)을 함께 기록한다. 네이버가 제공하는 공식 순위나 별도 '블로그 영역' 순위라고 부르지 마. status가 VERIFIED인 검색어만 순번과 노출/미노출 근거로 쓰고, CANDIDATE, PARTIAL, UNKNOWN, BLOCKED, ERROR, STALE은 근거로 쓰지 마. INTEGRATED_BLOG_SECTION_TOP10과 INTEGRATED_BLOG_ARTICLES_TOP10은 참고용이며 배정에 쓰지 마.

recommendation.status가 READY 또는 PARTIAL이고 해당 keyword의 3개 변형 검색어가 모두 최신 VERIFIED일 때만 assignment의 키워드, 2인 팀, titles를 제안해. PENDING이면 담당자를 새로 추측하거나 배정하지 말고 정확한 보류 이유와 다음 조치만 알려줘.

보고 형식:
1. 실제 captured_at_kst와 최신성
2. 12개 검색어의 VERIFIED/CANDIDATE/PARTIAL/UNKNOWN/BLOCKED/ERROR/STALE 개수
3. 검증된 순위 변화와 이탈만 요약
4. 발행 시각, 키워드, 2인 팀, 사람별 서로 다른 제목 초안 또는 배정 보류
5. 운영자가 해야 할 한 가지 조치

제목은 검증 자료에 없는 가격, 혜택, 서비스 조건, 즉시 개통 보장을 새로 만들지 마. 발행은 운영자가 최종 결정하며 네이버에 자동 게시하지 마.
```

공식 OpenAI 문서 권고처럼 예약 프롬프트는 각 실행의 자료 위치, 판정 조건, 보고 형식과 사용자 입력이 필요한 조건을 자체적으로 설명하는 지속 가능한 형태로 유지한다.

