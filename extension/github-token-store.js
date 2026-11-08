/*
 * SERP Lens GitHub credential storage.
 * Persistent opt-in uses Chrome extension-local storage, which is NOT
 * encrypted at rest. Chrome sync is never used. Content scripts are denied
 * access when the browser supports storage access levels.
 */
export const SESSION_TOKEN_KEY='serp-lens-chat-bridge-token';
const DEVICE_TOKEN_KEY='serp-lens-device-github-token-v1';
async function trustedStorage(){
  if(typeof chrome.storage.local.setAccessLevel==='function')
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
}
function validRepository(name){
  return typeof name==='string' && /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(name);
}
export async function hasRememberedGitHubToken(repository){
  if(!validRepository(repository))return false;
  await trustedStorage();
  const data=await chrome.storage.local.get(DEVICE_TOKEN_KEY);
  const saved=data?.[DEVICE_TOKEN_KEY];
  return Boolean(saved && saved.repository===repository && typeof saved.token==='string' && saved.token.length>0);
}
export async function readGitHubToken(repository){
  const session=await chrome.storage.session.get(SESSION_TOKEN_KEY);
  const ephemeral=session?.[SESSION_TOKEN_KEY];
  if(typeof ephemeral==='string' && ephemeral)return ephemeral;
  if(!validRepository(repository))return '';
  await trustedStorage();
  const local=await chrome.storage.local.get(DEVICE_TOKEN_KEY);
  const saved=local?.[DEVICE_TOKEN_KEY];
  return saved?.repository===repository && typeof saved.token==='string'?saved.token:'';
}
export async function saveGitHubToken({repository,token,remember=false}){
  if(!validRepository(repository)||typeof token!=='string'||!token.trim())
    throw Error('유효한 저장소와 토큰을 확인하세요.');
  await trustedStorage();
  const secret=token.trim();
  await chrome.storage.session.set({[SESSION_TOKEN_KEY]:secret});
  if(remember){
    await chrome.storage.local.set({[DEVICE_TOKEN_KEY]:{
      repository,token:secret,saved_at:new Date().toISOString()
    }});
  }else{
    await chrome.storage.local.remove(DEVICE_TOKEN_KEY);
  }
}
export async function clearGitHubToken(){
  await trustedStorage();
  await chrome.storage.session.remove(SESSION_TOKEN_KEY);
  await chrome.storage.local.remove(DEVICE_TOKEN_KEY);
}
