/** The credentials of a new room. The token is the creator's identity: keep it on the creator's device and out of invites. */
export interface CreatedRoom { code:string;token:string }
/** A member's own identity for a room it did not create: 32 random bytes, hex. */
export function memberToken():string{return [...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function failure(response:Response,fallback:string):Promise<Error>{
  const body=await response.json().catch(()=>undefined) as {error?:unknown}|undefined;
  return new Error(typeof body?.error==='string'?body.error:fallback);
}
export async function createRoom(apiUrl:(path:string)=>string,fetcher:typeof fetch=fetch):Promise<CreatedRoom>{
  const response=await fetcher(apiUrl('/api/rooms'),{method:'POST'});
  if(!response.ok)throw await failure(response,'Could not create room');
  const body=await response.json() as Partial<CreatedRoom>;
  if(typeof body.code!=='string'||typeof body.token!=='string')throw new Error('Could not create room');
  return{code:body.code,token:body.token};
}
/** Creator only: the room closes for every member and the code is never retried. `init` carries an abort signal or `keepalive` for a page that is leaving. */
export async function endRoom(apiUrl:(path:string)=>string,code:string,token:string,init:Pick<RequestInit,'signal'|'keepalive'>={},fetcher:typeof fetch=fetch):Promise<void>{
  const response=await fetcher(apiUrl(`/api/rooms/${code}/end`),{...init,method:'POST',headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw await failure(response,'Could not end room');
}
