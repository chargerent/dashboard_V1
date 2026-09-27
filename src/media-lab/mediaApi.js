import {DEFAULT_MEDIA_BACKEND} from './mediaEnvironment.js';
const HOSTED_BASE='https://chargerentstations.com/media-kiosk';
const LOCAL_BASE='/__media_lab';
const MODE_KEY='chargerent-media-api-mode';
export function mediaBackendChoice(choice,stored,defaultBackend=DEFAULT_MEDIA_BACKEND) {
  if(['hosted','local'].includes(choice))return choice;
  if(['hosted','local'].includes(stored))return stored;
  return defaultBackend==='hosted'?'hosted':'local';
}
function selectedMode() {
  if(typeof window==='undefined')return mediaBackendChoice();
  const choice=new URLSearchParams(window.location.search).get('backend');
  try {
    if(['hosted','local'].includes(choice))sessionStorage.setItem(MODE_KEY,choice);
    return mediaBackendChoice(choice,sessionStorage.getItem(MODE_KEY));
  } catch {return mediaBackendChoice(choice);}
}
export const MEDIA_HOSTED=selectedMode()==='hosted';
export const MEDIA_BASE=MEDIA_HOSTED?HOSTED_BASE:LOCAL_BASE;
export function mediaAccessProblem(error) {
  if(error?.code==='MEDIA_ADMIN_REQUIRED')return 'Administrator access required';
  if(error?.status===401||['MEDIA_AUTH_REQUIRED','auth/user-token-expired','auth/invalid-user-token','auth/user-disabled'].includes(error?.code))return 'Sign in required';
  return '';
}
export function mediaUrl(path) {
  if(typeof path!=='string')throw new Error('Invalid media API path.');
  if(/[\\]/.test(path)||path.includes('..')||/%(?:2e|2f|5c)/i.test(path))throw new Error('Invalid media API path.');
  if(path.startsWith(MEDIA_BASE+'/'))return path;
  if(!/^\/(?:api|remote)\//.test(path)||/[\\]/.test(path)||path.includes('..'))throw new Error('Invalid media API path.');
  return MEDIA_BASE+path;
}
export async function mediaHeaders(initial={}) {
  const headers=new Headers(initial);
  if(MEDIA_HOSTED){
    const {getDashboardIdToken}=await import('./dashboardAuth.js');
    headers.set('X-Media-Authorization',`Bearer ${await getDashboardIdToken()}`);
  }
  return headers;
}
export async function mediaFetch(path,options={}) {
  const url=mediaUrl(path);
  return fetch(url,{...options,headers:await mediaHeaders(options.headers)});
}
