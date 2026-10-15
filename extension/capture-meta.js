/* URL validation and filenames for a user-initiated capture. No network requests. */
export function isNaverSearchURL(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      (u.hostname === 'search.naver.com' || u.hostname === 'm.search.naver.com') &&
      u.pathname === '/search.naver' &&
      Boolean(u.searchParams.get('query')?.trim());
  } catch { return false; }
}
export function queryFromSearchURL(raw) {
  if (!isNaverSearchURL(raw)) return '';
  return new URL(raw).searchParams.get('query').trim();
}
export function deviceFromSearchURL(raw) {
  return new URL(raw).hostname === 'm.search.naver.com' ? 'mo' : 'pc';
}
export function kstStamp(date = new Date()) {
  const items = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(items.map(({ type, value }) => [type, value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}
export function evidenceFileBase(raw, now = new Date()) {
  const keyword = queryFromSearchURL(raw);
  if (!keyword) throw new Error('지원하지 않는 네이버 검색결과 URL입니다.');
  const clean = keyword.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/[_\s]+/g, ' ').trim().slice(0, 72);
  return `${kstStamp(now)}_${deviceFromSearchURL(raw)}_${clean || '검색결과'}`;
}
