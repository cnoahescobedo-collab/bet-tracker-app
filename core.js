/* Core bet logic — copied unchanged from the web app so both versions grade bets the same way. */
const LEAGUES = {
  nba:{label:"NBA",path:"basketball/nba",sport:"bball",periods:4,len:12},
  wnba:{label:"WNBA",path:"basketball/wnba",sport:"bball",periods:4,len:10},
  ncaamb:{label:"NCAAM",path:"basketball/mens-college-basketball",sport:"bball",periods:2,len:20},
  ncaawb:{label:"NCAAW",path:"basketball/womens-college-basketball",sport:"bball",periods:4,len:10},
  nfl:{label:"NFL",path:"football/nfl",sport:"fball"},
  ncaafb:{label:"NCAAF",path:"football/college-football",sport:"fball"},
  mlb:{label:"MLB",path:"baseball/mlb",sport:"base"},
  nhl:{label:"NHL",path:"hockey/nhl",sport:"hock"},
  epl:{label:"Premier League",path:"soccer/eng.1",sport:"soc"},
  laliga:{label:"La Liga",path:"soccer/esp.1",sport:"soc"},
  seriea:{label:"Serie A",path:"soccer/ita.1",sport:"soc"},
  bund:{label:"Bundesliga",path:"soccer/ger.1",sport:"soc"},
  ligue1:{label:"Ligue 1",path:"soccer/fra.1",sport:"soc"},
  mls:{label:"MLS",path:"soccer/usa.1",sport:"soc"},
  ucl:{label:"Champions League",path:"soccer/uefa.champions",sport:"soc"},
  ligamx:{label:"Liga MX",path:"soccer/mex.1",sport:"soc"},
  atp:{label:"ATP",path:"tennis/atp",sport:"ten"},
  wta:{label:"WTA",path:"tennis/wta",sport:"ten"},
  other:{label:"Other",path:null,sport:"other"},
};
const CATEGORY = {bball:"Basketball",fball:"Football",base:"Baseball",hock:"Hockey",soc:"Soccer",ten:"Tennis",other:"Other"};
const KINDS_BY_SPORT = {
  bball:["prop","total","spread","moneyline"], fball:["prop","total","spread","moneyline"],
  base:["prop","total","spread","moneyline"], hock:["prop","total","spread","moneyline"],
  soc:["moneyline","draw","total","spread"], ten:["moneyline"], other:["manual"],
};
const KIND_LABEL = {prop:"Player prop",total:"Game total",spread:"Spread",moneyline:"To win",draw:"Draw",manual:"Other bet"};
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
const sportOf = lg => LEAGUES[lg]?.sport || "other";
const catOf = lg => CATEGORY[sportOf(lg)];

const norm = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
  .replace(/[.'’`\-]/g," ").replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
function sameName(a,b){
  a=norm(a); b=norm(b); if(!a||!b) return false; if(a===b) return true;
  const A=a.split(" "), B=b.split(" ");
  if(A[A.length-1]!==B[B.length-1]) return false;
  return A[0][0]===B[0][0];
}

function flattenAthlete(groups){
  const out={};
  for(const g of groups){
    const gname=g.name||g.type||"";
    (g.keys||[]).forEach((k,i)=>{
      const raw=g.vals[i]; if(raw==null) return;
      const ks=k.split(/[-\/]/), vs=String(raw).split(/[-\/]/);
      if(ks.length>1 && ks.length===vs.length){
        ks.forEach((kk,j)=>{const n=parseFloat(vs[j]); if(!isNaN(n)){ if(!(kk in out)) out[kk]=n; out[gname+"."+kk]=n; }});
      } else { const n=parseFloat(raw); if(!isNaN(n)){ if(!(k in out)) out[k]=n; out[gname+"."+k]=n; } }
    });
  }
  return out;
}
function boxPlayers(summary){
  const res={};
  for(const t of summary?.boxscore?.players||[]){
    const ab=t.team?.abbreviation||"?"; const byId={};
    for(const g of t.statistics||[]){
      for(const a of g.athletes||[]){
        const id=a.athlete?.id||a.athlete?.displayName;
        if(!byId[id]) byId[id]={name:a.athlete?.displayName, groups:[]};
        if(a.stats && a.stats.length) byId[id].groups.push({name:g.name||g.type, keys:g.keys||[], vals:a.stats});
      }
    }
    res[ab]=Object.values(byId).map(p=>({name:p.name, stats:flattenAthlete(p.groups)}));
  }
  return res;
}

const MARKETS = {
  bball:[
    [/pra|p\s*\+\s*r\s*\+\s*a|pts\s*\+\s*rebs?\s*\+\s*asts?|points\s*\+\s*rebounds\s*\+\s*assists/,["points","rebounds","assists"],"pts+reb+ast"],
    [/pts\s*\+\s*rebs?|points\s*\+\s*rebounds|p\s*\+\s*r\b/,["points","rebounds"],"pts+reb"],
    [/pts\s*\+\s*asts?|points\s*\+\s*assists|p\s*\+\s*a\b/,["points","assists"],"pts+ast"],
    [/rebs?\s*\+\s*asts?|rebounds\s*\+\s*assists|r\s*\+\s*a\b/,["rebounds","assists"],"reb+ast"],
    [/stl\s*\+\s*blk|steals\s*\+\s*blocks|blks?\s*\+\s*stls?|stocks/,["steals","blocks"],"stl+blk"],
    [/three|3\s*-?\s*p(oin)?t|3pm|threes|3s\b|3-pointers/,["threePointFieldGoalsMade"],"threes"],
    [/rebound|\brebs?\b/,["rebounds"],"rebounds"],
    [/assist|\basts?\b/,["assists"],"assists"],
    [/steal|\bstls?\b/,["steals"],"steals"],
    [/block|\bblks?\b/,["blocks"],"blocks"],
    [/turnover|\bto\b/,["turnovers"],"turnovers"],
    [/point|\bpts\b/,["points"],"points"],
  ],
  fball:[
    [/pass(ing)?\s*\+\s*rush(ing)?\s*y/,["passingYards","rushingYards"],"pass+rush yds"],
    [/rush(ing)?\s*\+\s*rec(eiving)?\s*y|rush\s*\+\s*rec/,["rushingYards","receivingYards"],"rush+rec yds"],
    [/anytime\s*t(ouch)?d|any\s*td|to score/,["rushingTouchdowns","receivingTouchdowns"],"anytime TD"],
    [/pass(ing)?\s*(yds|yards)|pass\s*yd/,["passingYards"],"passing yds"],
    [/pass(ing)?\s*(tds?|touchdowns?)/,["passingTouchdowns"],"passing TDs"],
    [/completion/,["completions"],"completions"],
    [/pass(ing)?\s*att/,["passingAttempts"],"pass attempts"],
    [/interception/,["passing.interceptions"],"interceptions"],
    [/rush(ing)?\s*(yds|yards)|rush\s*yd/,["rushingYards"],"rushing yds"],
    [/rush(ing)?\s*att|carries/,["rushingAttempts"],"rush attempts"],
    [/rec(eiving)?\s*(yds|yards)|rec\s*yd/,["receivingYards"],"receiving yds"],
    [/reception|\brec\b|catches/,["receptions"],"receptions"],
    [/longest\s*rec/,["longReception"],"longest rec"],
    [/longest\s*rush/,["longRushing"],"longest rush"],
    [/tackle/,["totalTackles"],"tackles"],
    [/sack/,["defensive.sacks"],"sacks"],
    [/kicking\s*p|kicker\s*p/,["totalKickingPoints"],"kicking pts"],
    [/field\s*goals?\s*made|fg\s*made/,["fieldGoalsMade"],"FG made"],
  ],
  base:[
    [/h\s*\+\s*r\s*\+\s*rbi|hits\s*\+\s*runs\s*\+\s*rbis?/,["batting.hits","batting.runs","batting.RBIs"],"H+R+RBI"],
    [/strikeouts?|\bks?\b|pitcher\s*so/,["pitching.strikeouts"],"strikeouts"],
    [/hits\s*allowed/,["pitching.hits"],"hits allowed"],
    [/earned\s*runs?/,["pitching.earnedRuns"],"earned runs"],
    [/walks\s*allowed/,["pitching.walks"],"walks allowed"],
    [/home\s*runs?|\bhr\b/,["batting.homeRuns"],"home runs"],
    [/\brbis?\b|runs\s*batted/,["batting.RBIs"],"RBIs"],
    [/runs\s*scored|\bruns?\b/,["batting.runs"],"runs"],
    [/\bhits?\b/,["batting.hits"],"hits"],
    [/walks?/,["batting.walks"],"walks"],
  ],
  hock:[
    [/shots?\s*on\s*goal|\bsog\b|shots/,["shotsTotal"],"shots on goal"],
    [/saves?/,["saves"],"saves"],
    [/blocked/,["blockedShots"],"blocked shots"],
    [/\bhits?\b/,["hits"],"hits"],
    [/assists?/,["assists"],"assists"],
    [/goals?/,["goals"],"goals"],
    [/points?|\bpts\b/,["goals","assists"],"points"],
  ],
};
function marketFor(league, text){
  const m=MARKETS[sportOf(league)]; if(!m) return null; const s=String(text||"").toLowerCase();
  for(const [re,keys,label] of m) if(re.test(s)) return {keys,label};
  return null;
}

function toGame(e){
  const c=e.competitions?.[0]||{}; const s=e.status?.type||{};
  const teams=(c.competitors||[]).map(t=>({abbr:t.team?.abbreviation, name:t.team?.displayName, short:t.team?.shortDisplayName, nick:t.team?.name, id:t.team?.id, score:Number(t.score||0), winner:t.winner, home:t.homeAway==="home"}));
  return {id:e.id, name:e.shortName, state:s.state, final:!!s.completed, half:s.name==="STATUS_HALFTIME", detail:s.shortDetail||s.detail||"", clock:e.status?.displayClock, period:e.status?.period, date:e.date, teams};
}
function tennisGames(d){
  const out=[];
  for(const ev of d.events||[]) for(const gr of ev.groupings||[]) for(const m of gr.competitions||[]){
    const s=m.status?.type||{};
    const comps=(m.competitors||[]).map(c=>{
      const nm=c.athlete?.displayName || (c.roster?.athletes||[]).map(a=>a.displayName).join(" / ") || c.roster?.displayName || "Player";
      return {name:nm, short:c.athlete?.shortName, abbr:nm.split(" ").pop(), nick:nm.split(" ").pop(), sets:(c.linescores||[]).map(l=>Number(l.value||0)), winner:c.winner};
    });
    if(comps.length===2){
      const [a,b]=comps; let sa=0,sb=0;
      a.sets.forEach((v,i)=>{const w=b.sets[i]; if(w==null) return; if(v>w && (v>=6||s.completed)) sa++; else if(w>v && (w>=6||s.completed)) sb++;});
      a.score=sa; b.score=sb;
    }
    out.push({id:m.id, name:comps.map(c=>c.abbr).join(" v "), state:s.state, final:!!s.completed, detail:(s.shortDetail||s.detail||"")+(gr.grouping?.displayName?" · "+gr.grouping.displayName:""), date:m.date||ev.date, teams:comps, event:ev.name});
  }
  return out;
}
function gamesFromBoard(league, d){ return sportOf(league)==="ten" ? tennisGames(d) : (d.events||[]).map(toGame); }

function teamMatch(game,t){
  const q=norm(t); if(!q) return null;
  return game.teams.find(x=>[x.abbr,x.name,x.short,x.nick].some(v=>{const n=norm(v); return n && (n===q || n.includes(q) || (q.includes(n) && n.length>2));}))
      || game.teams.find(x=>sameName(x.name,t)) || null;
}
function findPlayer(players,name){
  for(const [team,list] of Object.entries(players||{})){const p=list.find(x=>sameName(x.name,name)); if(p) return {team,...p};}
  return null;
}

// Evaluate one leg. Returns {cur, result ("won"/"lost"/"push"/undefined), locked, ...}
function evaluateLeg(leg, game, players){
  const st={game, live:game?.state==="in", final:!!game?.final, cur:null};
  if(leg.kind==="poly"||leg.kind==="pmus"){ st.poly=true; return st; }
  if(leg.kind==="manual" || sportOf(leg.league)==="other"){ st.missing="Mark this leg by hand"; return st; }
  if(!game){ st.missing="Finding the game"; return st; }
  if(leg.kind==="prop"){
    const p=findPlayer(players,leg.player);
    if(!p){
      if(game.final){ st.result="push"; st.locked=true; st.missing="Didn't play — void"; return st; }
      st.missing = game.state==="pre" ? "Starts "+(game.detail||"later") : "Not in the box score yet"; return st;
    }
    const mk = marketFor(leg.league, leg.market);
    if(!mk){ st.missing="Unknown stat “"+leg.market+"”"; return st; }
    st.cur = mk.keys.reduce((s,k)=>s+(p.stats[k]??p.stats[k.split(".").pop()]??0),0);
    const s=p.stats;
    if(sportOf(leg.league)==="bball") st.detail=`${s.points||0} PTS · ${s.rebounds||0} REB · ${s.assists||0} AST · ${s.threePointFieldGoalsMade||0} 3PM${s.minutes!=null?" · "+s.minutes+" MIN":""}`;
    else st.detail=mk.label;
    const L=LEAGUES[leg.league];
    if(st.live && L.len){
      const [mm,ss]=String(game.clock||"0:00").split(":").map(Number); const left=(mm||0)+(ss||0)/60;
      const el= game.half ? L.len*L.periods/2 : (Math.min(game.period,L.periods)-1)*L.len + (L.len-left);
      if(el>3 && game.period<=L.periods) st.pace=st.cur*L.len*L.periods/el;
    }
  } else {
    st.detail=game.teams.map(t=>`${t.abbr} ${t.score}`).join(" · ");
    if(game.state==="pre"){ st.missing="Starts "+(game.detail||"later"); return st; }
    if(leg.kind==="total"){ st.cur=game.teams.reduce((s,t)=>s+t.score,0); }
    else if(leg.kind==="draw"){ st.cur=Math.abs(game.teams[0].score-game.teams[1].score); }
    else {
      const mine=teamMatch(game,leg.team); if(!mine){ st.missing="Couldn't match “"+leg.team+"”"; return st; }
      const opp=game.teams.find(t=>t!==mine); const margin=mine.score-opp.score;
      st.cur = leg.kind==="spread" ? margin+Number(leg.line||0) : margin; st.mine=mine.abbr; st.winner=mine.winner;
    }
  }
  const line=Number(leg.line);
  if(leg.kind==="prop"||leg.kind==="total"){
    const over=(leg.side||"over")==="over";
    if(st.cur>line){ st.result= over?"won":"lost"; st.locked=true; }
    else if(st.final){ st.result= over?"lost":(st.cur<line?"won":"push"); st.locked=true; }
    st.pct=Math.min(1, line>0? st.cur/(line*1.25) : (st.cur>0?1:0)); st.tick=line>0?0.8:0;
  } else if(leg.kind==="draw"){
    if(st.final){ st.result= st.cur===0?"won":"lost"; st.locked=true; }
    st.pct= st.cur===0?1:Math.max(0,1-st.cur/4); st.tick=0;
  } else {
    if(st.final){
      if(leg.kind==="moneyline" && typeof st.winner==="boolean") st.result= st.winner?"won":"lost";
      else st.result= st.cur>0?"won":st.cur<0?"lost":(leg.kind==="moneyline"?"lost":"push");
      st.locked=true;
    }
    st.pct=Math.max(0,Math.min(1,.5+st.cur/(sportOf(leg.league)==="bball"?40:8))); st.tick=.5;
  }
  return st;
}

function slipStatus(results){
  if(results.some(r=>r==="lost")) return "lost";
  if(results.length && results.every(r=>r==="won"||r==="push")) return results.every(r=>r==="push")?"push":"won";
  return "open";
}
function oddsToPayout(stake, odds){
  const o=Number(String(odds).replace(/[^\d.+\-]/g,"")); const s=Number(stake);
  if(!s||!o||Math.abs(o)<100) return null;
  const profit = o>0 ? s*o/100 : s*100/Math.abs(o);
  return Math.round((s+profit)*100)/100;
}
/* ---- Value picks math ---- */
const amToDec = a => { a=Number(a); if(!a) return null; return a>0 ? 1+a/100 : 1+100/Math.abs(a); };
const decToAm = d => d>=2 ? "+"+Math.round((d-1)*100) : "-"+Math.round(100/(d-1));
const impl = a => { const d=amToDec(a); return d?1/d:null; };
// For each side of a game: book fair %, model % (avg of available), edge and EV per $1.
function valueSides(g){
  const out=[];
  const ia=impl(g.mlA), ih=impl(g.mlH); if(ia==null||ih==null) return out;
  const fairA=ia/(ia+ih), fairH=ih/(ia+ih);
  for(const [side,team,ml,fair] of [["A",g.away,g.mlA,fairA],["H",g.home,g.mlH,fairH]]){
    const est=[]; const espn = side==="A"?g.espnA:g.espnH; const poly = side==="A"?g.polyA:g.polyH;
    if(espn!=null) est.push(espn); if(poly!=null) est.push(poly);
    if(!est.length) continue;
    const p=est.reduce((s,x)=>s+x,0)/est.length;
    const dec=amToDec(ml);
    out.push({gameId:g.id, league:g.league, team, opp: side==="A"?g.home:g.away, ml, dec, fair, espn, poly, p, edge:p-fair, ev:p*dec-1, start:g.date, label:g.name});
  }
  return out;
}
// Small longshot parlays from positive-edge sides in different games.
function buildParlays(spots, {minDec=3.5, max=3}={}){
  const pool=spots.filter(s=>s.edge>=0.02 && s.ev>0).sort((a,b)=>b.ev-a.ev).slice(0,8);
  const res=[];
  const add=legs=>{ if(new Set(legs.map(l=>l.gameId)).size!==legs.length) return;
    const dec=legs.reduce((m,l)=>m*l.dec,1), p=legs.reduce((m,l)=>m*l.p,1); if(dec<minDec) return;
    res.push({legs, dec, p, ev:p*dec-1}); };
  for(let i=0;i<pool.length;i++) for(let j=i+1;j<pool.length;j++){ add([pool[i],pool[j]]); for(let k=j+1;k<pool.length;k++) add([pool[i],pool[j],pool[k]]); }
  res.sort((a,b)=>b.ev-a.ev);
  const picked=[], used=new Map();
  for(const r of res){ if(picked.length>=max) break; if(r.legs.some(l=>(used.get(l.team)||0)>=2)) continue; picked.push(r); r.legs.forEach(l=>used.set(l.team,(used.get(l.team)||0)+1)); }
  return picked;
}
const POLY_ABBR = {nba:{gs:"gsw",ny:"nyk",sa:"sas",no:"nop",utah:"uta",wsh:"was"}, nfl:{wsh:"was"}, nhl:{}, mlb:{}, wnba:{}};
function polySlugs(league, g){
  const day=new Date(g.date).toLocaleDateString("en-CA",{timeZone:"America/New_York"});
  const m=POLY_ABBR[league]||{}; const a=String(g.awayAbbr||"").toLowerCase(), h=String(g.homeAbbr||"").toLowerCase();
  const s=new Set([`${league}-${m[a]||a}-${m[h]||h}-${day}`, `${league}-${a}-${h}-${day}`]);
  return [...s];
}
// Polymarket market slug -> category
function polyCategory(slug){
  const s=String(slug||"").toLowerCase().replace(/^[a-z]{2,4}-(?=(nba|wnba|cbb|ncaab|ncaa|nfl|cfb|ncaaf|mlb|nhl|epl|ucl|uel|mls|atp|wta|ufc|f1|lal|sea|bun|fl1)-)/,"");
  if(/^(nba|wnba|cbb|ncaab|euroleague)-/.test(s)) return "Basketball";
  if(/^(nfl|cfb|ncaaf)-/.test(s)) return "Football";
  if(/^mlb-/.test(s)) return "Baseball";
  if(/^nhl-/.test(s)) return "Hockey";
  if(/^(epl|ucl|uel|lal|laliga|sea|seriea|bun|bundesliga|fl1|ligue1|mls|mex|uef|fifa|wc|soccer|efl|ere|por)-/.test(s)) return "Soccer";
  if(/^(atp|wta|tennis)-/.test(s)) return "Tennis";
  if(/^(ufc|mma|boxing)-/.test(s)) return "Fighting";
  if(/^(f1|nascar|golf|pga)-/.test(s)) return "Racing & golf";
  return null; // not a sports market
}

function slipCategory(slip){
  const cats=[...new Set((slip.legs||[]).map(l=>l.cat||catOf(l.league)))];
  return cats.length===1?cats[0]:"Mixed";
}
function profitOf(slip){
  if(slip.pnl!=null && slip.status!=="open") return Number(slip.pnl);
  const st=Number(slip.stake)||0, po=Number(slip.payout)||0;
  if(slip.status==="won") return po? po-st : 0;
  if(slip.status==="lost") return -st;
  return 0;
}
function tally(slips){
  const t={w:0,l:0,p:0,staked:0,profit:0,legsW:0,legsT:0};
  for(const s of slips){
    if(s.status==="won") t.w++; else if(s.status==="lost") t.l++; else if(s.status==="push") t.p++; else continue;
    t.staked+=Number(s.stake)||0; t.profit+=profitOf(s);
    for(const l of s.legs||[]){ if(l.result==="won"||l.result==="lost"){ t.legsT++; if(l.result==="won") t.legsW++; } }
  }
  t.n=t.w+t.l; t.pct=t.n? t.w/t.n : null; t.roi=t.staked? t.profit/t.staked : null; t.legPct=t.legsT? t.legsW/t.legsT : null;
  return t;
}

/* ---- Slip text -> legs, stake, payout ---- */
function similar(a,b){
  if(a===b) return 1; const m=a.length,n=b.length; if(!m||!n) return 0;
  const d=Array.from({length:m+1},(_,i)=>[i]); for(let j=1;j<=n;j++) d[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return 1-d[m][n]/Math.max(m,n);
}
function matchName(line, roster){
  const L=norm(line); if(!L || L.length<4) return null;
  let best=null, bs=0;
  for(const name of roster){
    const n=norm(name); if(!n) continue;
    if(L.includes(n)) return name;
    const parts=n.split(" "); const last=parts[parts.length-1];
    if(parts.length>1 && new RegExp("\\b"+parts[0][0]+" "+last+"\\b").test(L)) return name;
    const w=L.split(" ");
    for(let i=0;i+parts.length<=w.length;i++){ const s=similar(w.slice(i,i+parts.length).join(" "), n); if(s>bs){bs=s;best=name;} }
  }
  return bs>=0.82 ? best : null;
}
function parseMoney(text){
  const t=String(text||"").replace(/,/g,"");
  const num=re=>{const m=t.match(re); return m?Number(m[1]):null;};
  const stake=num(/(?:wager|stake|risk|bet amount|amount|entry)[^\d$\n]{0,12}\$?\s?(\d+(?:\.\d{1,2})?)/i);
  let payout=num(/(?:total payout|payout|to pay|potential (?:payout|win)|returns?)[^\d$\n]{0,12}\$?\s?(\d+(?:\.\d{1,2})?)/i);
  const toWin=num(/to win[^\d$\n]{0,12}\$?\s?(\d+(?:\.\d{1,2})?)/i);
  if(!payout && toWin!=null && stake!=null) payout=Math.round((stake+toWin)*100)/100;
  const om=t.match(/(?:^|\s)([+\-−]\d{3,5})(?!\d)/); const odds=om?om[1].replace("−","-"):null;
  return {stake,payout,odds};
}
function parseSlip(text, league, roster){
  const lines=String(text||"").split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const sp=sportOf(league); const legs=[];
  const hits=[];
  lines.forEach((ln,i)=>{const n=matchName(ln,roster); if(n && !(hits.length && hits[hits.length-1].name===n && hits[hits.length-1].i===i-1)) hits.push({i,name:n});});
  hits.forEach((h,k)=>{
    const end = k+1<hits.length ? hits[k+1].i : Math.min(lines.length, h.i+6);
    const win = lines.slice(h.i, Math.max(end,h.i+1)).join(" \n ");
    const low = win.toLowerCase();
    if(sp==="soc"||sp==="ten"){ // roster here is team/player names: treat as "to win" legs
      legs.push({league, kind:/draw/.test(low)?"draw":"moneyline", team:h.name, line:null, side:"over"}); return;
    }
    let side=null;
    if(/\b(under|less|lower)\b|\bu\s?\d/.test(low)) side="under";
    else if(/\b(over|more|higher)\b|\bo\s?\d|\d\+/.test(low)) side="over";
    let line=null;
    const nums=[...win.replace(/\d{1,2}:\d{2}/g," ").replace(/\$\s?\d+(\.\d+)?/g," ").matchAll(/([+\-−]?)(\d{1,3}(?:\.\d)?)(\+)?(?![\d%:\/])/g)];
    const cands=nums.filter(m=>!(m[1]&&!m[2].includes(".")&&+m[2]>=100)).map(m=>({v:parseFloat(m[2]),plus:!!m[3],half:m[2].endsWith(".5")}));
    const pick = cands.find(c=>c.half) || cands.find(c=>c.plus) || cands.find(c=>c.v>0 && c.v<500);
    if(pick){ line = pick.plus && !pick.half ? pick.v-0.5 : pick.v; if(pick.plus) side=side||"over"; }
    const mk=marketFor(league, low.replace(new RegExp(norm(h.name).split(" ").join("|"),"g")," "));
    legs.push({league, kind:"prop", player:h.name, market:mk?mk.label:"", line, side:side||"over"});
  });
  const seen=new Set();
  return legs.filter(l=>{const k=(l.player||l.team)+"|"+l.market+"|"+l.line; if(seen.has(k)) return false; seen.add(k); return true;});
}

export {LEAGUES,CATEGORY,KIND_LABEL,ESPN,sportOf,catOf,norm,sameName,boxPlayers,marketFor,toGame,tennisGames,gamesFromBoard,teamMatch,findPlayer,evaluateLeg,slipStatus,oddsToPayout,amToDec,decToAm,valueSides,buildParlays,polySlugs,polyCategory,slipCategory,profitOf,tally,parseSlip,parseMoney,matchName};
