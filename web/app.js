// REC Reporting Dashboard — front-end.
// Data is fetched from the local server (/api/data), which scans the data/
// folder on every request. Refreshing the page (or the Refresh button) rebuilds
// every report from whatever CSVs are currently in data/.

function cssVar(name, fallback){
  const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v||fallback;
}
function themeColors(){
  return {
    green:cssVar('--green','#35c28e'),
    amber:cssVar('--amber','#f5b74e'),
    red:cssVar('--red','#ef5a6f'),
    teal:cssVar('--teal','#3fb8c4'),
    accent:cssVar('--accent','#4f8cff'),
    accent2:cssVar('--accent2','#7c5cff'),
    muted:cssVar('--muted','#9aa2b1'),
    line:cssVar('--line','#2a2f3d'),
    txt:cssVar('--txt','#e6e8ee'),
    chartLabel:cssVar('--chart-label','#c5cbd6'),
    chartLabelOn:cssVar('--chart-label-on','rgba(255,255,255,.92)'),
    chartFill:cssVar('--chart-fill','rgba(53,194,142,.12)'),
  };
}
let C = themeColors();
function chartLibOk(){ return typeof Chart!=='undefined'&&typeof Chart.prototype!=='undefined'; }
function applyChartTheme(){
  if(!chartLibOk()) return;
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.line;
  Chart.defaults.font.family='inherit';
}
applyChartTheme();

const THEME_KEY='recDashboardTheme';
function currentTheme(){ return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark'; }
function applyTheme(theme){
  if(theme==='light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  try{ localStorage.setItem(THEME_KEY, theme==='light'?'light':'dark'); }catch(_){}
  C=themeColors();
  applyChartTheme();
  const btn=document.getElementById('themeToggle');
  if(btn) btn.textContent=theme==='light'?'☾ Dark':'☀ Light';
}
(function initTheme(){
  let t='light';
  try{ t=localStorage.getItem(THEME_KEY)||'light'; }catch(_){}
  applyTheme(t==='dark'?'dark':'light');
})();
document.getElementById('themeToggle').onclick=()=>{
  applyTheme(currentTheme()==='light'?'dark':'light');
  if(typeof render==='function') render();
};

const charts = {};
// Draw values on bars, stacked segments, doughnut slices, and line points.
const valueLabels={
  id:'valueLabels',
  afterDatasetsDraw(chart){
    try{
    const cfg=chart.options.plugins&&chart.options.plugins.valueLabels;
    if(cfg===false) return;
    const format=(typeof cfg==='object'&&typeof cfg.format==='function')
      ? cfg.format
      : (v=> (typeof v==='number' && !Number.isInteger(v) ? String(v) : fmt(v)));
    const {ctx}=chart; ctx.save();
    const type=chart.config.type;
    const horiz=chart.options.indexAxis==='y';
    const stacked=!!(chart.options.scales&&((chart.options.scales.x&&chart.options.scales.x.stacked)||(chart.options.scales.y&&chart.options.scales.y.stacked)));
    chart.data.datasets.forEach((ds,di)=>{
      const meta=chart.getDatasetMeta(di); if(meta.hidden) return;
      meta.data.forEach((el,i)=>{
        if(!el||typeof el.tooltipPosition!=='function') return;
        const v=ds.data[i]; if(v==null||v===''||v===0) return;
        const label=format(v);
        ctx.shadowColor='transparent'; ctx.shadowBlur=0;
        if(type==='doughnut'||type==='pie'){
          const pos=el.tooltipPosition();
          ctx.font='600 11px system-ui,sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillStyle=C.chartLabelOn;
          ctx.shadowColor='rgba(0,0,0,.25)'; ctx.shadowBlur=2;
          ctx.fillText(label, pos.x, pos.y);
          return;
        }
        if(type==='line'){
          const n=ds.data.length;
          if(n>24 && i%Math.ceil(n/16)) return; // thin out dense trends
          const pos=el.tooltipPosition();
          ctx.font='600 10px system-ui,sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='bottom';
          ctx.fillStyle=C.chartLabel;
          ctx.fillText(label, pos.x, pos.y-6);
          return;
        }
        // bar
        ctx.font='600 11px system-ui,sans-serif';
        if(stacked){
          ctx.fillStyle=C.chartLabelOn;
          ctx.shadowColor='rgba(0,0,0,.22)'; ctx.shadowBlur=2;
          if(horiz){
            const mid=(el.base+el.x)/2;
            if(Math.abs(el.x-el.base)<22) return;
            ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText(label, mid, el.y);
          } else {
            const mid=(el.base+el.y)/2;
            if(Math.abs(el.y-el.base)<14) return;
            ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText(label, el.x, mid);
          }
        } else if(horiz){
          const pos=el.tooltipPosition();
          ctx.fillStyle=C.chartLabel;
          ctx.textAlign='left'; ctx.textBaseline='middle';
          ctx.fillText(label, pos.x+6, pos.y);
        } else {
          const pos=el.tooltipPosition();
          ctx.fillStyle=C.chartLabel;
          ctx.textAlign='center'; ctx.textBaseline='bottom';
          ctx.fillText(label, pos.x, pos.y-6);
        }
      });
    });
    ctx.restore();
    }catch(_){ /* never break chart draw */ }
  }
};
function setChartboxMessage(id, msg){
  const canvas=document.getElementById(id);
  if(!canvas) return;
  const box=canvas.closest('.chartbox');
  if(!box) return;
  let el=box.querySelector('.chart-empty');
  if(msg){
    if(!el){ el=document.createElement('div'); el.className='chart-empty'; box.appendChild(el); }
    el.textContent=msg;
    canvas.style.visibility='hidden';
  }else{
    if(el) el.remove();
    canvas.style.visibility='';
  }
}
function queueChartResize(chart){
  if(!chart) return;
  requestAnimationFrame(()=>{
    try{ chart.resize(); }catch(_){}
    requestAnimationFrame(()=>{ try{ chart.resize(); }catch(_){} });
  });
}
function resizeVisibleCharts(){
  Object.values(charts).forEach(ch=>{
    try{ ch.resize(); }catch(_){}
  });
}
function mk(id,cfg){
  if(!chartLibOk()){
    setChartboxMessage(id, 'Chart library failed to load. Hard-refresh the page or check that chart.umd.min.js is served.');
    return;
  }
  const canvas=document.getElementById(id);
  if(!canvas) return;
  if(charts[id]){ try{ charts[id].destroy(); }catch(_){ } delete charts[id]; }
  const labels=cfg.data&&cfg.data.labels;
  const emptyDs=!(cfg.data&&cfg.data.datasets&&cfg.data.datasets.some(ds=>(ds.data||[]).length));
  if((Array.isArray(labels)&&!labels.length)||emptyDs){
    setChartboxMessage(id, cfg._emptyMsg||'No data for the current filters.');
    return;
  }
  setChartboxMessage(id, null);
  const chartCfg=Object.assign({}, cfg);
  delete chartCfg._emptyMsg;
  const type=chartCfg.type;
  const horiz=chartCfg.options&&chartCfg.options.indexAxis==='y';
  const opts=chartCfg.options||(chartCfg.options={});
  opts.layout=opts.layout||{};
  opts.layout.padding=Object.assign(
    type==='bar'&&!horiz?{top:18}:{},
    type==='bar'&&horiz?{right:40}:{},
    type==='line'?{top:16}:{},
    opts.layout.padding||{}
  );
  opts.plugins=opts.plugins||{};
  if(opts.plugins.valueLabels===undefined) opts.plugins.valueLabels=true;
  const plugins=[...(chartCfg.plugins||[]), valueLabels];
  try{
    charts[id]=new Chart(canvas, Object.assign({}, chartCfg, {plugins}));
    queueChartResize(charts[id]);
  }catch(e){
    setChartboxMessage(id, 'Could not render chart: '+e.message);
  }
}
function scheduleCmpChartResize(){
  requestAnimationFrame(resizeVisibleCharts);
}
const fmt = n => (n||0).toLocaleString();
const pct = (a,b)=> b?Math.round(1000*a/b)/10:0;
const uniq = (arr)=>[...new Set(arr)].sort();
const pctLabel = v => v+'%';
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const gradeOrder=['PK','KG','01','02','03','04','05','06','07','08','09','10','11','12','Optional'];
const catOrder=['Pre-Primary','Primary','STEP (7-10)','STEP (11-12)'];
const GRADE_LEVELS=[
  {id:'Pre-Primary', grades:['PK','KG']},
  {id:'Primary', grades:['01','02','03','04','05','06']},
  {id:'STEP (7-10)', grades:['07','08','09','10']},
  {id:'STEP (11-12)', grades:['11','12']},
];
const gradeToLevel=Object.fromEntries(GRADE_LEVELS.flatMap(l=>l.grades.map(g=>[g,l.id])));
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// Hardcoded gate for the Access detail-by-person table (personal info).
const ACCESS_DETAIL_PASSWORD='rec-access';
const ACCESS_DETAIL_KEY='recAccessDetailUnlocked';
const ATTENDANCE_DETAIL_PASSWORD='rec-access';
const ATTENDANCE_DETAIL_KEY='recAttDetailUnlocked';

function gradeLevelOf(g){ return gradeToLevel[g]||null; }
// Map CSV categories / grades onto Pre-Primary, Primary, STEP (7-10), STEP (11-12).
function displayCat(r){
  return gradeLevelOf(r.grade) || (r.cat==='Secondary' ? 'STEP (7-10)' : (r.cat||''));
}
function sortCats(a,b){
  const ia=catOrder.indexOf(a), ib=catOrder.indexOf(b);
  return (ia<0?99:ia)-(ib<0?99:ib) || String(a).localeCompare(String(b));
}

// ---- module state, (re)assigned on every data load ----
let DATA={access:[],registration:[],attendance:[],holidays:[],students:[],studentAttendance:[],studentAttendanceRecords:[],duplicates:{available:false,students:0,extraEnrollments:0,uniqueStudents:0,details:[]}};
let DATA_PREV=null; // prior-year dataset for the same region, or null
let HOLIDAYS=new Set(), MISSING=[];
let MISSING_PREV=[];
let PREV_YEAR=null;
let ALL_GRADES=[];
let STUDENT_RECORDS={};
let SESSION={restricted:new Set(), byKey:new Map(), patterns:[]};
const state={loc:'ALL', level:'ALL', grade:'ALL', matrix:null};
const attDetailState={loc:'ALL', grade:'ALL'};

const fLoc=document.getElementById('fLoc'), fLevel=document.getElementById('fLevel'), fGrade=document.getElementById('fGrade');
const fAtDetLoc=document.getElementById('fAtDetLoc'), fAtDetGrade=document.getElementById('fAtDetGrade');

function isExcludedLoc(l){
  const n=String(l||'').trim().toLowerCase();
  return n.includes('ntx virtual');
}
function fLocOk(l){return !isExcludedLoc(l)&&(state.loc==='ALL'||l===state.loc);}
function fLevelOk(g){return state.level==='ALL'||gradeLevelOf(g)===state.level;}
function fGrOk(g){return fLevelOk(g)&&(state.grade==='ALL'||g===state.grade);}
function scrubData(d){
  if(!d) return d;
  const drop=r=>r&&!isExcludedLoc(r.loc);
  return {
    ...d,
    access:(d.access||[]).filter(drop),
    registration:(d.registration||[]).filter(drop),
    attendance:(d.attendance||[]).filter(drop),
    students:(d.students||[]).filter(drop),
    studentAttendance:(d.studentAttendance||[]).filter(drop),
    studentAttendanceRecords:(d.studentAttendanceRecords||[]).filter(drop),
    holidays:(d.holidays||[]).filter(h=>!isExcludedLoc(String(h).split('|')[0])),
    duplicates:(()=>{
      const dup=d.duplicates||{available:false,details:[]};
      if(!dup.available) return dup;
      const details=(dup.details||[]).filter(x=>!(x.locs||[]).some(isExcludedLoc))
        .map(x=>({...x, locs:(x.locs||[]).filter(l=>!isExcludedLoc(l))}));
      return {...dup, details, students:details.length,
        extraEnrollments:details.reduce((s,x)=>s+Math.max(0,(x.count||0)-1),0)};
    })(),
  };
}
function accF(){return DATA.access.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade));}
function regF(){return DATA.registration.filter(r=>fLocOk(r.loc)&&fGrOk(r.grade));}
function attF(){return DATA.attendance.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade));}
function missF(){return MISSING.filter(g=>fLocOk(g.loc)&&fGrOk(g.grade));}
function accPrev(){return DATA_PREV?DATA_PREV.access.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade)):[];}
function regPrev(){return DATA_PREV?DATA_PREV.registration.filter(r=>fLocOk(r.loc)&&fGrOk(r.grade)):[];}
function attPrev(){return DATA_PREV?DATA_PREV.attendance.filter(a=>fLocOk(a.loc)&&fGrOk(a.grade)):[];}
function missPrev(){return MISSING_PREV.filter(g=>fLocOk(g.loc)&&fGrOk(g.grade));}
function dupStats(src){
  const d=src&&src.duplicates; if(!d||!d.available) return null;
  let details=d.details||[];
  if(state.loc!=='ALL'||state.level!=='ALL'||state.grade!=='ALL'){
    details=details.filter(x=>{
      const locOk=state.loc==='ALL'||(x.locs||[]).includes(state.loc);
      const grOk=(x.grades||[]).some(g=>fGrOk(g));
      return locOk&&grOk;
    });
    return {
      available:true,
      students:details.length,
      extraEnrollments:details.reduce((s,x)=>s+x.count-1,0),
      uniqueStudents:null,
      details,
    };
  }
  return {available:true,students:d.students||0,extraEnrollments:d.extraEnrollments||0,uniqueStudents:d.uniqueStudents||0,details};
}
function dupF(){ return dupStats(DATA); }
function dupPrev(){ return DATA_PREV?dupStats(DATA_PREV):null; }

function initSessionSchedule(entries){
  SESSION={restricted:new Set(), byKey:new Map(), patterns:[]};
  (entries||[]).forEach(e=>{
    if(!e||!e.pattern||!e.grade||!e.date) return;
    const key=e.pattern+'|'+e.grade;
    SESSION.restricted.add(key);
    if(!SESSION.byKey.has(key)) SESSION.byKey.set(key,new Set());
    SESSION.byKey.get(key).add(e.date);
    if(!SESSION.patterns.includes(e.pattern)) SESSION.patterns.push(e.pattern);
  });
  SESSION.patterns.sort((a,b)=>b.length-a.length);
}
function locSessionPattern(loc){
  const l=String(loc||'').toLowerCase();
  for(const p of SESSION.patterns){
    if(l.includes(p.toLowerCase())) return p;
  }
  return null;
}
function sessionSchedKey(loc, grade){
  const p=locSessionPattern(loc);
  return p?p+'|'+grade:null;
}
function hasSessionSchedule(loc, grade){
  const k=sessionSchedKey(loc, grade);
  return !!(k&&SESSION.restricted.has(k));
}
/** @returns {true|false|null} null = weekly schedule applies */
function isSessionScheduledDay(loc, grade, date){
  const k=sessionSchedKey(loc, grade);
  if(!k||!SESSION.restricted.has(k)) return null;
  return SESSION.byKey.get(k)?.has(date)??false;
}
function expectedSessionDates(loc, grade){
  const k=sessionSchedKey(loc, grade);
  if(!k||!SESSION.restricted.has(k)) return [];
  return [...(SESSION.byKey.get(k)||[])].sort();
}

function classKey(r){ return (r.loc||'')+'|'+(r.grade||'')+'|'+(r.section||''); }
function atDetLocOk(l){ return attDetailState.loc==='ALL'||l===attDetailState.loc; }
function atDetGrOk(g){ return attDetailState.grade==='ALL'||g===attDetailState.grade; }
function studentsDetF(){
  return (DATA.students||[]).filter(s=>atDetLocOk(s.loc)&&atDetGrOk(s.grade));
}
function buildClassAttStats(att, gaps){
  const m={};
  att.forEach(a=>{
    const k=classKey(a);
    if(!m[k]) m[k]={P:0,A:0,T:0,E:0,M:0,entries:0,missing:0};
    m[k].P+=a.P; m[k].A+=a.A; m[k].T+=a.T; m[k].E+=a.E; m[k].M+=a.M;
    m[k].entries++;
  });
  gaps.forEach(g=>{
    const k=classKey(g);
    if(!m[k]) m[k]={P:0,A:0,T:0,E:0,M:0,entries:0,missing:0};
    m[k].missing++;
  });
  return m;
}
function indexStudentRecords(){
  STUDENT_RECORDS={};
  (DATA.studentAttendanceRecords||[]).forEach(r=>{
    (STUDENT_RECORDS[r.id]=STUDENT_RECORDS[r.id]||[]).push({date:r.date, mark:r.mark});
  });
  Object.values(STUDENT_RECORDS).forEach(arr=>arr.sort((a,b)=>String(a.date).localeCompare(String(b.date))));
}
function stuLink(student){
  const name=student.name||student.id;
  return `<button type="button" class="stu-link" data-stu-id="${esc(student.id)}">${esc(name)}</button>`;
}
function markBadge(m){
  const labels={P:['Present','p-green'],A:['Absent','p-red'],T:['Tardy','p-amber'],E:['Excused','p-teal'],M:['Unmarked','p-grey']};
  const pair=labels[m]||[m,'p-grey'];
  return `<span class="pill ${pair[1]}">${pair[0]}</span>`;
}
function closeAttStudentModal(){
  const modal=document.getElementById('atStuModal');
  if(modal) modal.hidden=true;
}
function showStudentAttModal(studentId){
  const student=(DATA.students||[]).find(s=>s.id===studentId);
  if(!student) return;
  const modal=document.getElementById('atStuModal');
  const title=document.getElementById('atStuModalTitle');
  const note=document.getElementById('atStuModalNote');
  const locLabel=(student.loc||'').replace(' REC','');
  const sec=student.section?('-'+student.section):'';
  if(title) title.textContent=(student.name||student.id)+' · '+student.grade+sec+' · '+locLabel;
  const records=STUDENT_RECORDS[studentId]||[];
  if(records.length){
    if(note) note.textContent='Individual attendance marks for this student. Sorted by date.';
    bindTable(document.getElementById('atStuModalTable'),()=>{
      const cols=[{t:'Date'},{t:'Mark'}];
      const rows=records.map(r=>{
        const row=[r.date, markBadge(r.mark)];
        row._raw=[r.date,r.mark];
        return row;
      });
      return [cols,rows];
    });
  } else {
    if(note) note.textContent='Individual marks are not in the export. Showing class session records for this student\'s section (same for every student in the class).';
    const ck=classKey(student);
    const attRows=attF().filter(a=>classKey(a)===ck);
    const attByDate={};
    attRows.forEach(a=>{ attByDate[a.date]=a; });
    const missDates=new Set(missF().filter(g=>classKey(g)===ck).map(g=>g.date));
    const holDates=new Set([...HOLIDAYS].filter(h=>h.startsWith(student.loc+'|')).map(h=>h.slice(student.loc.length+1)));
    const dates=hasSessionSchedule(student.loc, student.grade)
      ? expectedSessionDates(student.loc, student.grade)
      : uniq([...attRows.map(a=>a.date), ...missDates]).sort();
    bindTable(document.getElementById('atStuModalTable'),()=>{
      const cols=[{t:'Date'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Session'}];
      const rows=dates.map(d=>{
        if(holDates.has(d)){
          const row=[d,'—','—','—','—','—','<span class="pill p-amber">Holiday</span>'];
          row._raw=[d,0,0,0,0,0,0]; return row;
        }
        if(missDates.has(d)){
          const row=[d,'—','—','—','—','—','<span class="pill p-red">No entry</span>'];
          row._raw=[d,0,0,0,0,0,0]; return row;
        }
        const a=attByDate[d];
        const mkd=a.P+a.A+a.T+a.E;
        const pr=pct(a.P,mkd);
        const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
        const row=[d,a.P,a.A,a.T,a.E,a.M,`<span class="pill ${prc}">Entered · ${pr}% class</span>`];
        row._raw=[d,a.P,a.A,a.T,a.E,a.M,pr];
        return row;
      });
      if(!rows.length) return [cols,[['—','—','—','—','—','—','No class sessions in filter']]];
      return [cols,rows];
    });
  }
  document.getElementById('atStuModalTable')._sort={i:0,dir:1};
  document.getElementById('atStuModalTable')._data();
  if(modal) modal.hidden=false;
}
function populateAttDetailFilters(){
  if(!fAtDetLoc||!fAtDetGrade) return;
  const locs=uniq((DATA.students||[]).map(s=>s.loc).filter(Boolean)).sort();
  const grades=uniq((DATA.students||[]).map(s=>s.grade).filter(Boolean))
    .sort((a,b)=>{let ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  fAtDetLoc.innerHTML='<option value="ALL">All</option>'+locs.map(v=>`<option>${v}</option>`).join('');
  fAtDetGrade.innerHTML='<option value="ALL">All</option>'+grades.map(v=>`<option>${v}</option>`).join('');
  fAtDetLoc.value=attDetailState.loc==='ALL'||locs.includes(attDetailState.loc)?attDetailState.loc:'ALL';
  fAtDetGrade.value=attDetailState.grade==='ALL'||grades.includes(attDetailState.grade)?attDetailState.grade:'ALL';
  attDetailState.loc=fAtDetLoc.value;
  attDetailState.grade=fAtDetGrade.value;
}
function renderAttStudentTable(){
  const hasMarks=(DATA.studentAttendance||[]).length>0;
  const noteEl=document.getElementById('atDetailNote');
  if(!(DATA.students||[]).length){
    if(noteEl) noteEl.textContent='No student roster found. Add the contact information export to data/<region>/<year>/.';
    bindTable(document.getElementById('atStudentTable'),()=>{
      const cols=[{t:'Person'},{t:'Center'},{t:'Grade'},{t:'Section'}];
      return [cols,[['—','—','—','Add the contact export to enable this table']]];
    });
    document.getElementById('atStudentTable')._data();
    return;
  }
  if(noteEl){
    noteEl.textContent=hasMarks
      ? 'Individual attendance marks from the student attendance detail export. Click a name to view records by date.'
      : 'Individual student marks are not in the daily attendance export. Class totals are shown below; click a name to view class session records for that student\'s section.';
  }
  const markById={};
  (DATA.studentAttendance||[]).forEach(r=>{ markById[r.id]=r; });
  const classStats=buildClassAttStats(attF(), missF());
  const students=studentsDetF();
  bindTable(document.getElementById('atStudentTable'),()=>{
    if(hasMarks){
      const cols=[{t:'Person'},{t:'Center'},{t:'Grade'},{t:'Section'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
      const rows=students.map(s=>{
        const m=markById[s.id]||{P:0,A:0,T:0,E:0,M:0};
        const mkd=m.P+m.A+m.T+m.E;
        const pr=pct(m.P,mkd);
        const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
        const r=[stuLink(s),s.loc,s.grade,s.section||'—',m.P,m.A,m.T,m.E,m.M,`<span class="pill ${prc}">${pr}%</span>`];
        r._raw=[s.name,s.loc,s.grade,s.section,m.P,m.A,m.T,m.E,m.M,pr];
        return r;
      });
      if(!rows.length) return [cols,[['—','—','—','—','—','—','—','—','—','No students match filter']]];
      return [cols,rows];
    }
    const cols=[{t:'Person'},{t:'Center'},{t:'Grade'},{t:'Section'},{t:'Entries logged',num:1},{t:'Missing entries',num:1},{t:'Class present %',num:1}];
    const rows=students.map(s=>{
      const cs=classStats[classKey(s)]||{entries:0,missing:0,P:0,A:0,T:0,E:0,M:0};
      const mkd=cs.P+cs.A+cs.T+cs.E;
      const pr=pct(cs.P,mkd);
      const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
      const gpc=cs.missing===0?'p-green':cs.missing<=5?'p-amber':'p-red';
      const r=[stuLink(s),s.loc,s.grade,s.section||'—',cs.entries,`<span class="pill ${gpc}">${cs.missing}</span>`,`<span class="pill ${prc}">${pr}%</span>`];
      r._raw=[s.name,s.loc,s.grade,s.section,cs.entries,cs.missing,pr];
      return r;
    });
    if(!rows.length) return [cols,[['—','—','—','—','—','—','No students match filter']]];
    return [cols,rows];
  });
  const sortCol=hasMarks?9:6;
  document.getElementById('atStudentTable')._sort={i:sortCol,dir:-1};
  document.getElementById('atStudentTable')._data();
}

// ---- Missing attendance = date/class combos with NO attendance entered ----
// A class is "missing" a date when the center was in session that day (another
// class recorded), it is not a holiday, and either:
//   (a) the class has some entries but skipped this date within its active window, or
//   (b) the class is on the registration roster (active students) but never entered
//       attendance at all — then every in-session date at that center is missing.
function computeMissing(attendance, holidaySet, registration){
  const addD=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const locDates={}; attendance.forEach(a=>{(locDates[a.loc]=locDates[a.loc]||new Set()).add(a.date);});
  const cls={}; attendance.forEach(a=>{const k=a.loc+'|'+a.grade+'|'+a.section;
    (cls[k]=cls[k]||{loc:a.loc,grade:a.grade,section:a.section,dates:new Set()}).dates.add(a.date);});
  const gaps=[];
  Object.values(cls).forEach(c=>{
    if(hasSessionSchedule(c.loc, c.grade)){
      expectedSessionDates(c.loc, c.grade).forEach(d=>{
        if(holidaySet.has(c.loc+'|'+d)) return;
        if(!c.dates.has(d)) gaps.push({loc:c.loc,grade:c.grade,section:c.section,date:d});
      });
      return;
    }
    const cd=[...c.dates].sort(); const mn=cd[0],mx=cd[cd.length-1];
    if(!mn) return;
    for(let d=mn; d<=mx; d=addD(d,7)){
      if(holidaySet.has(c.loc+'|'+d)) continue;
      if(!c.dates.has(d) && locDates[c.loc]&&locDates[c.loc].has(d)) gaps.push({loc:c.loc,grade:c.grade,section:c.section,date:d});
    }
  });
  // Registered active classes with zero attendance entries
  (registration||[]).forEach(r=>{
    if(!(r.active>0)) return;
    const k=r.loc+'|'+(r.grade||'')+'|'+(r.section||'');
    if(cls[k]) return; // already covered above
    const grade=r.grade||'';
    if(hasSessionSchedule(r.loc, grade)){
      expectedSessionDates(r.loc, grade).forEach(d=>{
        if(holidaySet.has(r.loc+'|'+d)) return;
        gaps.push({loc:r.loc,grade,section:r.section||'',date:d});
      });
      return;
    }
    const dates=locDates[r.loc];
    if(!dates||!dates.size) return;
    [...dates].sort().forEach(d=>{
      if(holidaySet.has(r.loc+'|'+d)) return;
      gaps.push({loc:r.loc,grade,section:r.section||'',date:d});
    });
  });
  const today=todayLocalISO();
  return gaps.filter(g=>normDate(g.date)<=today);
}

// KPI cards with optional prior-year comparison line
function hasPrevYear(){ return !!(PREV_YEAR && DATA_PREV); }
function yoyLine(prevN, curN, opts={}){
  if(!hasPrevYear() || prevN==null || prevN===undefined) return '';
  const asPct=!!opts.pct, dec=!!opts.dec, lower=!!opts.lowerIsBetter;
  const show=asPct?(prevN+'%'):(dec?prevN:fmt(prevN));
  let delta='';
  if(typeof curN==='number' && typeof prevN==='number'){
    const raw=curN-prevN;
    const d=asPct||dec?Math.round(raw*10)/10:Math.round(raw);
    if(d!==0){
      const good=lower?d<0:d>0;
      const cls=good?'yoy-up':'yoy-down';
      const sign=d>0?'+':'';
      delta=` <span class="${cls}">${sign}${asPct?d+'%':(dec?d:fmt(d))}</span>`;
    }
  }
  return `<div class="yoy">${show} in ${PREV_YEAR}${delta}</div>`;
}
function renderCards(el, cards){
  // each: [label, valueHtml, detail, prevN, curN, opts?]
  el.innerHTML=cards.map(c=>{
    const [k,v,d,prevN,curN,opts]=c;
    return `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>`+
      (d?`<div class="d">${d}</div>`:'')+yoyLine(prevN,curN,opts||{})+`</div>`;
  }).join('');
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

  const regP=regPrev(), attP=attPrev(), accP=accPrev(), gapsP=missPrev();
  const activeP=regP.reduce((s,r)=>s+r.active,0);
  const PP=attP.reduce((s,a)=>s+a.P,0), AP=attP.reduce((s,a)=>s+a.A,0), TP=attP.reduce((s,a)=>s+a.T,0), EP=attP.reduce((s,a)=>s+a.E,0);
  const presentP=pct(PP,PP+AP+TP+EP);
  const avgAccP=accP.length?Math.round(10*accP.reduce((s,a)=>s+a.hours,0)/accP.length)/10:null;
  const centers=new Set(reg.map(r=>r.loc)).size, centersP=new Set(regP.map(r=>r.loc)).size;
  const dups=dupF(), dupsP=dupPrev();
  const activeDetail = dups&&dups.uniqueStudents!=null
    ? `${inact} inactive · ${fmt(dups.uniqueStudents)} unique by PersonID`
    : `${inact} inactive`;

  const cards=[
    ['Active students',fmt(active),activeDetail, hasPrevYear()?activeP:null, active],
    ['Centers',fmt(centers),`${new Set(reg.map(r=>r.grade)).size} grades`, hasPrevYear()?centersP:null, centers],
    ['Present rate',present+'%',`${fmt(P)} present marks`, hasPrevYear()?presentP:null, present, {pct:1}],
    ['Missing attendance entries',fmt(gaps.length),`${entryRate}% entry rate`, hasPrevYear()?gapsP.length:null, gaps.length, {lowerIsBetter:1}],
    ['Avg access hrs',avgAcc,`${fmt(acc.length)} unique people`, avgAccP, avgAcc, {dec:1}],
  ];
  if(dups){
    cards.push(['Duplicate students',fmt(dups.students),
      dups.extraEnrollments?`${fmt(dups.extraEnrollments)} extra enrollments`:'by PersonID',
      dupsP?dupsP.students:null, dups.students, {lowerIsBetter:1}]);
  }
  renderCards(document.getElementById('ovCards'), cards);

  const byLoc=groupSum(reg,r=>r.loc,['active','inactive']);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b].active-byLoc[a].active);
  mk('ovRegLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[
    {label:'Active',data:locs.map(l=>byLoc[l].active),backgroundColor:C.accent},
    {label:'Inactive',data:locs.map(l=>byLoc[l].inactive),backgroundColor:C.line}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  mk('ovAtt',{type:'doughnut',data:{labels:['Present','Absent','Tardy','Excused','Unmarked'],datasets:[{data:[P,A,T,E,M],backgroundColor:[C.green,C.red,C.amber,C.teal,C.muted]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});

  bindTable(document.getElementById('ovTable'),()=>{
    const cols=[{t:'Center'},{t:'Active',num:1},{t:'Present %',num:1},{t:'Missing attendance entries',num:1},{t:'Avg access hrs',num:1}];
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
  const acc=accF(), accP=accPrev();
  const qc={Adequate:0,Moderate:0,Low:0,None:0}; acc.forEach(a=>qc[a.q]++);
  const tot=acc.reduce((s,a)=>s+a.hours,0);
  const good=qc.Adequate+qc.Moderate;
  const qcP={Adequate:0,Moderate:0,Low:0,None:0}; accP.forEach(a=>qcP[a.q]++);
  const totP=accP.reduce((s,a)=>s+a.hours,0);
  const goodP=qcP.Adequate+qcP.Moderate;
  const avg=acc.length?Math.round(10*tot/acc.length)/10:0;
  const avgP=accP.length?Math.round(10*totP/accP.length)/10:null;
  const goodPct=pct(good,acc.length), goodPctP=pct(goodP,accP.length);
  renderCards(document.getElementById('acCards'), [
    ['Total Student Count',fmt(acc.length),'unique people (duplicates merged)', hasPrevYear()?accP.length:null, acc.length],
    ['Avg access hrs',avg,`${fmt(Math.round(tot))} total hrs`, avgP, avg, {dec:1}],
    ['Adequate + Moderate',goodPct+'%',`${fmt(good)} people`, hasPrevYear()?goodPctP:null, goodPct, {pct:1}],
    ['No access',qc.None,pct(qc.None,acc.length)+'% of people', hasPrevYear()?qcP.None:null, qc.None, {lowerIsBetter:1}],
  ]);
  mk('acQ',{type:'doughnut',data:{labels:['Adequate','Moderate','Low','None'],datasets:[{data:[qc.Adequate,qc.Moderate,qc.Low,qc.None],backgroundColor:[C.green,C.teal,C.amber,C.red]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  const byLoc={}; acc.forEach(a=>{(byLoc[a.loc]=byLoc[a.loc]||[]).push(a.hours);});
  const locs=Object.keys(byLoc).sort();
  mk('acLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[{label:'Avg hrs',data:locs.map(l=>Math.round(10*byLoc[l].reduce((s,v)=>s+v,0)/byLoc[l].length)/10),backgroundColor:C.accent2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  syncAccessDetailLock();
  if(isAccessDetailUnlocked()){
    bindTable(document.getElementById('acTable'),()=>{
      const cols=[{t:'Person'},{t:'Center'},{t:'Grade'},{t:'Access hrs',num:1},{t:'Quality'}];
      const rows=acc.map(a=>{const r=[a.person,a.loc,a.grade,a.hours,qBadge(a.q)];r._raw=[a.person,a.loc,a.grade,a.hours,a.q];return r;});
      return [cols,rows];
    });
    document.getElementById('acTable')._sort={i:3,dir:-1};
    document.getElementById('acTable')._data();
  }
}

// =================== REGISTRATION ===================
function registration(){
  const reg=regF(), regP=regPrev();
  const active=reg.reduce((s,r)=>s+r.active,0),inact=reg.reduce((s,r)=>s+r.inactive,0);
  const activeP=regP.reduce((s,r)=>s+r.active,0),inactP=regP.reduce((s,r)=>s+r.inactive,0);
  const dups=dupF(), dupsP=dupPrev();
  const activeDetail = (dups&&dups.uniqueStudents!=null)
    ? `${pct(active,active+inact)}% of roster · ${fmt(dups.uniqueStudents)} unique by PersonID`
    : pct(active,active+inact)+'% of roster';
  const cards=[
    ['Active students',fmt(active),activeDetail, hasPrevYear()?activeP:null, active],
    ['Inactive students',fmt(inact),pct(inact,active+inact)+'% of roster', hasPrevYear()?inactP:null, inact, {lowerIsBetter:1}],
    ['Classes',fmt(reg.length),`${new Set(reg.map(r=>r.loc)).size} centers`, hasPrevYear()?regP.length:null, reg.length],
    ['Grades offered',new Set(reg.map(r=>r.grade)).size,'', hasPrevYear()?new Set(regP.map(r=>r.grade)).size:null, new Set(reg.map(r=>r.grade)).size],
  ];
  if(dups){
    cards.push(['Duplicate students',fmt(dups.students),
      dups.extraEnrollments?`${fmt(dups.extraEnrollments)} extra enrollments`:'same PersonID in multiple classes',
      dupsP?dupsP.students:null, dups.students, {lowerIsBetter:1}]);
  }
  renderCards(document.getElementById('rgCards'), cards);
  const byCat=groupSum(reg,r=>displayCat(r),['active','inactive']);
  const cats=Object.keys(byCat).sort(sortCats);
  mk('rgCat',{type:'bar',data:{labels:cats,datasets:[
    {label:'Active',data:cats.map(c=>byCat[c].active),backgroundColor:C.green},
    {label:'Inactive',data:cats.map(c=>byCat[c].inactive),backgroundColor:C.red}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  const byLoc=groupSum(reg,r=>r.loc,['active','inactive']);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b].active-byLoc[a].active);
  mk('rgLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[
    {label:'Active',data:locs.map(l=>byLoc[l].active),backgroundColor:C.green},
    {label:'Inactive',data:locs.map(l=>byLoc[l].inactive),backgroundColor:C.red}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  bindTable(document.getElementById('rgTable'),()=>{
    const cols=[{t:'Center'},{t:'Grade level'},{t:'Grade'},{t:'Section'},{t:'Active',num:1},{t:'Inactive',num:1}];
    const rows=reg.map(r=>{const x=[r.loc,displayCat(r),r.grade,r.section||'—',r.active,r.inactive];return x;});
    return [cols,rows];
  });
  document.getElementById('rgTable')._sort={i:4,dir:-1};
  document.getElementById('rgTable')._data();

  const dupPanel=document.getElementById('rgDupPanel');
  if(dupPanel){
    if(!dups){
      dupPanel.hidden=true;
    } else {
      dupPanel.hidden=false;
      bindTable(document.getElementById('rgDupTable'),()=>{
        const cols=[{t:'Person'},{t:'PersonID'},{t:'Enrollments',num:1},{t:'Centers'},{t:'Grades'}];
        const rows=(dups.details||[]).map(x=>{
          const locs=(x.locs||[]).map(l=>l.replace(' REC','')).join(', ');
          const grades=(x.grades||[]).join(', ');
          const r=[x.name||'—',x.id,x.count,locs||'—',grades||'—'];
          r._raw=[x.name,x.id,x.count,locs,grades]; return r;
        });
        if(!rows.length) return [cols,[['—','—','—','No duplicate PersonIDs in this filter','—']]];
        return [cols,rows];
      });
      document.getElementById('rgDupTable')._sort={i:2,dir:-1};
      document.getElementById('rgDupTable')._data();
    }
  }
}

// ---- Attendance compare (cross-year / cross-grade / date range) ----
let DATA_BY_YEAR={};

function addDays(iso, n){
  const d=new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
function sortGrades(gs){
  return [...gs].sort((a,b)=>{const ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
}
function datasetFromPayload(payload){
  const d=scrubData({
    access:payload.access||[], registration:payload.registration||[],
    attendance:payload.attendance||[], holidays:payload.holidays||[],
    students:payload.students||[], studentAttendance:payload.studentAttendance||[],
    studentAttendanceRecords:payload.studentAttendanceRecords||[],
    duplicates:payload.duplicates||{available:false,details:[]},
  });
  const att=d.attendance||[];
  const dates=uniq(att.map(a=>a.date).filter(Boolean)).sort();
  return {
    attendance:att,
    grades:sortGrades(uniq(att.map(a=>a.grade).filter(Boolean))),
    locs:uniq(att.map(a=>a.loc).filter(Boolean)).sort(),
    dateMin:dates[0]||null,
    dateMax:dates[dates.length-1]||null,
  };
}
function cacheYearDataset(year, ds){
  if(sel.region&&year) DATA_BY_YEAR[sel.region+'|'+year]=ds;
}
async function getYearDataset(year){
  const region=sel.region;
  if(!region||!year) return {attendance:[],grades:[],locs:[],dateMin:null,dateMax:null};
  const key=region+'|'+year;
  if(DATA_BY_YEAR[key]) return DATA_BY_YEAR[key];
  if(year===sel.year&&DATA){
    const att=DATA.attendance||[];
    const dates=uniq(att.map(a=>a.date).filter(Boolean)).sort();
    const ds={
      attendance:att,
      grades:sortGrades(uniq(att.map(a=>a.grade).filter(Boolean))),
      locs:uniq(att.map(a=>a.loc).filter(Boolean)).sort(),
      dateMin:dates[0]||null,
      dateMax:dates[dates.length-1]||null,
    };
    cacheYearDataset(year, ds);
    return ds;
  }
  const qs=`?region=${encodeURIComponent(region)}&year=${encodeURIComponent(year)}`;
  const res=await fetch('/api/data'+qs,{cache:'no-store',credentials:'same-origin'});
  if(!res.ok) throw new Error('Could not load '+year);
  const payload=await res.json();
  if(payload.error) throw new Error(payload.error);
  const ds=datasetFromPayload(payload);
  cacheYearDataset(year, ds);
  return ds;
}
function readCmpConfig(series){
  const y=document.getElementById('cmp'+series+'Year');
  const loc=document.getElementById('cmp'+series+'Loc');
  const level=document.getElementById('cmp'+series+'Level');
  const grade=document.getElementById('cmp'+series+'Grade');
  const from=document.getElementById('cmp'+series+'From');
  const to=document.getElementById('cmp'+series+'To');
  return {
    series,
    year:y?y.value:'',
    loc:loc?loc.value:'ALL',
    level:level?level.value:'ALL',
    grade:grade?grade.value:'',
    from:from?from.value:'',
    to:to?to.value:'',
  };
}
function cmpGradesForLevel(allGrades, level){
  if(!level||level==='ALL') return allGrades;
  return allGrades.filter(g=>gradeLevelOf(g)===level);
}
function cmpSliceConfigured(cfg){
  const hasLevel=cfg.level&&cfg.level!=='ALL';
  const hasGrade=cfg.grade&&cfg.grade!=='ALL'&&cfg.grade!=='—';
  return hasLevel||hasGrade;
}
function normDate(d){
  const s=String(d||'').trim();
  if(!s) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
  return s;
}
function todayLocalISO(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function filterAttSlice(att, cfg){
  const from=normDate(cfg.from), to=normDate(cfg.to);
  return (att||[]).filter(a=>{
    const dt=normDate(a.date);
    if(!dt) return false;
    if(cfg.loc&&cfg.loc!=='ALL'&&a.loc!==cfg.loc) return false;
    if(cfg.level&&cfg.level!=='ALL'&&gradeLevelOf(a.grade)!==cfg.level) return false;
    if(cfg.grade&&cfg.grade!=='ALL'&&cfg.grade!=='—'&&a.grade!==cfg.grade) return false;
    if(from&&dt<from) return false;
    if(to&&dt>to) return false;
    return true;
  });
}
function summarizeAttSlice(rows){
  let P=0,A=0,T=0,E=0,M=0;
  rows.forEach(a=>{P+=a.P;A+=a.A;T+=a.T;E+=a.E;M+=a.M;});
  const mkd=P+A+T+E;
  const dates=uniq(rows.map(a=>a.date)).sort();
  return {
    P,A,T,E,M,mkd,entries:rows.length,sessions:dates.length,
    present:pct(P,mkd), absent:pct(A,mkd), tardy:pct(T,mkd), excused:pct(E,mkd),
    dateFrom:dates[0]||null, dateTo:dates[dates.length-1]||null,
  };
}
function cmpSeriesTitle(cfg){
  const loc=cfg.loc==='ALL'?'All centers':cfg.loc.replace(' REC','');
  const parts=[cfg.year];
  if(cfg.level&&cfg.level!=='ALL') parts.push(cfg.level);
  if(cfg.grade&&cfg.grade!=='ALL'&&cfg.grade!=='—') parts.push('Grade '+cfg.grade);
  else if(!cfg.level||cfg.level==='ALL') parts.push('All grades');
  parts.push(loc);
  return parts.join(' · ');
}
function cmpDateRangeLabel(cfg){
  if(cfg.from&&cfg.to) return cfg.from+' → '+cfg.to;
  if(cfg.from) return 'From '+cfg.from;
  if(cfg.to) return 'Through '+cfg.to;
  return 'All dates';
}
function sessionTrendPoints(rows){
  const byDate=groupSum(rows.filter(a=>normDate(a.date)),a=>normDate(a.date),['P','A','T','E']);
  return Object.keys(byDate).sort().map((d,i)=>{
    const x=byDate[d];
    const m=x.P+x.A+x.T+x.E;
    return {i:i+1, date:d, pct:pct(x.P,m)};
  });
}
function buildCompareTrendData(tA, tB){
  const labels=uniq([...tA.map(p=>p.date), ...tB.map(p=>p.date)]).sort();
  const mapPct=pts=>{
    const m=new Map(pts.map(p=>[p.date,p.pct]));
    return labels.map(d=>(m.has(d)?m.get(d):null));
  };
  return {labels, dataA:mapPct(tA), dataB:mapPct(tB)};
}
let lastCmpVM=null;
let cmpFetchSeq=0;

function paintCompareCharts(){
  const vm=lastCmpVM;
  if(!vm) return;
  const {sA,sB,trend,trendLabels}=vm;
  mk('atCompareBar',{_emptyMsg:'No compare data — click Update comparison.',type:'bar',data:{
    labels:['Present %','Absent %','Tardy %','Excused %'],
    datasets:[
      {label:'Series A',data:[sA.present,sA.absent,sA.tardy,sA.excused],backgroundColor:C.accent},
      {label:'Series B',data:[sB.present,sB.absent,sB.tardy,sB.excused],backgroundColor:C.accent2},
    ]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100}},plugins:{legend:{position:'bottom'},valueLabels:false}}});
  if(trend.labels.length){
    mk('atCompareTrend',{_emptyMsg:'No session dates in the selected range.',type:'line',data:{labels:trendLabels,datasets:[
      {label:'Series A',data:trend.dataA,borderColor:C.accent,backgroundColor:C.chartFill,fill:false,tension:.25,borderWidth:2,pointRadius:4,pointHoverRadius:5,spanGaps:false},
      {label:'Series B',data:trend.dataB,borderColor:C.accent2,backgroundColor:'transparent',fill:false,tension:.25,borderWidth:2,pointRadius:4,pointHoverRadius:5,spanGaps:false},
    ]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100},x:{ticks:{maxRotation:45,minRotation:0,maxTicksLimit:12}}},plugins:{legend:{position:'bottom'},valueLabels:false,tooltip:{callbacks:{title:function(items){const i=items[0]&&items[0].dataIndex;return trend.labels[i]||'';}}}}}});
  } else {
    setChartboxMessage('atCompareTrend', 'No session dates in the selected range.');
    if(charts.atCompareTrend){ try{ charts.atCompareTrend.destroy(); }catch(_){ } delete charts.atCompareTrend; }
  }
  scheduleCmpChartResize();
}
function fillCmpGradeSelect(el, grades, current){
  if(!el) return;
  const g=grades.length?grades:[];
  el.innerHTML='<option value="ALL">All</option>'+(g.map(v=>`<option>${v}</option>`).join(''));
  if(current==='ALL'||!g.length) el.value='ALL';
  else el.value=g.includes(current)?current:'ALL';
}
async function refreshCmpSeriesOptions(series){
  const cfg=readCmpConfig(series);
  const ds=await getYearDataset(cfg.year);
  const locEl=document.getElementById('cmp'+series+'Loc');
  const grEl=document.getElementById('cmp'+series+'Grade');
  if(locEl){
    const cur=locEl.value;
    fillSelect(locEl, ds.locs);
    locEl.value=cur==='ALL'||ds.locs.includes(cur)?cur:'ALL';
  }
  if(grEl){
    const cur=grEl.value;
    const grades=cmpGradesForLevel(ds.grades, cfg.level);
    fillCmpGradeSelect(grEl, grades, cur);
  }
}
async function applyCmpPreset(series, preset){
  const cfg=readCmpConfig(series);
  const ds=await getYearDataset(cfg.year);
  const rows=filterAttSlice(ds.attendance,{loc:cfg.loc, level:cfg.level, grade:cfg.grade, from:'', to:''});
  const dates=uniq(rows.map(a=>normDate(a.date)).filter(Boolean)).sort();
  const fromEl=document.getElementById('cmp'+series+'From');
  const toEl=document.getElementById('cmp'+series+'To');
  if(!dates.length||!fromEl||!toEl) return;
  const to=dates[dates.length-1];
  let from;
  if(preset==='6w') from=addDays(to,-41);
  else if(preset==='6s') from=dates[Math.max(0,dates.length-6)];
  else from=dates[0];
  fromEl.value=from;
  toEl.value=to;
}
function populateAttCompareYears(){
  const years=CAT.years[sel.region]||[];
  const aEl=document.getElementById('cmpAYear');
  const bEl=document.getElementById('cmpBYear');
  if(!aEl||!bEl||!years.length) return;
  fillPlain(aEl, years, sel.year);
  const prev=PREV_YEAR||(years[1]||years[0]);
  fillPlain(bEl, years, prev);
}
async function setupAttCompareDefaults(){
  populateAttCompareYears();
  const defLevel=(state.level&&state.level!=='ALL')?state.level:'ALL';
  const defGrade=(state.grade&&state.grade!=='ALL')?state.grade:'ALL';
  ['A','B'].forEach(s=>{
    const lv=document.getElementById('cmp'+s+'Level');
    if(lv) lv.value=defLevel;
  });
  await refreshCmpSeriesOptions('A');
  await refreshCmpSeriesOptions('B');
  const gA=document.getElementById('cmpAGrade');
  const gB=document.getElementById('cmpBGrade');
  if(gA&&defGrade!=='ALL'&&[...gA.options].some(o=>o.value===defGrade)) gA.value=defGrade;
  if(gB&&defGrade!=='ALL'&&[...gB.options].some(o=>o.value===defGrade)) gB.value=defGrade;
  if(!cmpSliceConfigured(readCmpConfig('A'))){
    const fb=ALL_GRADES.includes('11')?'11':ALL_GRADES[0];
    if(gA&&fb&&[...gA.options].some(o=>o.value===fb)) gA.value=fb;
  }
  if(!cmpSliceConfigured(readCmpConfig('B'))){
    const fb=ALL_GRADES.includes('11')?'11':ALL_GRADES[0];
    if(gB&&fb&&[...gB.options].some(o=>o.value===fb)) gB.value=fb;
  }
  await applyCmpPreset('A','6w');
  await applyCmpPreset('B','6w');
}
function cmpDelta(a, b, opts={}){
  if(a==null||b==null||Number.isNaN(a)||Number.isNaN(b)) return '—';
  const d=Math.round((b-a)*10)/10;
  if(d===0) return '0';
  const good=opts.lowerIsBetter?d<0:d>0;
  const cls=good?'yoy-up':'yoy-down';
  const sign=d>0?'+':'';
  return `<span class="${cls}">${sign}${d}${opts.pct?' pp':''}</span>`;
}
async function renderAttCompare(){
  const status=document.getElementById('atCompareStatus');
  const summaryEl=document.getElementById('atCompareSummary');
  if(!status||!summaryEl) return;
  const seq=++cmpFetchSeq;
  status.textContent='Loading…';
  try{
    const cfgA=readCmpConfig('A');
    const cfgB=readCmpConfig('B');
    if(!cfgA.year||!cfgB.year) throw new Error('Choose a year for each series (reload if Year lists are empty).');
    if(!cmpSliceConfigured(cfgA)||!cmpSliceConfigured(cfgB)) throw new Error('Pick grade level and/or grade for each series.');
    const [dsA, dsB]=await Promise.all([getYearDataset(cfgA.year), getYearDataset(cfgB.year)]);
    if(seq!==cmpFetchSeq) return;
    const rowsA=filterAttSlice(dsA.attendance, cfgA);
    const rowsB=filterAttSlice(dsB.attendance, cfgB);
    const sA=summarizeAttSlice(rowsA);
    const sB=summarizeAttSlice(rowsB);
    const labelA=cmpSeriesTitle(cfgA);
    const labelB=cmpSeriesTitle(cfgB);
    const prcA=sA.present>=80?'p-green':sA.present>=65?'p-amber':'p-red';
    const prcB=sB.present>=80?'p-green':sB.present>=65?'p-amber':'p-red';
    summaryEl.innerHTML=
      `<div class="card"><div class="tag"><span class="cmp-badge cmp-a">A</span> ${esc(labelA)}</div><div class="k">Present %</div><div class="v"><span class="pill ${prcA}">${sA.present}%</span></div><div class="d">${cmpDateRangeLabel(cfgA)} · ${fmt(sA.sessions)} session dates · ${fmt(sA.entries)} class entries</div></div>`+
      `<div class="card"><div class="tag"><span class="cmp-badge cmp-b">B</span> ${esc(labelB)}</div><div class="k">Present %</div><div class="v"><span class="pill ${prcB}">${sB.present}%</span></div><div class="d">${cmpDateRangeLabel(cfgB)} · ${fmt(sB.sessions)} session dates · ${fmt(sB.entries)} class entries</div></div>`;
    const tA=sessionTrendPoints(rowsA);
    const tB=sessionTrendPoints(rowsB);
    const trend=buildCompareTrendData(tA, tB);
    const trendLabels=trend.labels.map(d=>{
      const day=DAYS[new Date(d+'T12:00:00Z').getUTCDay()];
      return d.slice(5).replace('-','/')+' '+day;
    });
    lastCmpVM={sA,sB,trend,trendLabels,cfgA,cfgB,rowsA,rowsB};
    paintCompareCharts();
    bindTable(document.getElementById('atCompareTable'),()=>{
      const cols=[{t:'Metric'},{t:'Series A',num:1},{t:'Series B',num:1},{t:'B − A',num:1}];
      const mkRow=(name,a,b,delta,rawDelta)=>{
        const row=[name,a,b,delta];
        row._raw=[name,rawDelta??0]; return row;
      };
      return [cols,[
        mkRow('Present %',sA.present+'%',sB.present+'%',cmpDelta(sA.present,sB.present,{pct:1}),sB.present-sA.present),
        mkRow('Absent %',sA.absent+'%',sB.absent+'%',cmpDelta(sA.absent,sB.absent,{pct:1,lowerIsBetter:1}),sA.absent-sB.absent),
        mkRow('Present (count)',fmt(sA.P),fmt(sB.P),cmpDelta(sA.P,sB.P),sB.P-sA.P),
        mkRow('Absent (count)',fmt(sA.A),fmt(sB.A),cmpDelta(sA.A,sB.A,{lowerIsBetter:1}),sA.A-sB.A),
        mkRow('Tardy (count)',fmt(sA.T),fmt(sB.T),cmpDelta(sA.T,sB.T,{lowerIsBetter:1}),sA.T-sB.T),
        mkRow('Excused (count)',fmt(sA.E),fmt(sB.E),cmpDelta(sA.E,sB.E,{lowerIsBetter:1}),sA.E-sB.E),
        mkRow('Unmarked (count)',fmt(sA.M),fmt(sB.M),cmpDelta(sA.M,sB.M,{lowerIsBetter:1}),sA.M-sB.M),
        mkRow('Session dates in range',fmt(sA.sessions),fmt(sB.sessions),cmpDelta(sA.sessions,sB.sessions),sB.sessions-sA.sessions),
        mkRow('Class entries in range',fmt(sA.entries),fmt(sB.entries),cmpDelta(sA.entries,sB.entries),sB.entries-sA.entries),
      ]];
    });
    document.getElementById('atCompareTable')._sort={i:0,dir:1};
    document.getElementById('atCompareTable')._data();
    if(!rowsA.length&&!rowsB.length) status.textContent='No attendance rows match these filters.';
    else if(!rowsA.length) status.textContent='Series A has no rows in this range.';
    else if(!rowsB.length) status.textContent='Series B has no rows in this range.';
    else if(!trend.labels.length) status.textContent='No session dates in range — widen From/To or check grade and year.';
    else status.textContent='';
  }catch(e){
    status.textContent=e.message||String(e);
    summaryEl.innerHTML='';
  }
}
let attCompareBound=false;
function bindAttCompare(){
  if(attCompareBound) return;
  attCompareBound=true;
  document.getElementById('atCompareRun')?.addEventListener('click',()=>{ void renderAttCompare(); });
  ['A','B'].forEach(s=>{
    document.getElementById('cmp'+s+'Year')?.addEventListener('change',()=>{
      void refreshCmpSeriesOptions(s).then(()=>renderAttCompare());
    });
    document.getElementById('cmp'+s+'Loc')?.addEventListener('change',()=>{ void renderAttCompare(); });
    document.getElementById('cmp'+s+'Level')?.addEventListener('change',()=>{
      void refreshCmpSeriesOptions(s).then(()=>renderAttCompare());
    });
    document.getElementById('cmp'+s+'Grade')?.addEventListener('change',()=>{ void renderAttCompare(); });
    document.getElementById('cmp'+s+'From')?.addEventListener('change',()=>{ void renderAttCompare(); });
    document.getElementById('cmp'+s+'To')?.addEventListener('change',()=>{ void renderAttCompare(); });
  });
  document.querySelectorAll('.cmppreset').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const s=btn.dataset.cmp;
      void applyCmpPreset(s, btn.dataset.preset).then(()=>renderAttCompare());
    });
  });
}

// =================== ATTENDANCE ===================
function attendance(){
  const att=attF(), attP=attPrev();
  const P=att.reduce((s,a)=>s+a.P,0),A=att.reduce((s,a)=>s+a.A,0),T=att.reduce((s,a)=>s+a.T,0),E=att.reduce((s,a)=>s+a.E,0),M=att.reduce((s,a)=>s+a.M,0);
  const mkd=P+A+T+E;
  const PP=attP.reduce((s,a)=>s+a.P,0),AP=attP.reduce((s,a)=>s+a.A,0),TP=attP.reduce((s,a)=>s+a.T,0),EP=attP.reduce((s,a)=>s+a.E,0);
  const mkdP=PP+AP+TP+EP;
  const present=pct(P,mkd), absent=pct(A,mkd), te=T+E;
  renderCards(document.getElementById('atCards'), [
    ['Present %',present+'%',`${fmt(P)} present`, hasPrevYear()?pct(PP,mkdP):null, present, {pct:1}],
    ['Absent %',absent+'%',`${fmt(A)} absent`, hasPrevYear()?pct(AP,mkdP):null, absent, {pct:1, lowerIsBetter:1}],
    ['Tardy + Excused',fmt(te),`${pct(te,mkd)}% of marks`, hasPrevYear()?(TP+EP):null, te],
    ['Entries',fmt(att.length),`${new Set(att.map(a=>a.date)).size} dates`, hasPrevYear()?attP.length:null, att.length],
  ]);
  const byDate=groupSum(att,a=>a.date,['P','A','T','E']);
  const dates=Object.keys(byDate).sort();
  mk('atTrend',{_emptyMsg:'No attendance entries for the current Center / Grade filters.',type:'line',data:{labels:dates,datasets:[{label:'Present %',data:dates.map(d=>{const x=byDate[d];return pct(x.P,x.P+x.A+x.T+x.E);}),borderColor:C.green,backgroundColor:C.chartFill,fill:true,tension:.3,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100},x:{ticks:{maxTicksLimit:8}}},plugins:{legend:{display:false},valueLabels:{format:pctLabel}}}});
  const byGr=groupSum(att,a=>a.grade,['P','A','T','E']);
  const grs=Object.keys(byGr).sort((a,b)=>{let ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  mk('atGrade',{_emptyMsg:'No attendance entries for the current Center / Grade filters.',type:'bar',data:{labels:grs,datasets:[{label:'Present %',data:grs.map(g=>{const x=byGr[g];return pct(x.P,x.P+x.A+x.T+x.E);}),backgroundColor:C.teal}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100}},plugins:{legend:{display:false},valueLabels:{format:pctLabel}}}});
  scheduleCmpChartResize();
  bindTable(document.getElementById('atSessionTable'),()=>{
    const cols=[{t:'Date'},{t:'Day'},{t:'Class entries',num:1},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
    const byDate=groupSum(att.filter(a=>normDate(a.date)),a=>normDate(a.date),['P','A','T','E','M']);
    const entriesByDate={};
    att.forEach(a=>{const d=normDate(a.date); if(d) entriesByDate[d]=(entriesByDate[d]||0)+1;});
    const rows=Object.keys(byDate).sort().map(d=>{
      const x=byDate[d];
      const m=x.P+x.A+x.T+x.E;
      const pr=pct(x.P,m);
      const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
      const day=DAYS[new Date(d+'T12:00:00Z').getUTCDay()];
      const r=[d,day,entriesByDate[d]||0,x.P,x.A,x.T,x.E,x.M,`<span class="pill ${prc}">${pr}%</span>`];
      r._raw=[d,day,entriesByDate[d]||0,x.P,x.A,x.T,x.E,x.M,pr];
      return r;
    });
    if(!rows.length) return [cols,[['—','—','—','—','—','—','—','—','No sessions match filter']]];
    return [cols,rows];
  });
  document.getElementById('atSessionTable')._sort={i:0,dir:1};
  document.getElementById('atSessionTable')._data();

  bindTable(document.getElementById('atTable'),()=>{
    const cols=[{t:'Center'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
    const byLoc=groupSum(att,a=>a.loc,['P','A','T','E','M']);
    const rows=uniq(Object.keys(byLoc)).map(l=>{const x=byLoc[l];const m=x.P+x.A+x.T+x.E;const pr=pct(x.P,m);
      const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
      const r=[l,x.P,x.A,x.T,x.E,x.M,`<span class="pill ${prc}">${pr}%</span>`];r._raw=[l,x.P,x.A,x.T,x.E,x.M,pr];return r;});
    return [cols,rows];
  });
  document.getElementById('atTable')._sort={i:6,dir:-1};
  document.getElementById('atTable')._data();

  const attRow=(keyParts,x)=>{
    const m=x.P+x.A+x.T+x.E; const pr=pct(x.P,m);
    const prc=pr>=80?'p-green':pr>=65?'p-amber':'p-red';
    const r=[...keyParts,x.P,x.A,x.T,x.E,x.M,`<span class="pill ${prc}">${pr}%</span>`];
    r._raw=[...keyParts,x.P,x.A,x.T,x.E,x.M,pr]; return r;
  };
  const gradeSort=(a,b)=>{const ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);};

  bindTable(document.getElementById('atGradeTable'),()=>{
    const cols=[{t:'Grade'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
    const byGrade=groupSum(att,a=>a.grade,['P','A','T','E','M']);
    const rows=Object.keys(byGrade).sort(gradeSort).map(g=>attRow([g],byGrade[g]));
    return [cols,rows];
  });
  document.getElementById('atGradeTable')._sort={i:0,dir:1};
  document.getElementById('atGradeTable')._data();

  bindTable(document.getElementById('atGradeLocTable'),()=>{
    const cols=[{t:'Center'},{t:'Grade'},{t:'Present',num:1},{t:'Absent',num:1},{t:'Tardy',num:1},{t:'Excused',num:1},{t:'Unmarked',num:1},{t:'Present %',num:1}];
    const by=groupSum(att,a=>a.loc+'|'+a.grade,['P','A','T','E','M']);
    const rows=Object.keys(by).sort((a,b)=>{
      const [la,ga]=a.split('|'),[lb,gb]=b.split('|');
      return la.localeCompare(lb)||gradeSort(ga,gb);
    }).map(k=>{const [loc,grade]=k.split('|'); return attRow([loc,grade],by[k]);});
    return [cols,rows];
  });
  document.getElementById('atGradeLocTable')._sort={i:0,dir:1};
  document.getElementById('atGradeLocTable')._data();

  syncAttDetailLock();
  if(isAttDetailUnlocked()) renderAttStudentTable();
  bindAttCompare();
  if(lastCmpVM) paintCompareCharts();
  void renderAttCompare();
}

// ---- entry matrix: classes (rows) × dates (cols) ----
// Only show dates where at least one visible class was scheduled
// (entered or missing). Holiday-only / out-of-window days are omitted.
// Legend chips toggle row filters (miss / fully entered / holiday).
function syncMatrixLegend(){
  document.querySelectorAll('#msLegend .mxleg').forEach(b=>{
    b.classList.toggle('active', b.dataset.mx===state.matrix);
  });
}
function buildMatrix(att, gaps){
  const el=document.getElementById('msMatrix');
  syncMatrixLegend();
  const entered=new Set(att.map(a=>a.loc+'|'+a.grade+'|'+a.section+'|'+a.date));
  const missSet=new Set(gaps.map(g=>g.loc+'|'+g.grade+'|'+g.section+'|'+g.date));
  const classes={}; att.forEach(a=>{const k=a.loc+'|'+a.grade+'|'+a.section;
    (classes[k]=classes[k]||{loc:a.loc,grade:a.grade,section:a.section,dates:new Set()}).dates.add(a.date);});
  // Include registered classes that never entered attendance (appear only in gaps)
  gaps.forEach(g=>{const k=g.loc+'|'+g.grade+'|'+g.section;
    if(!classes[k]) classes[k]={loc:g.loc,grade:g.grade,section:g.section,dates:new Set()};
  });
  const allCls=Object.values(classes).sort((a,b)=>a.loc.localeCompare(b.loc)||
    (gradeOrder.indexOf(a.grade)-gradeOrder.indexOf(b.grade))||String(a.section).localeCompare(String(b.section)));
  const candidateDates=uniq([...att.map(a=>a.date),...gaps.map(g=>g.date)]);
  const ck=c=>c.loc+'|'+c.grade+'|'+c.section;
  const hasMiss=c=>gaps.some(g=>g.loc===c.loc&&g.grade===c.grade&&g.section===c.section);
  const hasHol=c=>{
    const cd=[...c.dates].sort();
    const spanDates=cd.length?cd:candidateDates.filter(d=>HOLIDAYS.has(c.loc+'|'+d)||missSet.has(ck(c)+'|'+d)||entered.has(ck(c)+'|'+d));
    if(!spanDates.length) return false;
    const mn=spanDates[0], mx=spanDates[spanDates.length-1];
    return [...HOLIDAYS].some(h=>{
      if(!h.startsWith(c.loc+'|')) return false;
      const d=h.slice(c.loc.length+1);
      return d>=mn && d<=mx;
    });
  };

  let clsList=allCls;
  if(state.matrix==='miss') clsList=allCls.filter(hasMiss);
  else if(state.matrix==='ok') clsList=allCls.filter(c=>!hasMiss(c));
  else if(state.matrix==='hol') clsList=allCls.filter(hasHol);

  const dates=candidateDates.filter(d=>clsList.some(c=>{
    const sched=isSessionScheduledDay(c.loc, c.grade, d);
    if(sched===false) return false;
    const key=ck(c)+'|'+d;
    if(sched===true) return entered.has(key)||missSet.has(key);
    return entered.has(key)||missSet.has(key);
  }));

  if(!allCls.length){el.innerHTML='<div class="note">No classes match the current filter.</div>';return;}
  if(!clsList.length){
    const labels={miss:'with missing attendance',ok:'with all entries logged',hol:'with a scheduled holiday'};
    el.innerHTML=`<div class="note">No classes ${labels[state.matrix]||'match'}. Click the active legend chip again to clear.</div>`;
    return;
  }
  if(!dates.length){el.innerHTML='<div class="note">No scheduled class days match the current filter.</div>';return;}

  let seenMonth=null;
  const head=dates.map(d=>{const mo=d.slice(0,7);const isNew=mo!==seenMonth;seenMonth=mo;
    const day=DAYS[new Date(d+'T00:00:00Z').getUTCDay()];
    const lbl=d.slice(8,10); const cls=isNew?'mon':'';
    const mlabel=isNew?`<div style="font-size:9px;color:var(--muted)">${MONTHS[+d.slice(5,7)-1]}</div>`:'<div style="height:12px"></div>';
    return `<th class="${cls}" title="${d}">${mlabel}<div style="font-size:9px;color:var(--muted)">${day}</div>${lbl}</th>`;}).join('');
  const rows=clsList.map(c=>{
    seenMonth=null;
    const cells=dates.map(d=>{const mo=d.slice(0,7);const isNew=mo!==seenMonth;seenMonth=mo;const b=isNew?' mon':'';
      const key=ck(c)+'|'+d;
      const isHol=HOLIDAYS.has(c.loc+'|'+d);
      const sched=isSessionScheduledDay(c.loc, c.grade, d);
      let dot='';
      if(sched===false) dot='';
      else if(entered.has(key)) dot='<span class="cd ok"></span>';
      else if(isHol) dot='<span class="cd hol" title="Holiday '+d+'"></span>';
      else if(missSet.has(key)) dot='<span class="cd miss" title="No attendance entered '+d+'"></span>';
      return `<td class="cell${b}">${dot}</td>`;}).join('');
    const missCount=dates.filter(d=>missSet.has(ck(c)+'|'+d)).length;
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
  const gapsP=missPrev(), attP=attPrev();
  const recordedP=attP.length, expectedP=recordedP+gapsP.length;
  const affClassesP=new Set(gapsP.map(g=>g.loc+'|'+g.grade+'|'+g.section)).size;
  const affLocsP=new Set(gapsP.map(g=>g.loc)).size;
  const entryRate=pct(recorded,expected), entryRateP=pct(recordedP,expectedP);
  renderCards(document.getElementById('msCards'), [
    ['Missing attendance entries',fmt(gaps.length),'date/class combos with no entry', hasPrevYear()?gapsP.length:null, gaps.length, {lowerIsBetter:1}],
    ['Entry rate',entryRate+'%',`${fmt(recorded)} of ${fmt(expected)} expected`, hasPrevYear()?entryRateP:null, entryRate, {pct:1}],
    ['Classes affected',fmt(affClasses),'have ≥1 missing entry', hasPrevYear()?affClassesP:null, affClasses, {lowerIsBetter:1}],
    ['Centers affected',fmt(affLocs),'with missing entries', hasPrevYear()?affLocsP:null, affLocs, {lowerIsBetter:1}],
  ]);

  buildMatrix(att, gaps);

  const byLoc={}; gaps.forEach(g=>byLoc[g.loc]=(byLoc[g.loc]||0)+1);
  const locs=Object.keys(byLoc).sort((a,b)=>byLoc[b]-byLoc[a]);
  mk('msLoc',{type:'bar',data:{labels:locs.map(l=>l.replace(' REC','')),datasets:[{label:'Missing attendance entries',data:locs.map(l=>byLoc[l]),backgroundColor:C.amber}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});

  bindTable(document.getElementById('msGap'),()=>{
    const cols=[{t:'Center'},{t:'Grade'},{t:'Section'},{t:'Missing',num:1}];
    const cm={}; gaps.forEach(g=>{const k=g.loc+'|'+g.grade+'|'+g.section;cm[k]=(cm[k]||0)+1;});
    const rows=Object.keys(cm).map(k=>{const p=k.split('|');return [p[0],p[1],p[2]||'—',cm[k]];});
    if(!rows.length)return[cols,[['—','—','—','—']]];
    return [cols,rows];
  });
  document.getElementById('msGap')._sort={i:3,dir:-1};
  document.getElementById('msGap')._data();

  bindTable(document.getElementById('msTable'),()=>{
    const cols=[{t:'Center'},{t:'Grade'},{t:'Section'},{t:'Date (no attendance entered)'},{t:'Status'}];
    const rows=gaps.map(g=>{const r=[g.loc,g.grade,g.section||'—',g.date,'<span class="pill p-red">No entry</span>'];r._raw=[g.loc,g.grade,g.section,g.date,g.date];return r;});
    if(!rows.length)return[cols,[['—','—','—','No missing attendance entries','<span class="pill p-green">All entered</span>']]];
    return [cols,rows];
  });
  document.getElementById('msTable')._sort={i:3,dir:1};
  document.getElementById('msTable')._data();
}

// ---- routing ----
const pages={overview,access,registration,attendance,missing};
let current='overview';
function render(){
  pages[current]();
  requestAnimationFrame(resizeVisibleCharts);
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); document.getElementById('p-'+t.dataset.p).classList.add('active');
  current=t.dataset.p; render();
  if(current==='attendance'){
    if(lastCmpVM) paintCompareCharts();
    else void renderAttCompare();
    scheduleCmpChartResize();
  }
});
fLoc.onchange=()=>{state.loc=fLoc.value; render();};
fLevel.onchange=()=>{
  state.level=fLevel.value;
  refreshGradeOptions();
  if(state.grade!=='ALL'&&!fLevelOk(state.grade)){ state.grade='ALL'; fGrade.value='ALL'; }
  render();
};
fGrade.onchange=()=>{state.grade=fGrade.value; render();};
document.getElementById('reset').onclick=()=>{
  state.loc='ALL';state.level='ALL';state.grade='ALL';state.matrix=null;
  fLoc.value='ALL';fLevel.value='ALL';refreshGradeOptions();fGrade.value='ALL';
  render();
};
document.getElementById('msLegend').addEventListener('click',e=>{
  const btn=e.target.closest('.mxleg'); if(!btn) return;
  const kind=btn.dataset.mx;
  state.matrix=(state.matrix===kind)?null:kind;
  if(current==='missing') missing();
  else syncMatrixLegend();
});

// ---- Access detail password gate ----
function isAccessDetailUnlocked(){
  try{return sessionStorage.getItem(ACCESS_DETAIL_KEY)==='1';}catch(_){return false;}
}
function setAccessDetailUnlocked(on){
  try{ if(on) sessionStorage.setItem(ACCESS_DETAIL_KEY,'1'); else sessionStorage.removeItem(ACCESS_DETAIL_KEY); }catch(_){}
}
function syncAccessDetailLock(){
  const unlocked=isAccessDetailUnlocked();
  const lock=document.getElementById('acLock');
  const detail=document.getElementById('acDetail');
  if(lock) lock.hidden=unlocked;
  if(detail) detail.hidden=!unlocked;
  const err=document.getElementById('acLockErr');
  if(err && unlocked) err.hidden=true;
}
function tryUnlockAccessDetail(){
  const input=document.getElementById('acPass');
  const err=document.getElementById('acLockErr');
  if((input&&input.value)===ACCESS_DETAIL_PASSWORD){
    setAccessDetailUnlocked(true);
    if(input) input.value='';
    if(err) err.hidden=true;
    if(current==='access') access();
    else syncAccessDetailLock();
  } else {
    if(err) err.hidden=false;
    if(input){ input.value=''; input.focus(); }
  }
}
document.getElementById('acUnlock').onclick=tryUnlockAccessDetail;
document.getElementById('acPass').addEventListener('keydown',e=>{ if(e.key==='Enter') tryUnlockAccessDetail(); });
syncAccessDetailLock();

// ---- Attendance detail password gate ----
function isAttDetailUnlocked(){
  try{return sessionStorage.getItem(ATTENDANCE_DETAIL_KEY)==='1';}catch(_){return false;}
}
function setAttDetailUnlocked(on){
  try{ if(on) sessionStorage.setItem(ATTENDANCE_DETAIL_KEY,'1'); else sessionStorage.removeItem(ATTENDANCE_DETAIL_KEY); }catch(_){}
}
function syncAttDetailLock(){
  const unlocked=isAttDetailUnlocked();
  const lock=document.getElementById('atLock');
  const detail=document.getElementById('atDetail');
  if(lock) lock.hidden=unlocked;
  if(detail) detail.hidden=!unlocked;
  const err=document.getElementById('atLockErr');
  if(err && unlocked) err.hidden=true;
}
function tryUnlockAttDetail(){
  const input=document.getElementById('atPass');
  const err=document.getElementById('atLockErr');
  if((input&&input.value)===ATTENDANCE_DETAIL_PASSWORD){
    setAttDetailUnlocked(true);
    if(input) input.value='';
    if(err) err.hidden=true;
    populateAttDetailFilters();
    if(current==='attendance') attendance();
    else syncAttDetailLock();
  } else {
    if(err) err.hidden=false;
    if(input){ input.value=''; input.focus(); }
  }
}
document.getElementById('atUnlock').onclick=tryUnlockAttDetail;
document.getElementById('atPass').addEventListener('keydown',e=>{ if(e.key==='Enter') tryUnlockAttDetail(); });
if(fAtDetLoc) fAtDetLoc.onchange=()=>{ attDetailState.loc=fAtDetLoc.value; if(current==='attendance') renderAttStudentTable(); };
if(fAtDetGrade) fAtDetGrade.onchange=()=>{ attDetailState.grade=fAtDetGrade.value; if(current==='attendance') renderAttStudentTable(); };
document.getElementById('atStudentTable').addEventListener('click',e=>{
  const btn=e.target.closest('.stu-link');
  if(btn) showStudentAttModal(btn.dataset.stuId);
});
document.getElementById('atStuModalClose').onclick=closeAttStudentModal;
document.getElementById('atStuModal').addEventListener('click',e=>{
  if(e.target.id==='atStuModal') closeAttStudentModal();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeAttStudentModal();
});
syncAttDetailLock();

// ---- data loading (region / year aware) ----
const fRegion=document.getElementById('fRegion'), fYear=document.getElementById('fYear');
let CAT={regions:[],years:{},files:{}};
const sel={region:null, year:null};

function fillSelect(el,vals){const cur=el.value;el.innerHTML='<option value="ALL">All</option>'+vals.map(v=>`<option>${v}</option>`).join('');el.value=[...el.options].some(o=>o.value===cur)?cur:'ALL';}
function refreshGradeOptions(){
  const grades=state.level==='ALL'?ALL_GRADES:ALL_GRADES.filter(g=>gradeLevelOf(g)===state.level);
  fillSelect(fGrade, grades);
  state.grade=fGrade.value;
}

function fillPlain(el,vals,current){
  el.innerHTML=vals.map(v=>`<option>${v}</option>`).join('');
  el.value=vals.includes(current)?current:(vals[0]||'');
}
function prettyRegion(r){
  if(!r) return '';
  return String(r).split(/[-_\s]+/).filter(Boolean)
    .map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
}
function fillRegion(el,vals,current){
  el.innerHTML=vals.map(v=>`<option value="${v}">${prettyRegion(v)}</option>`).join('');
  el.value=vals.includes(current)?current:(vals[0]||'');
}

function populateRegionYear(){
  fillRegion(fRegion, CAT.regions, sel.region);
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
  const ds=(meta.region?`<b>${prettyRegion(meta.region)}</b> · <b>${meta.year}</b> — `:'');
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
  DATA_BY_YEAR={};
  if(!chartLibOk()){
    showBanner('Chart.js did not load. Open the dashboard via <b>python3 serve.py</b> (not the HTML file directly) and hard-refresh.', true);
  }
  try{
    const qs=(sel.region&&sel.year)?`?region=${encodeURIComponent(sel.region)}&year=${encodeURIComponent(sel.year)}`:'';
    const res=await fetch('/api/data'+qs,{cache:'no-store',credentials:'same-origin'});
    if(!res.ok) throw new Error('server returned '+res.status);
    const payload=await res.json();
    if(payload.error) throw new Error(payload.error);
    const meta=payload.meta||{};
    CAT=meta.catalog||{regions:[],years:{},files:{}};
    if(meta.region) sel.region=meta.region;
    if(meta.year) sel.year=meta.year;
    populateRegionYear();

    DATA=scrubData({access:payload.access||[],registration:payload.registration||[],
          attendance:payload.attendance||[],holidays:payload.holidays||[],
          students:payload.students||[],studentAttendance:payload.studentAttendance||[],
          studentAttendanceRecords:payload.studentAttendanceRecords||[],
          duplicates:payload.duplicates||{available:false,students:0,extraEnrollments:0,uniqueStudents:0,details:[]}});
    const sessionEntries=payload.sessionSchedule&&payload.sessionSchedule.entries;
    initSessionSchedule(sessionEntries);
    indexStudentRecords();
    HOLIDAYS=new Set(DATA.holidays);
    MISSING=computeMissing(DATA.attendance, HOLIDAYS, DATA.registration);

    // Prior year (same region) for KPI comparisons — years list is newest-first
    const years=CAT.years[sel.region]||[];
    const yi=years.indexOf(sel.year);
    PREV_YEAR=(yi>=0 && yi<years.length-1)?years[yi+1]:null;
    DATA_PREV=null; MISSING_PREV=[];
    if(PREV_YEAR){
      try{
        const pqs=`?region=${encodeURIComponent(sel.region)}&year=${encodeURIComponent(PREV_YEAR)}`;
        const pres=await fetch('/api/data'+pqs,{cache:'no-store',credentials:'same-origin'});
        if(pres.ok){
          const pp=await pres.json();
          if(!pp.error){
            initSessionSchedule(pp.sessionSchedule&&pp.sessionSchedule.entries);
            DATA_PREV=scrubData({access:pp.access||[],registration:pp.registration||[],
              attendance:pp.attendance||[],holidays:pp.holidays||[],
              students:pp.students||[],studentAttendance:pp.studentAttendance||[],
              studentAttendanceRecords:pp.studentAttendanceRecords||[],
              duplicates:pp.duplicates||{available:false,students:0,extraEnrollments:0,uniqueStudents:0,details:[]}});
            MISSING_PREV=computeMissing(DATA_PREV.attendance, new Set(DATA_PREV.holidays), DATA_PREV.registration);
            initSessionSchedule(sessionEntries);
          }
        }
      }catch(_){ DATA_PREV=null; MISSING_PREV=[]; PREV_YEAR=null; }
    }

    const allLoc=uniq([...DATA.registration.map(r=>r.loc),...DATA.attendance.map(a=>a.loc),...DATA.access.map(a=>a.loc)].filter(Boolean));
    ALL_GRADES=uniq([...DATA.registration.map(r=>r.grade),...DATA.attendance.map(a=>a.grade),...DATA.access.map(a=>a.grade)].filter(Boolean))
      .sort((a,b)=>{let ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
    fillSelect(fLoc,allLoc);
    state.loc=fLoc.value; state.level=fLevel.value;
    refreshGradeOptions();
    populateAttDetailFilters();
    cacheYearDataset(sel.year, {
      attendance:DATA.attendance,
      grades:ALL_GRADES,
      locs:allLoc,
      dateMin:uniq(DATA.attendance.map(a=>a.date)).sort()[0]||null,
      dateMax:uniq(DATA.attendance.map(a=>a.date)).sort().slice(-1)[0]||null,
    });
    bindAttCompare();
    await setupAttCompareDefaults();
    if(current==='attendance') void renderAttCompare();
    setStatus(meta);

    const present=['access','registration','attendance'].filter(k=>meta.files&&meta.files[k]);
    const miss=['access','registration','attendance'].filter(k=>!(meta.files&&meta.files[k]));
    if(!CAT.regions.length){
      showBanner('No datasets found. Organise exports as <b>data/&lt;region&gt;/&lt;year&gt;/*.csv</b> (e.g. data/central/2025-2026/), then click Refresh.',true);
    } else if(!present.length){
      showBanner('No report files found for <b>'+prettyRegion(sel.region)+' · '+sel.year+'</b>. Add the exports to that folder and Refresh.',true);
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
