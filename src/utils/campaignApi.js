import {mediaFetch} from '../integrated-media/mediaApi.js';

export async function campaignRequest(path,options={}) {
  const response=await mediaFetch(`/api${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body.error?.message||`Campaign service returned ${response.status}.`),{status:response.status,code:body.error?.code});
  return body;
}
