const D=require('better-sqlite3');
const db=new D(process.env.DB||'/app/data/mafia.db',{readonly:true,fileMustExist:true});
const t=(f)=>{const s=process.hrtime.bigint();const r=f();return [Number(process.hrtime.bigint()-s)/1e6,r];};
const [tl,games]=t(()=>db.prepare("SELECT id FROM games WHERE status='ENDED' ORDER BY created_at DESC LIMIT 1000").all());
const st=db.prepare("SELECT json_extract(data,'$.winner') AS w FROM events WHERE game_id=? AND phase='GAME_OVER' AND json_extract(data,'$.winner') IN ('MAFIA','TOWN') ORDER BY sequence DESC LIMIT 1");
const [tn,res]=t(()=>{let m=0,tw=0;for(const g of games){const row=st.get(g.id);if(row&&row.w==='MAFIA')m++;else if(row&&row.w==='TOWN')tw++;}return {m,tw};});
console.log(JSON.stringify({cold_listGames_ms:+tl.toFixed(1),games:games.length,n1_loop_ms:+tn.toFixed(1),per_game_ms:+(tn/games.length).toFixed(3),res}));
