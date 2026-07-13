// REC Reporting Dashboard — front-end.
// Data is fetched from the local server (/api/data), which scans the data/
// folder on every request. Refreshing the page (or the Refresh button) rebuilds
// every report from whatever CSVs are currently in data/.

const C = {green:'#35c28e',amber:'#f5b74e',red:'#ef5a6f',teal:'#3fb8c4',accent:'#4f8cff',accent2:'#7c5cff',muted:'#9aa2b1',line:'#2a2f3d'};
Chart.defaults.color = C.muted; Chart.defaults.borderColor = C.line; Chart.defaults.font.family='inherit';

const charts = {};
function mk(id,cfg){ if(charts[id])charts[id].destroy(); charts[id]=new Chart(document.getElementById(id),cfg); }
const fmt = n => (n||0).toLocaleString();
const pct = (a,b)=> b?Math.round(1000*a/b)/10:0;
const uniq = (arr)=>[...new Set(arr)].sort();
const gradeOrder=['PK','KG','01','02','03','04','05','06','07','08','09','10','11','12','Optional'];
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---- module state, (re)assigned on every data load ----
let DATA={access:[],registration:[],attendance:[],holidays:[]};
let HOLIDAYS=new Set(), MISSING=[];
const state={loc:'ALL', grade:'ALL'};

const fLoc=document.getElementById('fLoc'), fGrade=document.getElementById('fGrade');

function fLocOk(l){return state.loc==='ALL'||l===state.loc;}
function fGrOk(g){return state.grade==='ALL'||g===state.grade;}
function accF(){return DATA.access.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade));}
function regF(){return DATA.registration.filter(r=>fLocOk(r.loc)&&fGrOk(r.grade));}
function attF(){return DATA.attendance.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade));}
function missF(){return MISSING.filter(g=>fLocOk(g.loc)&&fGrOk(g.grade));}

// ---- Missing attendance = date/class combos with NO attendance entered ----
// A class is "missing" a date only when: (1) the date falls within the class's
// own weekly cadence between its first and last recorded date, (2) the location
// WAS in session that date (another class recorded), and (3) it is not a
// scheduled holiday. This avoids flagging center-wide closures.
function computeMissing(){
  const addD=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const locDates={}; DATA.attendance.forEach(a=>{(locDates[a.loc]=locDates[a.loc]||new Set()).add(a.date);});
  const cls={}; DATA.attendance.forEach(a=>{const k=a.loc+'|'+a.grade+'|'+a.section;
    (cls[k]=cls[k]||{loc:a.loc,grade:a.grade,section:a.section,dates:new Set()}).dates.add(a.date);});
  const gaps=[];
  Object.values(cls).forEach(c=>{
    const cd=[...c.dates].sort(); const mn=cd[0],mx=cd[cd.length-1];
    if(!mn) return;
    for(let d=mn; d<=mx; d=addD(d,7)){
      if(HOLIDAYS.has(c.loc+'|'+d)) continue;
      if(!c.dates.has(d) && locDates[c.loc].has(d)) gaps.push({loc:c.loc,grade:c.grade,section:c.section,date:d});
    }
  });
  return gaps;
}

// ---- sortable tables ----
function renderTable(el, cols, rows){
  const st = el._sort || {i:null,dir:1};
  if(st.i!=null){
    rows=[...rows].sort((a,b)=>{let x=a._raw?a._raw[st.i]:a[st.i],y=b._raw?b._raw[st.i]:b[st.i];
      if(typeof x==='number'&&typeof y==='number')return (x-y)*st.dir;
      return String(x).localeCompare(String(y))*st.dir;});
  }
  el.innerHTML='<thead><tr>'+cols.map((c,i)=>`<th class="${c.num?'num':''}" data-i="${i}">${c.t}${st.i===i?(st.dir>0?' ▲':' ▼'):''}</th>`).join('')+'</tr></thead>'+
    '<tbody>'+rows.map(r=>'<tr>'+r.map((v,i)=>`<td class="${cols[i].num?'num':''}">${v}</td>`).join('')+'</tr>').join('')+'</tbody>';
  el.querySelectorAll('th').forEach(th=>th.onclick=()=>{const i=+th.dataset.i;
    el._sort = (st.i===i)?{i,dir:-st.dir}:{i,dir:cols[i].num?-1:1};
    el._data(); });
}
function bindTable(el, builder){ el._data=()=>renderTable(el, ...builder()); }

function groupSum(rows,key,fields){
  const m={};
  rows.forEach(r=>{const k=key(r); if(!m[k])m[k]=Object.fromEntries(fields.map(f=>[f,0])); fields.forEach(f=>m[k][f]+=r[f]||0);});
  return m;
}
function qBadge(q){const c={Adequate:'p-green',Moderate:'p-amber',Low:'p-amber',None:'p-red'}[q]||'p-grey';return `<span class="pill ${c}">${q}</span>`;}

// =================== OVERVIEW ===================
function overview(){
  const reg=regF(),att=attF(),acc=accF();
  const active=reg.reduce((s,r)=>s+r.active,0), inact=reg.reduce((s,r)=>s+r.inactive,0);
  const P=att.reduce((s,a)=>s+a.P,0),A=att.reduce((s,a)=>s+a.A,0),T=att.reduce((s,a)=>s+a.T,0),E=att.reduce((s,a)=>s+a.E,0),M=att.reduce((s,a)=>s+a.M,0);
  const marked=P+A+T+E, present=pct(P,marked);
  const gaps=missF(); const entryRate=pct(att.length, att.length+gaps.length);
  const avgAcc = acc.length? Math.round(10*acc.reduce((s,a)=>s+a.hours,0)/acc.length)/10:0;
  document.getElementById('ovCards').innerHTML=[
    ['Active students',fmt(active),`${inact} inactive`],
    ['Locations',fmt(new Set(reg.map(r=>r.loc)).size),`${new Set(reg.map(r=>r.grade)).size} grades`],
    ['Present rate',present+'%',`${fmt(P)} present marks`],
    ['Missing sessions',fmt(gaps.length),`${entryRate}% entry rate`],
    ['Avg access hrs',avgAcc,`${fmt(acc.length)} people`],
    ['Sessions logged',fmt(att.length),`${new Set(att.map(a=>a.date)).size} class dates`],
  ].map(c=>`<div class="card"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');

  const byLoc=groupSum(reg,r=>r.loc,['active','inactive']);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b].active-byLoc[a].active);
  mk('ovRegLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[
    {label:'Active',data:locs.map(l=>byLoc[l].active),backgroundColor:C.accent},
    {label:'Inactive',data:locs.map(l=>byLoc[l].inactive),backgroundColor:C.line}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  mk('ovAtt',{type:'doughnut',data:{labels:['Present','Absent','Tardy','Excused','Unmarked'],datasets:[{data:[P,A,T,E,M],backgroundColor:[C.green,C.red,C.amber,C.teal,C.muted]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});

  bindTable(document.getElementById('ovTable'),()=>{
    const cols=[{t:'Location'},{t:'Active',num:1},{t:'Present %',num:1},{t:'Missing sessions',num:1},{t:'Avg access hrs',num:1}];
    const rmap=groupSum(reg,r=>r.loc,['active']);
    const amap=groupSum(att,a=>a.loc,['P','A','T','E']);
    const gapByLoc={}; gaps.forEach(g=>gapByLoc[g.loc]=(gapByLoc[g.loc]||0)+1);
    const accByLoc={}; acc.forEach(x=>{(accByLoc[x.loc]=accByLoc[x.loc]||[]).push(x.hours);});
    const rows=uniq(Object.keys(rmap)).map(l=>{
      const a=amap[l]||{P:0,A:0,T:0,E:0}; const mkd=a.P+a.A+a.T+a.E;
      const pr=pct(a.P,mkd), gp=gapByLoc[l]||0;
      const ah=accByLoc[l]?Math.round(10*accByLoc[l].reduce((s,v)=>s+v,0)/accByLoc[l].length)/10:0;
      const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
      const gpc=gp===0?'p-green':gp<=5?'p-amber':'p-red';
      const row=[l,(rmap[l].active),`<span class="pill ${prc}">${pr}%</span>`,`<span class="pill ${gpc}">${gp}</span>`,ah];
      row._raw=[l,rmap[l].active,pr,gp,ah]; return row;});
    return [cols,rows];
  });
  document.getElementById('ovTable')._data();
}

// =================== ACCESS ===================
function access(){
  const acc=accF();
  const qc={Adequate:0,Moderate:0,Low:0,None:0}; acc.forEach(a=>qc[a.q]++);
  const tot=acc.reduce((s,a)=>s+a.hours,0);
  const good=qc.Adequate+qc.Moderate;
  document.getElementById('acCards').innerHTML=[
    ['People tracked',fmt(acc.length),''],
    ['Avg access hrs',acc.length?Math.round(10*tot/acc.length)/10:0,`${fmt(Math.round(tot))} total hrs`],
    ['Adequate + Moderate',pct(good,acc.length)+'%',`${fmt(good)} people`],
    ['No access',qc.None,pct(qc.None,acc.length)+'% of people'],
  ].map(c=>`<div class="card"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');
  mk('acQ',{type:'doughnut',data:{labels:['Adequate','Moderate','Low','None'],datasets:[{data:[qc.Adequate,qc.Moderate,qc.Low,qc.None],backgroundColor:[C.green,C.teal,C.amber,C.red]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  const byLoc={}; acc.forEach(a=>{(byLoc[a.loc]=byLoc[a.loc]||[]).push(a.hours);});
  const locs=Object.keys(byLoc).sort();
  mk('acLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[{label:'Avg hrs',data:locs.map(l=>Math.round(10*byLoc[l].reduce((s,v)=>s+v,0)/byLoc[l].length)/10),backgroundColor:C.accent2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  bindTable(document.getElementById('acTable'),()=>{
    const cols=[{t:'Person'},{t:'Location'},{t:'Grade'},{t:'Access hrs',num:1},{t:'Quality'}];
    const rows=acc.map(a=>{const r=[a.person,a.loc,a.grade,a.hours,qBadge(a.q)];r._raw=[a.person,a.loc,a.grade,a.hours,a.q];return r;});
    return [cols,rows];
  });
  document.getElementById('acTable')._sort={i:3,dir:-1};
  document.getElementById('acTable')._data();
}

// =================== REGISTRATION ===================
function registration(){
  const reg=regF();
  const active=reg.reduce((s,r)=>s+r.active,0),inact=reg.reduce((s,r)=>s+r.inactive,0);
  document.getElementById('rgCards').innerHTML=[
    ['Active students',fmt(active),''],
    ['Inactive students',fmt(inact),pct(inact,active+inact)+'% of roster'],
    ['Classes',fmt(reg.length),`${new Set(reg.map(r=>r.loc)).size} locations`],
    ['Grades offered',new Set(reg.map(r=>r.grade)).size,''],
  ].map(c=>`<div class="card"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');
  const byCat=groupSum(reg,r=>r.cat,['active']);
  const cats=Object.keys(byCat).sort((a,b)=>byCat[b].active-byCat[a].active);
  mk('rgCat',{type:'bar',data:{labels:cats,datasets:[{label:'Active',data:cats.map(c=>byCat[c].active),backgroundColor:C.accent}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  const byLoc=groupSum(reg,r=>r.loc,['active','inactive']);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b].active-byLoc[a].active);
  mk('rgLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[
    {label:'Active',data:locs.map(l=>byLoc[l].active),backgroundColor:C.green},
    {label:'Inactive',data:locs.map(l=>byLoc[l].inactive),backgroundColor:C.red}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  bindTable(document.getElementById('rgTable'),()=>{
    const cols=[{t:'Location'},{t:'Category'},{t:'Grade'},{t:'Section'},{t:'Active',num:1},{t:'Inactive',num:1}];
    const rows=reg.map(r=>{const x=[r.loc,r.cat,r.grade,r.section||'—',r.active,r.inactive];return x;});
    return [cols,rows];
  });
  document.getElementById('rgTable')._sort={i:4,dir:-1};
  document.getElementById('rgTable')._data();
}

// =================== ATTENDANCE ===================
function attendance(){
  const att=attF();
  const P=att.reduce((s,a)=>s+a.P,0),A=att.reduce((s,a)=>s+a.A,0),T=att.reduce((s,a)=>s+a.T,0),E=att.reduce((s,a)=>s+a.E,0),M=att.reduce((s,a)=>s+a.M,0);
  const mkd=P+A+T+E;
  document.getElementById('atCards').innerHTML=[
    ['Present %',pct(P,mkd)+'%',`${fmt(P)} present`],
    ['Absent %',pct(A,mkd)+'%',`${fmt(A)} absent`],
    ['Tardy + Excused',fmt(T+E),`${pct(T+E,mkd)}% of marks`],
    ['Sessions',fmt(att.length),`${new Set(att.map(a=>a.date)).size} dates`],
  ].map(c=>`<div class="card"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');
  const byDate=groupSum(att,a=>a.date,['P','A','T','E']);
  const dates=Object.keys(byDate).sort();
  mk('atTrend',{type:'line',data:{labels:dates,datasets:[{label:'Present %',data:dates.map(d=>{const x=byDate[d];return pct(x.P,x.P+x.A+x.T+x.E);}),borderColor:C.green,backgroundColor:'rgba(53,194,142,.12)',fill:true,tension:.3,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100},x:{ticks:{maxTicksLimit:8}}},plugins:{legend:{display:false}}}});
  const byGr=groupSum(att,a=>a.grade,['P','A','T','E']);
  const grs=Object.keys(byGr).sort((a,b)=>{let ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  mk('atGrade',{type:'bar',data:{labels:grs,datasets:[{label:'Present %',data:grs.map(g=>{const x=byGr[g];return pct(x.P,x.P+x.A+x.T+x.E);}),backgroundColor:C.teal}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100}},plugins:{legend:{display:false}}}});
  bindTable(document.getElementById('atTable'),()=>{
    const cols=[{t:'Location'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
    const byLoc=groupSum(att,a=>a.loc,['P','A','T','E','M']);
    const rows=uniq(Object.keys(byLoc)).map(l=>{const x=byLoc[l];const m=x.P+x.A+x.T+x.E;const pr=pct(x.P,m);
      const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
      const r=[l,x.P,x.A,x.T,x.E,x.M,`<span class="pill ${prc}">${pr}%</span>`];r._raw=[l,x.P,x.A,x.T,x.E,x.M,pr];return r;});
    return [cols,rows];
  });
  document.getElementById('atTable')._sort={i:6,dir:-1};
  document.getElementById('atTable')._data();
}

// ---- entry matrix: classes (rows) × dates (cols) ----
function buildMatrix(att, gaps){
  const el=document.getElementById('msMatrix');
  const entered=new Set(att.map(a=>a.loc+'|'+a.grade+'|'+a.section+'|'+a.date));
  const missSet=new Set(gaps.map(g=>g.loc+'|'+g.grade+'|'+g.section+'|'+g.date));
  const classes={}; att.forEach(a=>{const k=a.loc+'|'+a.grade+'|'+a.section;
    (classes[k]=classes[k]||{loc:a.loc,grade:a.grade,section:a.section,dates:[]}).dates.push(a.date);});
  const clsList=Object.values(classes).sort((a,b)=>a.loc.localeCompare(b.loc)||
    (gradeOrder.indexOf(a.grade)-gradeOrder.indexOf(b.grade))||a.section.localeCompare(b.section));
  const dates=uniq(att.map(a=>a.date));
  if(!clsList.length){el.innerHTML='<div class="note">No classes match the current filter.</div>';return;}
  let seenMonth=null;
  const head=dates.map(d=>{const mo=d.slice(0,7);const isNew=mo!==seenMonth;seenMonth=mo;
    const lbl=d.slice(8,10); const cls=isNew?'mon':'';
    const mlabel=isNew?`<div style="font-size:9px;color:var(--muted)">${MONTHS[+d.slice(5,7)-1]}</div>`:'<div style="height:12px"></div>';
    return `<th class="${cls}">${mlabel}${lbl}</th>`;}).join('');
  const rows=clsList.map(c=>{
    c.dates.sort();
    seenMonth=null;
    const cells=dates.map(d=>{const mo=d.slice(0,7);const isNew=mo!==seenMonth;seenMonth=mo;const b=isNew?' mon':'';
      const key=c.loc+'|'+c.grade+'|'+c.section+'|'+d;
      const isHol=HOLIDAYS.has(c.loc+'|'+d);
      let dot='';
      if(entered.has(key)) dot='<span class="cd ok"></span>';
      else if(isHol) dot='<span class="cd hol" title="Holiday '+d+'"></span>';
      else if(missSet.has(key)) dot='<span class="cd miss" title="No attendance entered '+d+'"></span>';
      return `<td class="cell${b}">${dot}</td>`;}).join('');
    const missCount=dates.filter(d=>missSet.has(c.loc+'|'+c.grade+'|'+c.section+'|'+d)).length;
    const lbl=`${c.loc.replace(' REC','')} · ${c.grade}${c.section?'-'+c.section:''}`+(missCount?` <span class="pill p-red" style="padding:0 6px">${missCount}</span>`:'');
    return `<tr><td class="rowlbl">${lbl}</td>${cells}</tr>`;
  }).join('');
  el.innerHTML=`<table class="mx"><thead><tr><th class="rowlbl corner">Class (${clsList.length}) · date →</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// =================== MISSING ATTENDANCE ENTRY ===================
function missing(){
  const gaps=missF();
  const att=attF();
  const recorded=att.length, expected=recorded+gaps.length;
  const affClasses=new Set(gaps.map(g=>g.loc+'|'+g.grade+'|'+g.section)).size;
  const affLocs=new Set(gaps.map(g=>g.loc)).size;
  document.getElementById('msCards').innerHTML=[
    ['Missing sessions',fmt(gaps.length),'date/class combos with no entry'],
    ['Entry rate',pct(recorded,expected)+'%',`${fmt(recorded)} of ${fmt(expected)} expected`],
    ['Classes affected',fmt(affClasses),'have ≥1 missing session'],
    ['Locations affected',fmt(affLocs),'with missing entries'],
  ].map(c=>`<div class="card"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');

  buildMatrix(att, gaps);

  const byLoc={}; gaps.forEach(g=>byLoc[g.loc]=(byLoc[g.loc]||0)+1);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b]-byLoc[a]);
  mk('msLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[{label:'Missing sessions',data:locs.map(l=>byLoc[l]),backgroundColor:C.amber}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});

  bindTable(document.getElementById('msGap'),()=>{
    const cols=[{t:'Location'},{t:'Grade'},{t:'Section'},{t:'Missing',num:1}];
    const cm={}; gaps.forEach(g=>{const k=g.loc+'|'+g.grade+'|'+g.section;cm[k]=(cm[k]||0)+1;});
    const rows=Object.keys(cm).map(k=>{const p=k.split('|');return [p[0],p[1],p[2]||'—',cm[k]];});
    if(!rows.length)return[cols,[['—','—','—','—']]];
    return [cols,rows];
  });
  document.getElementById('msGap')._sort={i:3,dir:-1};
  document.getElementById('msGap')._data();

  bindTable(document.getElementById('msTable'),()=>{
    const cols=[{t:'Location'},{t:'Grade'},{t:'Section'},{t:'Date (no attendance entered)'},{t:'Status'}];
    const rows=gaps.map(g=>{const r=[g.loc,g.grade,g.section||'—',g.date,'<span class="pill p-red">No entry</span>'];r._raw=[g.loc,g.grade,g.section,g.date,g.date];return r;});
    if(!rows.length)return[cols,[['—','—','—','No missing sessions','<span class="pill p-green">All entered</span>']]];
    return [cols,rows];
  });
  document.getElementById('msTable')._sort={i:3,dir:1};
  document.getElementById('msTable')._data();
}

// ---- routing ----
const pages={overview,access,registration,attendance,missing};
let current='overview';
function render(){ pages[current](); }
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); document.getElementById('p-'+t.dataset.p).classList.add('active');
  current=t.dataset.p; render();
});
fLoc.onchange=()=>{state.loc=fLoc.value; render();};
fGrade.onchange=()=>{state.grade=fGrade.value; render();};
document.getElementById('reset').onclick=()=>{state.loc='ALL';state.grade='ALL';fLoc.value='ALL';fGrade.value='ALL';render();};

// ---- data loading (region / year aware) ----
const fRegion=document.getElementById('fRegion'), fYear=document.getElementById('fYear');
let CAT={regions:[],years:{},files:{}};
const sel={region:null, year:null};

function fillSelect(el,vals){const cur=el.value;el.innerHTML='<option value="ALL">All</option>'+vals.map(v=>`<option>${v}</option>`).join('');el.value=[...el.options].some(o=>o.value===cur)?cur:'ALL';}

function fillPlain(el,vals,current){
  el.innerHTML=vals.map(v=>`<option>${v}</option>`).join('');
  el.value=vals.includes(current)?current:(vals[0]||'');
}

function populateRegionYear(){
  fillPlain(fRegion, CAT.regions, sel.region);
  if(!CAT.regions.includes(sel.region)) sel.region=CAT.regions[0]||null;
  fRegion.value=sel.region||'';
  const years=CAT.years[sel.region]||[];
  fillPlain(fYear, years, sel.year);
  if(!years.includes(sel.year)) sel.year=years[0]||null;
  fYear.value=sel.year||'';
}

function setStatus(meta){
  const el=document.getElementById('status');
  if(!meta){el.textContent='';return;}
  const order=['access','registration','attendance','holidays'];
  const parts=order.filter(k=>meta.files&&meta.files[k]).map(k=>`<b>${k}</b> ${fmt(meta.files[k].rows)}`);
  const ds=(meta.region?`<b>${meta.region}</b> · <b>${meta.year}</b> — `:'');
  el.innerHTML=ds+(parts.length?('rows: '+parts.join(' · ')):'no report files in this dataset')+
    (meta.generated?` · loaded ${meta.generated.replace('T',' ')}`:'');
}

function showBanner(msg,isErr){
  const b=document.getElementById('banner');
  if(!msg){b.style.display='none';return;}
  b.className='banner'+(isErr?' err':''); b.innerHTML=msg; b.style.display='block';
}

async function loadData(){
  const btn=document.getElementById('refresh');
  btn.disabled=true; btn.textContent='↻ Loading…';
  try{
    const qs=(sel.region&&sel.year)?`?region=${encodeURIComponent(sel.region)}&year=${encodeURIComponent(sel.year)}`:'';
    const res=await fetch('/api/data'+qs,{cache:'no-store'});
    if(!res.ok) throw new Error('server returned '+res.status);
    const payload=await res.json();
    if(payload.error) throw new Error(payload.error);
    const meta=payload.meta||{};
    CAT=meta.catalog||{regions:[],years:{},files:{}};
    if(meta.region) sel.region=meta.region;
    if(meta.year) sel.year=meta.year;
    populateRegionYear();

    DATA={access:payload.access||[],registration:payload.registration||[],
          attendance:payload.attendance||[],holidays:payload.holidays||[]};
    HOLIDAYS=new Set(DATA.holidays);
    MISSING=computeMissing();
    const allLoc=uniq([...DATA.registration.map(r=>r.loc),...DATA.attendance.map(a=>a.loc),...DATA.access.map(a=>a.loc)].filter(Boolean));
    const allGrade=uniq([...DATA.registration.map(r=>r.grade),...DATA.attendance.map(a=>a.grade),...DATA.access.map(a=>a.grade)].filter(Boolean))
      .sort((a,b)=>{let ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
    fillSelect(fLoc,allLoc); fillSelect(fGrade,allGrade);
    state.loc=fLoc.value; state.grade=fGrade.value;
    setStatus(meta);

    const present=['access','registration','attendance'].filter(k=>meta.files&&meta.files[k]);
    const miss=['access','registration','attendance'].filter(k=>!(meta.files&&meta.files[k]));
    if(!CAT.regions.length){
      showBanner('No datasets found. Organise exports as <b>data/&lt;region&gt;/&lt;year&gt;/*.csv</b> (e.g. data/central/2025-2026/), then click Refresh.',true);
    } else if(!present.length){
      showBanner('No report files found for <b>'+sel.region+' · '+sel.year+'</b>. Add the exports to that folder and Refresh.',true);
    } else if(miss.length){
      showBanner('This dataset is missing: <b>'+miss.join(', ')+'</b>. Those reports will be empty until you add the export to data/'+sel.region+'/'+sel.year+'/.',false);
    } else {
      showBanner('');
    }
    render();
  }catch(e){
    showBanner('Could not load data: '+e.message+'. Make sure you opened this page via <b>python3 serve.py</b> (not by double-clicking the HTML file).',true);
  }finally{
    btn.disabled=false; btn.textContent='↻ Refresh';
  }
}

fRegion.onchange=()=>{ sel.region=fRegion.value; const ys=CAT.years[sel.region]||[]; sel.year=ys[0]||null; loadData(); };
fYear.onchange=()=>{ sel.year=fYear.value; loadData(); };
document.getElementById('refresh').onclick=loadData;
loadData();
