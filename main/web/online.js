// Ajetrez Online — Supabase client v2
export async function initOnline (opts) {
  const { supabaseUrl, supabaseAnonKey, variant='simple', getLocalState=()=>({}), applyRemoteEvent=()=>{}, onStatus=()=>{} } = opts;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  async function ensureAuth(){ const { data:s }=await supabase.auth.getSession(); if(s?.session?.user) return s.session.user; const { data, error } = await supabase.auth.signInAnonymously(); if(error) throw error; return data.user; }
  const user = await ensureAuth(); onStatus({ type:'auth', userId: user.id });

  function randomCode(n=6){ const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:n},()=>abc[Math.floor(Math.random()*abc.length)]).join('') }
  let channel=null, currentGame=null;

  async function createGame(){ const code=randomCode(); const state=getLocalState(); const { data, error } = await supabase.from('games').insert({ code, variant, status:'waiting', white_id:user.id, turn:'w', state_json: state }).select().single(); if(error) throw error; currentGame=data; onStatus({ type:'game_created', game:data }); return data; }
  async function quickMatch(){ const { data:cand, error:e0 } = await supabase.from('games').select('*').eq('variant',variant).eq('status','waiting').is('black_id',null).neq('white_id',user.id).limit(1); if(e0) throw e0; if(cand?.length){ const g=cand[0]; try{ const { data:upd, error:e2 } = await supabase.from('games').update({ black_id:user.id, status:'active' }).eq('id',g.id).select().single(); if(e2) throw e2; currentGame=upd; onStatus({ type:'matched_as_black', game:upd }); return upd; }catch(e){{}} } return await createGame(); }
  async function subscribeToGame(gameId){ if(channel){{ await supabase.removeChannel(channel); channel=null; }} const {{ data:g, error }} = await supabase.from('games').select('*').eq('id',gameId).single(); if(error) throw error; currentGame=g; onStatus({{ type:'subscribed', game:g }}); const gf=`id=eq.${{gameId}}`, mf=`game_id=eq.${{gameId}}`; channel=supabase.channel(`realtime:game:${{gameId}}`).on('postgres_changes',{{event:'UPDATE',schema:'public',table:'games',filter:gf}},(p)=>{{ currentGame=p.new; onStatus({{ type:'game_update', game:currentGame }}) }}).on('postgres_changes',{{event:'INSERT',schema:'public',table:'moves',filter:mf}},(payload)=>{{ const ev=payload.new; onStatus({{ type:'move_received', ev }}); if(ev.created_by===user.id) return; try{{ applyRemoteEvent({{ kind:ev.kind, payload:ev.payload, ply:ev.ply, created_by:ev.created_by, created_at:ev.created_at }}) }}catch{{}} }}).subscribe((status)=>onStatus({{ type:'channel', status }})); return g; }
  async function send(event){ if(!currentGame) throw new Error('No game selected'); const {{kind, payload}}=event; const {{ data:mv, error }}=await supabase.from('moves').insert({{ game_id:currentGame.id, created_by:user.id, kind, payload }}).select().single(); if(error) throw error; const next=getLocalState(); const {{ data:g2, error:e2 }}=await supabase.from('games').update({{ state_json: next }}).eq('id', currentGame.id).select().single(); if(e2) throw e2; currentGame=g2; onStatus({{ type:'move_sent', mv, game:g2 }}); return mv; }
  async function resign(){ if(!currentGame) return; await supabase.from('moves').insert({{ game_id:currentGame.id, created_by:user.id, kind:'resign', payload:{} }}); await supabase.from('games').update({{ status:'finished' }}).eq('id', currentGame.id); }
  async function leaveGame(){ if(channel){{ await supabase.removeChannel(channel); channel=null; }} currentGame=null; onStatus({{ type:'left' }}) }

  return {{ supabase, user, createGame, quickMatch, subscribeToGame, send, resign, leaveGame }}
}
