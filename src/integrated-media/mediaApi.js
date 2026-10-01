const HOSTED_BASE='https://chargerentstations.com/media-kiosk';
export const MEDIA_HOSTED=true;
export const MEDIA_BASE=HOSTED_BASE;
export function mediaAccessProblem(error) {
  if(error?.code==='MEDIA_ADMIN_REQUIRED')return 'Administrator access required';
  if(error?.status===401||['MEDIA_AUTH_REQUIRED','auth/user-token-expired','auth/invalid-user-token','auth/user-disabled'].includes(error?.code))return 'Sign in required';
  return '';
}
export function mediaUrl(path) {
  if(typeof path!=='string')throw new Error('Invalid media API path.');
  if(/[\\]/.test(path)||path.includes('..')||/%(?:2e|2f|5c)/i.test(path))throw new Error('Invalid media API path.');
  if(path.startsWith(MEDIA_BASE+'/'))return path;
  if(!/^\/api\//.test(path)||/[\\]/.test(path)||path.includes('..'))throw new Error('Invalid media API path.');
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
