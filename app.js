// Central de Controle Anatômico – IDOMED · v2
// SUPABASE_URL e SUPABASE_KEY vêm de config.js
// Indicador de salvamento: acompanha cada gravação enviada ao Supabase
let syncPend=0, syncErr=false, syncLast=null;
function syncShow(){
  const b=el('sync'); if(!b) return;
  const t=syncPend?'Salvando na nuvem…':syncErr?'Erro ao salvar — confira a conexão':syncLast?'Tudo salvo na nuvem · '+syncLast.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'Conectado à nuvem';
  b.className='sync'+(syncPend?' busy':syncErr?' err':''); el('sync-t').textContent=t;
}
async function trackFetch(input,init){
  const url=typeof input==='string'?input:input.url, method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
  const write=method!=='GET'&&method!=='HEAD'&&!/\/auth\/v1\//.test(url)&&!/\/object\/sign\//.test(url);
  if(!write) return fetch(input,init);
  syncPend++; syncShow();
  try{ const r=await fetch(input,init); syncErr=!r.ok; if(r.ok) syncLast=new Date(); return r; }
  catch(e){ syncErr=true; throw e; }
  finally{ syncPend--; syncShow(); }
}
window.addEventListener('beforeunload',e=>{if(syncPend>0){e.preventDefault();e.returnValue='';}});
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {global:{fetch:trackFetch}});

const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const NUM = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const money = v => BRL.format(isFinite(v)?v:0);
const pct = v => NUM.format(isFinite(v)?v:0)+'%';
const esc = s => (s??'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv');
const el = id => document.getElementById(id);
const TRASH = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const cod = c => c? ((c.codigo_final||'').trim()||c.nome||'—') : '—';   // identificador principal = código final
const semFinal = c => c && !(c.codigo_final||'').trim();
const byCod = (a,b) => cod(a).localeCompare(cod(b),'pt-BR',{numeric:true});
const sortPt = arr => [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

let unidades=[], resumo={}, cur=null;
let corpos=[], procs=[], aulas=[], sessoes=[], anexos=[];
let applied={};          // aula.id -> {nominal, aplicado, capped}
let curPeca=null;        // id da peça aberta na ficha (null = nova)
let lines=[];            // linhas do formulário de novo dia de aula
let anexoMode='link', anexoFiltro='';

const SUG = {
  especime:['Corpo inteiro','Cabeça','Cabeça e pescoço','Tronco','Tronco e cabeça','Tórax','Abdome','Pelve','Membro superior','Ombro','Braço','Antebraço e cotovelo','Mão e punho','Membro inferior','Quadril','Joelho','Perna','Pé'],
  processamento:['Fresca','Fresh frozen','Dissecada','Formolizada','Thiel','Plastinada','Glicerinada'],
  etnia:['Caucasian','African American','Hispanic','Asian','Outra'],
};
const CATS=['Plano de aula','Documentos da unidade','Notas fiscais e contratos','Fotos e registros','Outros'];

// ---------- toast e erros ----------
let tt; function toast(msg,err){const t=el('toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(tt);tt=setTimeout(()=>t.className='toast',2800);}
function errMsg(e){
  if(!e) return '';
  const m=e.message||'';
  if(e.code==='23505') return 'Já existe um registro com esse nome.';
  if(e.code==='42501'||/row-level security|permission denied|JWT|not authorized|Unauthorized/i.test(m)) return 'Sem permissão. Sua sessão pode ter expirado: saia e entre de novo.';
  if(/procedimentos_previstos/.test(m)) return 'O calendário ainda não aceita vários tipos de prática. Rode o script atualizacao-v10.sql no Supabase.';
  if(/cadaver_agenda|pecas_previstas|alunos_previstos/.test(m)) return 'O calendário ainda não foi ativado. Rode o script atualizacao-v9-calendario.sql no Supabase.';
  if(/cadaver_nps_respostas|nps_token|nps_aberto_ate|nps_info|nps_responder/.test(m)) return 'As avaliações ainda não foram ativadas. Rode o script atualizacao-v8-avaliacoes.sql no Supabase.';
  if(/segmento/.test(m)) return 'O banco ainda não tem o campo de segmento. Rode o script atualizacao-v7-segmentos.sql no Supabase.';
  if(/cadaver_historico/.test(m)) return 'O histórico ainda não foi ativado. Rode o script atualizacao-v6-historico.sql no Supabase.';
  if(/desgaste_ideal/.test(m)) return 'O banco ainda não tem o campo de desgaste ideal. Rode o script atualizacao-v5.sql no Supabase.';
  if(/total_alunos/.test(m)) return 'O banco ainda não tem o campo de total de alunos. Rode o script atualizacao-v3.sql no Supabase.';
  if(/cadaver_sessoes|cadaver_anexos|sessao_id|codigo_final|especime|local_atual|uso_inicial|link_drive/.test(m)) return 'O banco ainda não tem a atualização v2. Rode o script atualizacao-v2.sql no Supabase.';
  if(/unidade_id|cadaver_unidades/.test(m)) return 'O banco ainda não tem a estrutura de unidades. Rode o script migracao-unidades.sql no Supabase.';
  if(/bucket/i.test(m)) return 'A pasta de anexos não existe no Supabase. Rode o script atualizacao-v2.sql.';
  return m;
}

// ---------- confirmação na própria página ----------
function ask({title,body,ok='Excluir',typeName}){
  return new Promise(res=>{
    const m=el('modal'), inp=el('m-input'), okb=el('m-ok');
    el('m-title').textContent=title; el('m-body').innerHTML=body; okb.textContent=ok;
    el('m-type').hidden=!typeName; inp.value='';
    if(typeName){el('m-name').textContent=typeName; okb.disabled=true; inp.oninput=()=>okb.disabled=inp.value.trim()!==typeName;}
    else okb.disabled=false;
    m.hidden=false; (typeName?inp:el('m-cancel')).focus();
    const done=v=>{m.hidden=true;document.removeEventListener('keydown',key,true);res(v);};
    const key=e=>{if(e.key==='Escape'){e.stopPropagation();done(false);}};
    document.addEventListener('keydown',key,true);
    okb.onclick=()=>done(true); el('m-cancel').onclick=()=>done(false);
    m.onclick=e=>{if(e.target===m)done(false);};
  });
}

// ================= UNIDADES =================
async function bootUnits(){
  const r=await db.from('cadaver_unidades').select('*').order('created_at');
  if(r.error){
    showSetup('Não foi possível ler a lista de unidades ('+esc(r.error.message)+'). Confira se o script migracao-unidades.sql foi rodado no mesmo projeto do Supabase que está em config.js.');
    el('ugrid').innerHTML=''; return;
  }
  unidades=r.data||[];
  await loadResumo();
  renderUnits();
}
function showSetup(html){const s=el('setup');s.innerHTML='<b>Atenção.</b> '+html;s.hidden=false;}
async function loadResumo(){
  resumo={};
  const [c,s]=await Promise.all([
    db.from('cadaver_corpos').select('unidade_id,valor'),
    db.from('cadaver_sessoes').select('unidade_id')
  ]);
  if(c.error){showSetup(esc(errMsg(c.error)));return;}
  const r=id=>resumo[id]??={pecas:0,valor:0,dias:0};
  c.data.forEach(x=>{const o=r(x.unidade_id);o.pecas++;o.valor+=Number(x.valor||0);});
  if(!s.error) s.data.forEach(x=>r(x.unidade_id).dias++);
}
function renderUnits(){
  const cards=unidades.map(u=>{
    const s=resumo[u.id]||{pecas:0,valor:0,dias:0};
    return `<article class="ucard">
      <button class="icon del" title="Excluir unidade" aria-label="Excluir ${esc(u.nome)}" onclick="delUnit('${u.id}')">${TRASH}</button>
      <button class="open" onclick="openUnit('${u.id}')">
        <div class="uname"><small>Unidade</small>${esc(u.nome)}</div>
        <div class="ustats">
          <div><b>${s.pecas}</b><span>peças</span></div>
          <div><b>${s.dias}</b><span>dias de aula</span></div>
          <div><b>${s.valor>=1e5?NUM.format(Math.round(s.valor/1000))+' mil':NUM.format(Math.round(s.valor))}</b><span>R$ em acervo</span></div>
        </div>
      </button>
      <div class="go" aria-hidden="true">Abrir unidade <span>→</span></div>
    </article>`;}).join('');
  el('ugrid').innerHTML=cards+`
    <form class="uadd" onsubmit="addUnit(event)">
      <h3>Nova unidade</h3>
      <p>Adicione outra unidade IDOMED. Ela começa vazia, com acervo e tipos de aula próprios.</p>
      <div class="row"><input id="nu-nome" placeholder="ex.: IDOMED Juazeiro" aria-label="Nome da nova unidade"><button class="btn green" type="submit">Adicionar</button></div>
    </form>`;
}
async function addUnit(ev){
  ev.preventDefault();
  const nome=el('nu-nome').value.trim();
  if(!nome){toast('Digite o nome da unidade.',true);return;}
  const {data,error}=await db.from('cadaver_unidades').insert({nome}).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  unidades.push(data); renderUnits(); toast('Unidade adicionada.');
}
async function delUnit(id){
  const u=unidades.find(x=>x.id===id); if(!u)return;
  const s=resumo[id]||{pecas:0,dias:0};
  const vazio=!s.pecas&&!s.dias;
  const ok=await ask({
    title:'Excluir '+u.nome+'?',
    body: vazio? 'A unidade não tem peças nem aulas cadastradas.'
      : `Isso apaga também <b>${s.pecas} peça(s)</b>, <b>${s.dias} dia(s) de aula</b>, os anexos e os tipos de aula desta unidade. Não dá para desfazer.`,
    ok:'Excluir unidade', typeName: vazio? null : u.nome
  });
  if(!ok)return;
  const {error}=await db.from('cadaver_unidades').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  unidades=unidades.filter(x=>x.id!==id); delete resumo[id]; renderUnits(); toast('Unidade excluída.');
}
async function goUnits(){
  cur=null; el('view-unit').hidden=true; el('view-units').hidden=false;
  document.title='Central de Controle Anatômico – IDOMED';
  window.scrollTo(0,0);
  await loadResumo(); renderUnits();
}
async function openUnit(id){
  const u=unidades.find(x=>x.id===id); if(!u)return;
  cur=u;
  el('view-units').hidden=true; el('view-unit').hidden=false;
  el('u-name').textContent=u.nome;
  document.title=u.nome+' · Central de Controle Anatômico';
  el('u-switch').innerHTML=unidades.map(x=>`<option value="${x.id}" ${x.id===id?'selected':''}>${esc(x.nome)}</option>`).join('');
  ['f-de','f-ate','np-nome','np-pct','np-desc','pc-busca','ns-curso','ns-obs','ns-alunos','ax-titulo','ax-url','ax-desc'].forEach(i=>el(i).value='');
  el('ns-data').value=today(); el('ax-file').value=''; anexoFiltro='';
  lines=[newLine()];
  showTab('pecas');
  corpos=[];procs=[];aulas=[];sessoes=[];anexos=[];respostas=[];agenda=[];avAll=null;calInit(); renderAll();
  const {error}=await load();
  if(error){toast('Erro ao carregar: '+errMsg(error),true);}
  if(cur&&cur.id===id) renderAll();
}

// ---------- abas ----------
function showTab(t){
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id==='tab-'+t));
  if(t==='rel'){ renderDash(); renderRel(); }
  if(t==='hist') loadHist();
  if(t==='aval') renderAval();
  if(t==='cal') renderCal();
}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

// ---------- cálculo ----------
const corpoById = id => corpos.find(c=>c.id===id);
const procById = id => procs.find(p=>p.id===id);
const sessById = id => sessoes.find(s=>s.id===id);
const pctAluno = a => { const p=procById(a.procedimento_id); return p? Number(p.pct_por_aluno||0) : 0; };
const nominalAula = a => pctAluno(a)*Number(a.num_alunos||0);
const usoPrevio = c => Math.min(Math.max(Number(c.uso_inicial||0),0),100);
// Percorre os usos de cada peça em ordem de data e aplica o teto de 100% (o uso prévio já conta).
function recompute(){
  applied={};
  corpos.forEach(c=>{
    const list=aulas.filter(a=>a.corpo_id===c.id)
      .sort((x,y)=>((x.data||'')+(x.created_at||'')).localeCompare((y.data||'')+(y.created_at||'')));
    let acc=usoPrevio(c);
    list.forEach(a=>{
      const nominal=nominalAula(a), room=Math.max(100-acc,0), ap=Math.min(nominal,room);
      applied[a.id]={nominal, aplicado:ap, capped: nominal>ap+1e-9};
      acc+=ap;
    });
  });
}
const depAula = a => (applied[a.id]||{}).aplicado||0;
const custoAula = a => { const c=corpoById(a.corpo_id); return c? Number(c.valor||0)*depAula(a)/100 : 0; };
const custoAluno = a => a.num_alunos>0? custoAula(a)/a.num_alunos : 0;
const pctAulas = id => aulas.filter(a=>a.corpo_id===id).reduce((s,a)=>s+depAula(a),0);
const pctDoCorpo = id => { const c=corpoById(id); return (c?usoPrevio(c):0)+pctAulas(id); };
const custoUsadoCorpo = c => Number(c.valor||0)*pctAulas(c.id)/100;
const residualCorpo = c => Math.max(Number(c.valor||0)*(100-pctDoCorpo(c.id))/100,0);
const usosDoCorpo = id => aulas.filter(a=>a.corpo_id===id);
function nivel(p){return p>=90?'hot':p>=60?'mid':'ok';}
function rotulo(p){const lv=nivel(p);return p>=100?'esgotada':lv==='hot'?'quase esgotada':lv==='mid'?'em uso':p>0?'em uso':'nova';}

// ---------- carga ----------
async function load(){
  const uid=cur.id;
  const [r1,r2,r3,r4,r5,r6,r7]=await Promise.all([
    db.from('cadaver_corpos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_procedimentos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_aulas').select('*').eq('unidade_id',uid).order('data'),
    db.from('cadaver_sessoes').select('*').eq('unidade_id',uid).order('data',{ascending:false}),
    db.from('cadaver_anexos').select('*').eq('unidade_id',uid).order('created_at',{ascending:false}),
    db.from('cadaver_nps_respostas').select('*').eq('unidade_id',uid).order('created_at',{ascending:false}),
    db.from('cadaver_agenda').select('*').eq('unidade_id',uid).order('data')
  ]);
  if(!cur||cur.id!==uid) return {};
  const e=r1.error||r2.error||r3.error;
  if(e) return {error:e};
  corpos=r1.data||[]; procs=r2.data||[]; aulas=r3.data||[];
  sessoes=r4.error?[]:(r4.data||[]); anexos=r5.error?[]:(r5.data||[]);
  respostas=r6.error?[]:(r6.data||[]); respErr=r6.error||null; avAll=null;
  agenda=r7.error?[]:(r7.data||[]); agendaErr=r7.error||null;
  await signAnexos();
  if(r4.error||r5.error) return {error:r4.error||r5.error};
  return {};
}
function renderAll(){
  avAll=null;
  recompute(); fillLists(); fillSelects();
  renderPecas(); renderLines(); renderAulas(); renderAnexos(); renderProcs(); renderSim();
  if(el('tab-rel').classList.contains('active')){ renderDash(); renderRel(); }
  if(el('tab-cal').classList.contains('active')) renderCal();
  if(!el('pmodal').hidden && curPeca && corpoById(curPeca)) fillPecaCalc();
}
function fillLists(){
  const put=(id,vals)=>{el(id).innerHTML=sortPt(vals).map(v=>`<option value="${esc(v)}"></option>`).join('');};
  put('dl-especime',[...SUG.especime,...corpos.map(c=>c.especime)]);
  put('dl-proc',[...SUG.processamento,...corpos.map(c=>c.processamento)]);
  put('dl-etnia',[...SUG.etnia,...corpos.map(c=>c.etnia)]);
  put('dl-local',corpos.map(c=>c.local_atual));
  put('dl-forn',corpos.map(c=>c.fornecedor));
  put('dl-resp',sessoes.map(s=>s.responsavel));
  put('dl-curso',sessoes.map(s=>s.curso));
}
function fillSelects(){
  const nomeP=c=>esc(cod(c))+(semFinal(c)?' (sem cód. final)':'')+(segLabel(c)?' · '+esc(segLabel(c)):'');
  const optC=[...corpos].sort(byCod).map(c=>`<option value="${c.id}">${nomeP(c)}</option>`).join('');
  const optP=procs.map(p=>`<option value="${p.id}">${esc(p.nome)} (${pct(p.pct_por_aluno)}/aluno)</option>`).join('');
  const optR=sortPt(sessoes.map(s=>s.responsavel)).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const keep=(id,html,first)=>{const s=el(id),v=s.value;s.innerHTML=first+html;if([...s.options].some(o=>o.value===v))s.value=v;};
  keep('f-corpo',optC,'<option value="">Todas</option>');
  keep('f-proc',optP,'<option value="">Todos</option>');
  keep('f-resp',optR,'<option value="">Todos</option>');
  keep('sim-corpo',optC,'<option value="">selecione</option>');
  keep('sim-proc',optP,'<option value="">selecione</option>');
}

// ================= PEÇAS =================
const PF=[
  {k:'codigo_final',l:'Código final (identificador)',main:1},
  {k:'nome',l:'Código original',req:1},
  {k:'especime',l:'Espécimen',list:'dl-especime'},
  {k:'local_atual',l:'Local atual',list:'dl-local'},
  {k:'processamento',l:'Processamento',list:'dl-proc'},
  {k:'__uso',l:'Σ uso',calc:1},
  {k:'invoice',l:'Invoice'},
  {k:'__qtd',l:'Qtd. usos',calc:1},
  {k:'fornecedor',l:'Fornecedor',list:'dl-forn'},
  {k:'sexo',l:'Sexo',opts:[['','—'],['F','F'],['M','M']]},
  {k:'idade',l:'Idade',type:'number',step:'1'},
  {k:'etnia',l:'Etnia',list:'dl-etnia'},
  {k:'data_aquisicao',l:'Data de chegada',type:'date'},
  {k:'valor',l:'Valor original de compra (R$)',type:'number',step:'0.01'},
  {k:'uso_inicial',l:'Uso prévio (%)',type:'number',step:'0.1',ph:'antes do sistema'},
  {k:'__res',l:'Valor residual',calc:1},
];
// ---------- segmentos ----------
const SEG={
  corpo_inteiro:{l:'Corpo inteiro',img:'seg-corpo-inteiro.png'},
  torso_cabeca:{l:'Torso com cabeça',img:'seg-torso-cabeca.png'},
  membro_superior:{l:'Membro superior',img:'seg-membro-superior.png'},
  membro_inferior:{l:'Membro inferior',img:'seg-membro-inferior.png'},
};
function segOf(c){
  if(c&&SEG[c.segmento]) return c.segmento;
  const e=((c&&c.especime)||'').toLowerCase();
  if(/inteiro/.test(e)) return 'corpo_inteiro';
  if(/membro sup|braço|braco|antebra|mão|mao|punho|ombro|cotovelo/.test(e)) return 'membro_superior';
  if(/membro inf|perna|pé\b|pe\b|joelho|quadril|coxa|tornozelo/.test(e)) return 'membro_inferior';
  if(/tronco|torso|cabe|tórax|torax|abdome|pelve|pescoço/.test(e)) return 'torso_cabeca';
  return '';
}
function segThumb(c,cls=''){const k=segOf(c);return k?`<span class="segimg ${cls}" title="${SEG[k].l}"><img src="${SEG[k].img}" alt="${SEG[k].l}"></span>`:`<span class="segimg none ${cls}" title="Segmento não definido">?</span>`;}
const segLabel=c=>{const k=segOf(c);return k?SEG[k].l:'';};
const keyOrig=c=>(c.nome||'').trim().toUpperCase();
let segFiltro='';
function setSegFiltro(k){segFiltro=k;renderPecas();}

function renderPecas(){
  const q=(el('pc-busca').value||'').trim().toLowerCase();
  const list=[...corpos].sort(byCod).filter(c=>(!segFiltro||segOf(c)===segFiltro)&&(!q||[c.nome,c.codigo_final,c.especime,c.local_atual,c.processamento,c.fornecedor,c.invoice,segLabel(c)].some(v=>(v||'').toLowerCase().includes(q))));
  const tot=corpos.reduce((s,c)=>s+Number(c.valor||0),0);
  const nOrig=new Set(corpos.map(keyOrig)).size;
  el('pc-resumo').innerHTML=corpos.length?
    `<button class="chip ${!segFiltro?'on':''}" onclick="setSegFiltro('')">Todas <b>${corpos.length}</b></button>`+
    Object.entries(SEG).map(([k,v])=>{const n=corpos.filter(c=>segOf(c)===k).length;return n?`<button class="chip segchip ${segFiltro===k?'on':''}" onclick="setSegFiltro('${k}')"><img src="${v.img}" alt="">${v.l} <b>${n}</b></button>`:'';}).join('')+
    `<span class="chip"><b>${nOrig}</b> código(s) de origem</span><span class="chip"><b>${money(tot)}</b> em acervo</span><span class="chip"><b>${money(corpos.reduce((s,c)=>s+residualCorpo(c),0))}</b> residual</span>`:'';
  const w=el('w-pecas');
  if(!corpos.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nenhuma peça cadastrada nesta unidade</b>Clique em “+ Nova peça” para cadastrar o primeiro corpo do acervo. Depois, use “+ Segmento deste corpo” para registrar cada parte separada dele.</div></div>';return;}
  if(!list.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nenhuma peça encontrada</b>Nenhuma peça corresponde à busca ou ao filtro.</div></div>';return;}
  const grupos=new Map();
  list.forEach(c=>{const k=keyOrig(c);if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(c);});
  const ordem=[...grupos.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR',{numeric:true}));
  const ORD=['corpo_inteiro','torso_cabeca','membro_superior','membro_inferior',''];
  w.innerHTML=ordem.map(([k,ls])=>{
    const todos=corpos.filter(c=>keyOrig(c)===k), f=todos[0];
    ls.sort((a,b)=>ORD.indexOf(segOf(a))-ORD.indexOf(segOf(b))||byCod(a,b));
    const vt=todos.reduce((s,c)=>s+Number(c.valor||0),0), rt=todos.reduce((s,c)=>s+residualCorpo(c),0);
    const meta=[f.fornecedor,[f.sexo==='F'?'♀ Fem.':f.sexo==='M'?'♂ Masc.':'',f.idade?f.idade+' anos':''].filter(Boolean).join(' · '),f.etnia,f.data_aquisicao?'chegou em '+fmtFull(f.data_aquisicao):'',f.invoice?'invoice '+f.invoice:''].filter(Boolean);
    return `<section class="orig">
      <header class="orig-h">
        <div class="orig-id"><small>Código original</small><b>${esc(f.nome||'—')}</b>${meta.length?`<span class="orig-meta">${esc(meta.join(' · '))}</span>`:''}</div>
        <div class="orig-sum"><span><b>${todos.length}</b> ${todos.length===1?'peça':'peças'}</span><span><b>${money(vt)}</b> valor</span><span><b>${money(rt)}</b> residual</span></div>
        <button class="btn ghost sm" onclick="novoSegmento('${esc(f.id)}')">+ Segmento deste corpo</button>
      </header>
      <div class="tablewrap flat"><table><thead><tr><th class="th-img"><span class="sr">Segmento</span></th><th>Código final</th><th>Segmento</th><th>Espécimen</th><th>Processamento</th><th>Local atual</th><th class="n">Valor</th><th>Σ uso</th><th>Status</th><th>Drive</th></tr></thead><tbody>`+
      ls.map(c=>{const p=pctDoCorpo(c.id), lv=nivel(p);
        return `<tr class="click" onclick="openPeca('${c.id}')" tabindex="0" onkeydown="if(event.key==='Enter')openPeca('${c.id}')">
          <td class="td-img">${segThumb(c)}</td>
          <td><span class="code">${esc(cod(c))}</span>${semFinal(c)?'<span class="sub warn-t">sem código final</span>':''}</td>
          <td>${esc(segLabel(c)||'—')}</td>
          <td>${esc(c.especime||'—')}</td>
          <td>${esc(c.processamento||'—')}</td>
          <td>${esc(c.local_atual||'—')}</td>
          <td class="n">${money(c.valor)}</td>
          <td><div class="uso"><div class="bar"><i class="${lv}" style="width:${Math.min(p,100)}%"></i></div><span class="num">${pct(p)}</span></div></td>
          <td><span class="pill ${lv}">${rotulo(p)}</span></td>
          <td>${c.link_drive?`<a class="drive" href="${esc(safeUrl(c.link_drive))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Abrir ↗</a>`:'<span class="muted">—</span>'}</td>
        </tr>`;}).join('')+`</tbody></table></div></section>`;
  }).join('');
}
function novoSegmento(id){
  const f=corpoById(id); if(!f) return;
  const pre={}; ['nome','fornecedor','sexo','idade','etnia','data_aquisicao','invoice','processamento','local_atual'].forEach(k=>pre[k]=f[k]);
  openPeca(null,pre);
}
function safeUrl(u){u=(u||'').trim();if(!u)return'';if(!/^https?:\/\//i.test(u))u='https://'+u;return u;}
function openPeca(id,pre){
  curPeca=id; const c=id?corpoById(id):(pre||{});
  pickSeg(id?segOf(c):'');
  el('pf-grid').innerHTML=PF.map(f=>{
    if(f.calc) return `<div class="field"><label>${f.l}</label><div class="calcv" id="pf-${f.k}">—</div></div>`;
    const v=c[f.k]??'';
    let inp;
    if(f.opts) inp=`<select id="pf-${f.k}">${f.opts.map(([val,lab])=>`<option value="${val}" ${String(v)===val?'selected':''}>${lab}</option>`).join('')}</select>`;
    else inp=`<input id="pf-${f.k}" type="${f.type||'text'}" ${f.step?`step="${f.step}" min="0"`:''} ${f.list?`list="${f.list}"`:''} value="${esc(v)}" placeholder="${esc(f.ph||'')}">`;
    return `<div class="field ${f.req?'req':''} ${f.main?'main':''}"><label for="pf-${f.k}">${f.l}</label>${inp}</div>`;
  }).join('');
  el('pf-link_drive').value=c.link_drive||'';
  el('pf-del').hidden=!id; el('pf-hist-wrap').hidden=!id; el('pf-ringwrap').hidden=!id;
  el('pf-link_drive').oninput=updDrive; updDrive();
  const tit=()=>{el('pf-title').textContent=el('pf-codigo_final').value.trim()||el('pf-nome').value.trim()||'Nova peça';};
  el('pf-nome').oninput=tit; el('pf-codigo_final').oninput=tit;
  if(pre) el('pf-codigo_final').oninput=()=>{el('pf-title').textContent=el('pf-codigo_final').value.trim()||'Novo segmento de '+(pre.nome||'');};
  el('pf-title').textContent=id?cod(c):pre?'Novo segmento de '+(pre.nome||''):'Nova peça';
  fillPecaCalc();
  el('pmodal').hidden=false; el('pmodal').scrollTop=0;
  document.body.style.overflow='hidden';
  setTimeout(()=>el('pf-codigo_final').focus(),30);
}
let pfSeg='';
function pickSeg(k){
  pfSeg=k||'';
  el('pf-seg').innerHTML=Object.entries(SEG).map(([key,v])=>`<button type="button" role="radio" aria-checked="${pfSeg===key}" class="segopt ${pfSeg===key?'on':''}" onclick="pickSeg('${key}')"><img src="${v.img}" alt=""><span>${v.l}</span></button>`).join('');
  const hi=el('pf-segimg'); if(hi) hi.innerHTML=pfSeg?`<img src="${SEG[pfSeg].img}" alt="${SEG[pfSeg].l}">`:'';
  if(hi) hi.hidden=!pfSeg;
}
function updDrive(){const u=safeUrl(el('pf-link_drive').value);const a=el('pf-drive-open');a.hidden=!u;if(u)a.href=u;}
function fillPecaCalc(){
  const c=curPeca?corpoById(curPeca):null;
  const tags=c?(semFinal(c)?'<span class="tag warn">sem código final</span>':`<span class="tag n">original: ${esc(c.nome)}</span>`)+[c.especime,c.local_atual,c.processamento].filter(Boolean).map(t=>`<span class="tag">${esc(t)}</span>`).join('')+(c.sexo?`<span class="tag n">${c.sexo==='F'?'♀ Fem.':'♂ Masc.'}</span>`:''):'';
  el('pf-tags').innerHTML=tags;
  if(!c){['__uso','__qtd','__res'].forEach(k=>el('pf-'+k).textContent='—');return;}
  const p=pctDoCorpo(c.id), us=usosDoCorpo(c.id);
  el('pf-__uso').textContent=pct(p); el('pf-__qtd').textContent=us.length; el('pf-__res').textContent=money(residualCorpo(c));
  const r=el('pf-ring'); r.className='ring '+nivel(p); r.style.setProperty('--p',Math.min(p,100)); el('pf-ringv').textContent=NUM.format(Math.round(Math.min(p,100)))+'%';
  const list=[...us].sort((a,b)=>((a.data||'')+(a.created_at||'')).localeCompare((b.data||'')+(b.created_at||'')));
  const w=el('pf-hist');
  if(!list.length){w.innerHTML='<div class="empty"><b>Sem usos ainda</b>Os usos aparecem aqui quando a peça é lançada na aba Aulas.</div>';return;}
  w.innerHTML='<table><thead><tr><th>#</th><th>Curso</th><th>Data</th><th>Tipo de aula</th><th class="n">Alunos</th><th>Responsável</th><th>Observações</th><th class="n">% uso</th><th class="n">Custo</th></tr></thead><tbody>'+
    (usoPrevio(c)>0?`<tr><td><span class="idx">0</span></td><td colspan="6" class="muted">Uso prévio, antes do registro no sistema</td><td class="n"><span class="pct ${nivel(usoPrevio(c))}">${pct(usoPrevio(c))}</span></td><td class="n muted">—</td></tr>`:'')+
    list.map((a,i)=>{const s=sessById(a.sessao_id)||{},pr=procById(a.procedimento_id),d=depAula(a);
      return `<tr><td><span class="idx">${i+1}</span></td><td>${esc(s.curso||'—')}</td><td>${fmtFull(a.data)}</td><td>${esc(pr?pr.nome:'sem tipo')}</td><td class="n">${a.num_alunos}</td><td>${esc(s.responsavel||'—')}</td><td>${esc(s.observacao||'')}</td><td class="n"><span class="pct ${d>=50?"hot":d>=20?"mid":"ok"}">${pct(d)}</span>${(applied[a.id]||{}).capped?' <span class="pill hot">esgotada</span>':''}</td><td class="n">${money(custoAula(a))}</td></tr>`;}).join('')+'</tbody></table>';
}
function closePeca(){el('pmodal').hidden=true;document.body.style.overflow='';curPeca=null;}
el('pmodal').addEventListener('click',e=>{if(e.target===el('pmodal'))closePeca();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('pmodal').hidden&&el('modal').hidden)closePeca();});
async function savePeca(){
  const row={};
  PF.filter(f=>!f.calc).forEach(f=>{
    let v=el('pf-'+f.k).value.trim();
    if(f.type==='number') v=v===''?null:Number(v);
    else v=v||null;
    row[f.k]=v;
  });
  row.link_drive=el('pf-link_drive').value.trim()?safeUrl(el('pf-link_drive').value):null;
  row.segmento=pfSeg||null;
  if(!row.segmento){toast('Escolha o segmento da peça (corpo inteiro, torso, membro superior ou inferior).',true);return;}
  if(!row.nome){toast('Preencha o código original da peça.',true);el('pf-nome').focus();return;}
  row.valor=row.valor||0; row.uso_inicial=Math.min(Math.max(row.uso_inicial||0,0),100);
  if(row.idade!=null) row.idade=Math.round(row.idade);
  if(curPeca){
    const {error}=await db.from('cadaver_corpos').update(row).eq('id',curPeca);
    if(error){toast('Erro ao salvar: '+errMsg(error),true);return;}
    Object.assign(corpoById(curPeca),row);
    toast('Peça salva.');
  }else{
    row.unidade_id=cur.id; row.unidade=cur.nome;
    const {data,error}=await db.from('cadaver_corpos').insert(row).select().single();
    if(error){toast('Erro: '+errMsg(error),true);return;}
    corpos.push(data); toast('Peça cadastrada.');
  }
  closePeca(); renderAll();
}
async function delCorpo(id){
  const c=corpoById(id), n=usosDoCorpo(id).length;
  const ok=await ask({title:'Excluir a peça '+cod(c)+'?', body: n? `Os <b>${n} uso(s)</b> desta peça nas aulas também serão apagados.` : 'Esta peça não tem usos registrados.'});
  if(!ok)return;
  const {error}=await db.from('cadaver_corpos').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  corpos=corpos.filter(c=>c.id!==id); aulas=aulas.filter(a=>a.corpo_id!==id);
  closePeca(); renderAll(); toast('Peça excluída.');
}

// ================= AULAS (dias de aula) =================
function newLine(){return {corpo:'',proc:'',alunos:''};}
function addLine(){lines.push(newLine());renderLines();}
function rmLine(i){lines.splice(i,1);if(!lines.length)lines.push(newLine());renderLines();}
function setLine(i,k,v){lines[i][k]=v;updLinePrev(i);updTotal();}
function linePrev(l){
  const c=corpoById(l.corpo),p=procById(l.proc),n=Number(l.alunos||0);
  if(!c||!p||!(n>0)) return {html:'—',custo:0,warn:false};
  const dep=Number(p.pct_por_aluno)*n, rest=Math.max(100-pctDoCorpo(c.id),0), ap=Math.min(dep,rest), custo=Number(c.valor||0)*ap/100;
  return {html:`<b>${money(custo)}</b> · ${pct(ap)}${dep>rest+1e-9?' (peça esgota)':''}`,custo,warn:dep>rest+1e-9};
}
function renderLines(){
  const optC=[...corpos].sort(byCod).map(c=>[c.id,cod(c)+(semFinal(c)?' (sem cód. final)':'')+(segLabel(c)?' · '+segLabel(c):'')+(c.especime&&c.especime!==segLabel(c)?' · '+c.especime:'')+(pctDoCorpo(c.id)>=100?' (esgotada)':'')]);
  const optP=procs.map(p=>[p.id,`${p.nome} (${pct(p.pct_por_aluno)}/aluno)`]);
  const sel=(opts,v,ph)=>`<option value="">${ph}</option>`+opts.map(([id,t])=>`<option value="${id}" ${id===v?'selected':''}>${esc(t)}</option>`).join('');
  el('ns-lines').innerHTML=(!corpos.length||!procs.length)?`<div class="warnbox">${!corpos.length?'Cadastre as peças na aba <b>Peças</b>':''}${!corpos.length&&!procs.length?' e ':''}${!procs.length?(corpos.length?'Cadastre ':'')+'os tipos de aula na aba <b>Depreciação</b>':''} para poder registrar aulas.</div>`:
    lines.map((l,i)=>`<div class="line">
      <span class="idx">${i+1}</span>
      <select aria-label="Peça ${i+1}" onchange="setLine(${i},'corpo',this.value)">${sel(optC,l.corpo,'Peça…')}</select>
      <select aria-label="Tipo de aula ${i+1}" onchange="setLine(${i},'proc',this.value)">${sel(optP,l.proc,'Tipo de aula…')}</select>
      <input class="w-al" type="number" min="1" step="1" placeholder="Alunos" aria-label="Alunos na peça ${i+1}" value="${esc(l.alunos)}" oninput="setLine(${i},'alunos',this.value)">
      <span class="prev" id="lp-${i}"></span>
      <button class="icon" title="Remover peça" onclick="rmLine(${i})">${TRASH}</button>
    </div>`).join('');
  lines.forEach((_,i)=>updLinePrev(i)); updTotal();
}
function updLinePrev(i){const s=el('lp-'+i);if(!s)return;const r=linePrev(lines[i]);s.innerHTML=r.html;s.className='prev'+(r.warn?' warn':'');}
function updTotal(){
  const ok=lines.filter(l=>l.corpo&&l.proc&&Number(l.alunos)>0);
  const tot=ok.reduce((s,l)=>s+linePrev(l).custo,0);
  el('ns-total').innerHTML=ok.length?`${ok.length} peça(s) · custo estimado <b>${money(tot)}</b>`:'';
}
async function saveDia(){
  const data=el('ns-data').value, responsavel=el('ns-resp').value.trim();
  if(!data){toast('Informe a data da aula.',true);return;}
  if(!responsavel){toast('Informe o nome de quem está registrando a aula.',true);el('ns-resp').focus();return;}
  const total_alunos=parseInt(el('ns-alunos').value||0);
  if(!(total_alunos>0)){toast('Informe quantos alunos participaram da aula.',true);el('ns-alunos').focus();return;}
  const ok=lines.filter(l=>l.corpo||l.proc||l.alunos);
  if(!ok.length){toast('Adicione pelo menos uma peça usada na aula.',true);return;}
  const bad=ok.findIndex(l=>!(l.corpo&&l.proc&&Number(l.alunos)>0));
  if(bad>=0){toast(`Complete a peça ${lines.indexOf(ok[bad])+1}: peça, tipo de aula e nº de alunos.`,true);return;}
  const acima=ok.findIndex(l=>Number(l.alunos)>total_alunos);
  if(acima>=0){toast(`A peça ${lines.indexOf(ok[acima])+1} tem mais alunos que o total da aula (${total_alunos}).`,true);return;}
  const {data:s,error}=await db.from('cadaver_sessoes').insert({unidade_id:cur.id,data,curso:el('ns-curso').value.trim()||null,responsavel,total_alunos,observacao:el('ns-obs').value.trim()||null}).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  const rows=ok.map(l=>aulaRow(s,l.corpo,l.proc,parseInt(l.alunos)));
  const r=await db.from('cadaver_aulas').insert(rows).select();
  if(r.error){await db.from('cadaver_sessoes').delete().eq('id',s.id);toast('Erro: '+errMsg(r.error),true);return;}
  sessoes.unshift(s); aulas.push(...r.data);
  if(agLancar){const ag=agById(agLancar);if(ag&&ag.data===data){const u=await db.from('cadaver_agenda').update({status:'realizada'}).eq('id',agLancar);if(!u.error)ag.status='realizada';}agLancar=null;}
  lines=[newLine()]; el('ns-curso').value=''; el('ns-obs').value=''; el('ns-alunos').value='';
  renderAll(); toast('Dia de aula salvo com '+r.data.length+' peça(s).');
}
function aulaRow(s,corpo_id,procedimento_id,alunos){
  const p=procById(procedimento_id);
  return {sessao_id:s.id, unidade_id:cur.id, corpo_id, procedimento_id, procedimento:p?p.nome:null, data:s.data,
    campus:cur.nome, num_alunos:alunos, peso:p?Number(p.pct_por_aluno):0, pontos:p?Number(p.pct_por_aluno)*alunos:0};
}
const DOW=['dom','seg','ter','qua','qui','sex','sáb'];
const MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function renderAulas(){
  const w=el('w-aulas');
  const orf=aulas.filter(a=>!a.sessao_id||!sessById(a.sessao_id));
  const list=[...sessoes].sort((a,b)=>(b.data||'').localeCompare(a.data||'')||(b.created_at||'').localeCompare(a.created_at||''));
  if(!list.length&&!orf.length){w.innerHTML='<div class="empty"><b>Nenhum dia de aula registrado</b>Use o formulário acima para registrar o primeiro dia de aula.</div>';return;}
  w.innerHTML=list.map(s=>sessCard(s,aulas.filter(a=>a.sessao_id===s.id))).join('')+
    (orf.length?`<div class="sess"><div class="sess-h"><div class="dbadge"><b>—</b><span>sem dia</span></div><div><b>Usos sem dia de aula</b><div class="muted">Registros antigos que não estão ligados a um dia de aula.</div></div><div class="sess-sum"><b>${money(orf.reduce((t,a)=>t+custoAula(a),0))}</b></div></div>${linesTable(orf)}</div>`:'');
}
function sessCard(s,ls){
  const [y,m,d]=(s.data||'----').split('-'); const dt=s.data?new Date(s.data+'T12:00'):null;
  const tot=ls.reduce((t,a)=>t+custoAula(a),0), al=ls.reduce((t,a)=>Math.max(t,Number(a.num_alunos||0)),0);
  const optC=[...corpos].sort(byCod).map(c=>`<option value="${c.id}">${esc(cod(c))}${segLabel(c)?' · '+esc(segLabel(c)):''}</option>`).join('');
  const optP=procs.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  return `<article class="sess">
    <div class="sess-h">
      <div class="dbadge"><b>${d||'—'}</b><span>${dt?MESES[+m-1]+' '+y.slice(2)+' · '+DOW[dt.getDay()]:''}</span>
        <input type="date" value="${s.data||''}" aria-label="Alterar data" title="Alterar data" onchange="saveSess('${s.id}','data',this.value)"></div>
      <div class="sess-meta">
        <div class="field"><label>Curso ou turma</label><input list="dl-curso" value="${esc(s.curso||'')}" onchange="saveSess('${s.id}','curso',this.value)"></div>
        <div class="field"><label>Responsável</label><input list="dl-resp" value="${esc(s.responsavel||'')}" onchange="saveSess('${s.id}','responsavel',this.value)"></div>
        <div class="field"><label>Alunos na aula</label><input type="number" min="1" step="1" value="${s.total_alunos??''}" placeholder="—" onchange="saveSess('${s.id}','total_alunos',this.value)"></div>
        <div class="field"><label>Observações</label><input value="${esc(s.observacao||'')}" onchange="saveSess('${s.id}','observacao',this.value)"></div>
      </div>
      <div class="sess-sum"><b>${money(tot)}</b><span>${s.total_alunos?`<b class="al">${s.total_alunos}</b> aluno(s) · `:''}${ls.length} peça(s)</span><button class="icon" title="Excluir dia de aula" onclick="delSess('${s.id}')">${TRASH}</button></div>
    </div>
    ${npsStrip(s)}
    ${ls.length?linesTable(ls):'<div class="empty">Nenhuma peça neste dia.</div>'}
    <div class="sess-add">
      <select id="sa-c-${s.id}" aria-label="Peça"><option value="">+ Peça…</option>${optC}</select>
      <select id="sa-p-${s.id}" aria-label="Tipo de aula"><option value="">Tipo de aula…</option>${optP}</select>
      <input id="sa-n-${s.id}" type="number" min="1" step="1" placeholder="Alunos" aria-label="Alunos">
      <button class="btn ghost sm" onclick="addToSess('${s.id}')">Adicionar peça</button>
    </div>
  </article>`;
}
function linesTable(ls){
  const corpoOpts=sel=>[...corpos].sort(byCod).map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(cod(c))}</option>`).join('');
  const procOpts=sel=>'<option value="">sem tipo</option>'+procs.map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(p.nome)}</option>`).join('');
  return '<div class="tablewrap"><table><thead><tr><th>Peça</th><th>Tipo de aula</th><th class="n">Alunos na peça</th><th class="n">Depreciação</th><th class="n">Custo</th><th class="n">Custo/aluno</th><th></th></tr></thead><tbody>'+
    ls.map(a=>`<tr>
      <td><select aria-label="Peça" onchange="saveAula('${a.id}','corpo_id',this.value)">${corpoOpts(a.corpo_id)}</select></td>
      <td><select aria-label="Tipo de aula" onchange="saveAula('${a.id}','procedimento_id',this.value)">${procOpts(a.procedimento_id)}</select></td>
      <td class="n"><input class="w-int num" type="number" min="1" step="1" value="${a.num_alunos}" aria-label="Alunos" onchange="saveAula('${a.id}','num_alunos',this.value)"></td>
      <td class="n">${depCell(a)}</td>
      <td class="n calc">${money(custoAula(a))}</td>
      <td class="n">${money(custoAluno(a))}</td>
      <td><button class="icon" title="Remover esta peça do dia" onclick="delAula('${a.id}')">${TRASH}</button></td>
    </tr>`).join('')+'</tbody></table></div>';
}
function depCell(a){
  const s=applied[a.id]||{nominal:0,aplicado:0};
  if(!a.procedimento_id) return '<span class="pill hot">sem tipo</span>';
  if(s.capped) return `<span class="num">${pct(s.aplicado)}</span> <span class="pill hot" title="previsto ${pct(s.nominal)}, peça esgotada">esgotada</span>`;
  return `<span class="num">${pct(s.aplicado)}</span>`;
}
async function saveSess(id,field,val){
  const s=sessById(id); if(!s)return;
  val=(val??'').toString().trim()||null;
  if(field==='total_alunos'){val=parseInt(val||0);if(!(val>0)){toast('Informe um número de alunos maior que zero.',true);renderAulas();return;}}
  if(field==='data'&&!val){toast('A data não pode ficar vazia.',true);renderAulas();return;}
  if(field==='responsavel'&&!val){toast('O responsável não pode ficar vazio.',true);renderAulas();return;}
  const {error}=await db.from('cadaver_sessoes').update({[field]:val}).eq('id',id);
  if(error){toast('Erro ao salvar: '+errMsg(error),true);return;}
  s[field]=val;
  if(field==='data'){
    const r=await db.from('cadaver_aulas').update({data:val}).eq('sessao_id',id);
    if(r.error){toast('Erro ao salvar: '+errMsg(r.error),true);return;}
    aulas.forEach(a=>{if(a.sessao_id===id)a.data=val;});
  }
  renderAll(); toast('Salvo.');
}
async function delSess(id){
  const s=sessById(id), n=aulas.filter(a=>a.sessao_id===id).length;
  const ok=await ask({title:'Excluir o dia de aula de '+fmtFull(s.data)+'?', body:`Os <b>${n} uso(s) de peça</b> deste dia saem do histórico e dos custos.`});
  if(!ok)return;
  const {error}=await db.from('cadaver_sessoes').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  sessoes=sessoes.filter(x=>x.id!==id); aulas=aulas.filter(a=>a.sessao_id!==id);
  renderAll(); toast('Dia de aula excluído.');
}
async function addToSess(id){
  const s=sessById(id), c=el('sa-c-'+id).value, p=el('sa-p-'+id).value, n=parseInt(el('sa-n-'+id).value||0);
  if(!c||!p||!(n>0)){toast('Escolha a peça, o tipo de aula e o nº de alunos.',true);return;}
  const {data,error}=await db.from('cadaver_aulas').insert(aulaRow(s,c,p,n)).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  aulas.push(data); renderAll(); toast('Peça adicionada ao dia.');
}
async function saveAula(id,field,val){
  const a=aulas.find(x=>x.id===id); if(!a)return;
  if(field==='num_alunos') val=parseInt(val||0);
  if(field==='procedimento_id') val=val||null;
  a[field]=val;
  const p=procById(a.procedimento_id);
  const patch={[field]:val, procedimento:p?p.nome:null, peso:p?Number(p.pct_por_aluno):0, pontos:(p?Number(p.pct_por_aluno):0)*Number(a.num_alunos||0)};
  const {error}=await db.from('cadaver_aulas').update(patch).eq('id',id);
  if(error){toast('Erro ao salvar: '+errMsg(error),true);return;}
  renderAll(); toast('Salvo.');
}
async function delAula(id){
  const a=aulas.find(x=>x.id===id), c=a&&corpoById(a.corpo_id);
  const ok=await ask({title:'Remover esta peça do dia?', body: a? `${esc(cod(c))} · ${fmtFull(a.data)} · ${a.num_alunos} aluno(s). O custo sai dos totais.` : '', ok:'Remover'});
  if(!ok)return;
  const {error}=await db.from('cadaver_aulas').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  aulas=aulas.filter(a=>a.id!==id); renderAll(); toast('Peça removida do dia.');
}

// ================= ANEXOS =================
el('ax-cat').innerHTML=CATS.map(c=>`<option>${c}</option>`).join('');
function setAnexoMode(m){
  anexoMode=m;
  el('ax-m-link').classList.toggle('on',m==='link'); el('ax-m-arq').classList.toggle('on',m==='arquivo');
  el('ax-f-link').hidden=m!=='link'; el('ax-f-arq').hidden=m!=='arquivo';
}
el('ax-file').addEventListener('change',()=>{const f=el('ax-file').files[0];if(f&&!el('ax-titulo').value.trim())el('ax-titulo').value=f.name.replace(/\.[^.]+$/,'');});
function slug(s){return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9.]+/g,'-').replace(/^-+|-+$/g,'');}
function fmtSize(b){if(!b)return'';return b>=1048576?NUM.format(b/1048576)+' MB':NUM.format(Math.ceil(b/1024))+' KB';}
async function addAnexo(){
  const titulo=el('ax-titulo').value.trim(), categoria=el('ax-cat').value, descricao=el('ax-desc').value.trim()||null;
  const btn=el('ax-btn');
  let row={unidade_id:cur.id,titulo,categoria,descricao};
  if(anexoMode==='link'){
    const url=safeUrl(el('ax-url').value);
    if(!url){toast('Cole o endereço do link.',true);return;}
    if(!titulo){toast('Dê um título ao anexo.',true);return;}
    Object.assign(row,{tipo:'link',url});
  }else{
    const f=el('ax-file').files[0];
    if(!f){toast('Escolha um arquivo do computador.',true);return;}
    if(f.size>52428800){toast('O arquivo passa de 50 MB. Envie pelo Drive e cadastre como link.',true);return;}
    row.titulo=titulo||f.name;
    const path=`${cur.id}/${Date.now()}-${slug(f.name)}`;
    btn.disabled=true; btn.textContent='Enviando…';
    const up=await db.storage.from('anexos').upload(path,f,{contentType:f.type||undefined,upsert:false});
    btn.disabled=false; btn.textContent='Adicionar anexo';
    if(up.error){toast('Erro no envio: '+errMsg(up.error),true);return;}
    Object.assign(row,{tipo:'arquivo',url:'storage://anexos/'+path,arquivo_path:path,tamanho:f.size,mime:f.type||null});
  }
  const {data,error}=await db.from('cadaver_anexos').insert(row).select().single();
  if(error){ if(row.arquivo_path) await db.storage.from('anexos').remove([row.arquivo_path]); toast('Erro: '+errMsg(error),true);return;}
  anexos.unshift(data); await signAnexos(); ['ax-titulo','ax-url','ax-desc'].forEach(i=>el(i).value=''); el('ax-file').value='';
  renderAnexos(); toast('Anexo adicionado.');
}
async function delAnexo(id){
  const a=anexos.find(x=>x.id===id); if(!a)return;
  const ok=await ask({title:'Excluir “'+a.titulo+'”?', body: a.tipo==='arquivo'?'O arquivo é apagado do Supabase.':'Só o link é removido; o conteúdo original continua onde está.'});
  if(!ok)return;
  if(a.arquivo_path){const r=await db.storage.from('anexos').remove([a.arquivo_path]);if(r.error){toast('Erro: '+errMsg(r.error),true);return;}}
  const {error}=await db.from('cadaver_anexos').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  anexos=anexos.filter(x=>x.id!==id); renderAnexos(); toast('Anexo excluído.');
}
function ftype(a){
  if(a.tipo==='link') return /drive\.google|docs\.google/.test(a.url)?['lnk','DRIVE']:['lnk','LINK'];
  const n=(a.arquivo_path||'').toLowerCase(), m=a.mime||'';
  if(/pdf/.test(m)||n.endsWith('.pdf')) return ['pdf','PDF'];
  if(/word|document/.test(m)||/\.(docx?|odt|rtf)$/.test(n)) return ['doc','DOC'];
  if(/sheet|excel|csv/.test(m)||/\.(xlsx?|ods|csv)$/.test(n)) return ['xls','XLS'];
  if(/presentation|powerpoint/.test(m)||/\.(pptx?|odp)$/.test(n)) return ['img','PPT'];
  if(/^image\//.test(m)) return ['img','IMG'];
  return ['', (n.split('.').pop()||'ARQ').slice(0,4).toUpperCase()];
}
function setAnexoFiltro(c){anexoFiltro=c;renderAnexos();}
let signed={};
async function signAnexos(){
  const paths=anexos.filter(a=>a.arquivo_path&&!signed[a.arquivo_path]).map(a=>a.arquivo_path);
  if(!paths.length) return;
  const {data,error}=await db.storage.from('anexos').createSignedUrls(paths,60*60*8);
  if(error||!data) return;
  data.forEach(x=>{if(x.signedUrl)signed[x.path]=x.signedUrl;});
}
function anexoHref(a){return a.arquivo_path?(signed[a.arquivo_path]||'#'):a.url;}
function renderAnexos(){
  const cats=CATS.filter(c=>anexos.some(a=>a.categoria===c)).concat(sortPt(anexos.map(a=>a.categoria)).filter(c=>!CATS.includes(c)));
  el('ax-filtros').innerHTML=anexos.length?`<button class="chip ${!anexoFiltro?'on':''}" onclick="setAnexoFiltro('')">Todos <b>${anexos.length}</b></button>`+
    cats.map(c=>`<button class="chip ${anexoFiltro===c?'on':''}" onclick="setAnexoFiltro('${esc(c)}')">${esc(c)} <b>${anexos.filter(a=>a.categoria===c).length}</b></button>`).join(''):'';
  const w=el('w-anexos');
  if(!anexos.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nenhum anexo nesta unidade</b>Adicione links do Drive ou envie arquivos do computador, como planos de aula e documentos da unidade.</div></div>';return;}
  w.innerHTML=cats.filter(c=>!anexoFiltro||c===anexoFiltro).map(c=>{
    const ls=anexos.filter(a=>a.categoria===c);
    return `<div class="axgroup"><h4>${esc(c)} <span>${ls.length}</span></h4><div class="axlist">`+ls.map(a=>{const [cls,lab]=ftype(a);
      return `<div class="ax"><div class="ftype ${cls}">${lab}</div>
        <div><div class="t">${esc(a.titulo)}</div><div class="m">${[a.tipo==='arquivo'?'Arquivo':'Link',fmtFull((a.created_at||'').slice(0,10)),fmtSize(a.tamanho),a.descricao].filter(Boolean).map(esc).join(' · ')}</div></div>
        <a class="btn ghost sm" href="${esc(anexoHref(a))}" target="_blank" rel="noopener">${a.tipo==='arquivo'?'Abrir arquivo':'Abrir link'} ↗</a>
        <button class="icon del" title="Excluir anexo" onclick="delAnexo('${a.id}')">${TRASH}</button></div>`;}).join('')+'</div></div>';
  }).join('');
}

// ================= DEPRECIAÇÃO (tipos de aula + simulador) =================
async function addProc(){
  const nome=el('np-nome').value.trim();
  if(!nome){toast('Dê um nome ao tipo de aula.',true);return;}
  const p=Number(el('np-pct').value||0);
  if(!(p>0)){toast('Informe o percentual por aluno.',true);return;}
  const ideal=el('np-ideal').value===''?100:Number(el('np-ideal').value);
  if(!(ideal>0&&ideal<=100)){toast('O desgaste ideal precisa estar entre 0 e 100%.',true);return;}
  const row={nome, pct_por_aluno:p, desgaste_ideal:ideal, descricao:el('np-desc').value.trim()||null, unidade_id:cur.id};
  const {data,error}=await db.from('cadaver_procedimentos').insert(row).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  procs.push(data); ['np-nome','np-pct','np-desc'].forEach(i=>el(i).value=''); el('np-ideal').value=100;
  renderAll(); toast('Tipo de aula adicionado.');
}
async function saveProc(id,field,val){
  const p=procById(id); if(!p)return;
  if(field==='pct_por_aluno') val=Number(val||0);
  if(field==='desgaste_ideal'){val=Number(val||0);if(!(val>0&&val<=100)){toast('O desgaste ideal precisa estar entre 0 e 100%.',true);renderProcs();return;}}
  p[field]=val;
  const {error}=await db.from('cadaver_procedimentos').update({[field]:val}).eq('id',id);
  if(error){toast('Erro ao salvar: '+errMsg(error),true);return;}
  renderAll(); toast('Salvo.');
}
async function delProc(id){
  const p=procById(id), n=aulas.filter(a=>a.procedimento_id===id).length;
  const ok=await ask({title:'Excluir '+(p?p.nome:'tipo de aula')+'?', body: n? `Há <b>${n} uso(s)</b> com este tipo. Eles ficam sem tipo e com custo zero até você escolher outro.` : 'Nenhuma aula usa este tipo.'});
  if(!ok)return;
  const {error}=await db.from('cadaver_procedimentos').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  procs=procs.filter(p=>p.id!==id); aulas.forEach(a=>{if(a.procedimento_id===id)a.procedimento_id=null;});
  renderAll(); toast('Tipo excluído.');
}
async function copyProcs(){
  const from=el('cp-from').value; if(!from)return;
  const r=await db.from('cadaver_procedimentos').select('nome,pct_por_aluno,desgaste_ideal,descricao').eq('unidade_id',from).order('created_at');
  if(r.error){toast('Erro: '+errMsg(r.error),true);return;}
  if(!r.data.length){toast('Essa unidade não tem tipos de aula cadastrados.',true);return;}
  const {data,error}=await db.from('cadaver_procedimentos').insert(r.data.map(x=>({...x,unidade_id:cur.id}))).select();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  procs.push(...data); renderAll(); toast(data.length+' tipo(s) de aula copiados.');
}
function renderProcs(){
  const w=el('w-procs');
  if(!procs.length){
    const outras=unidades.filter(u=>cur&&u.id!==cur.id);
    w.innerHTML='<div class="empty"><b>Nenhum tipo de aula nesta unidade</b>Cadastre o primeiro tipo acima. Sem tipos não é possível registrar aulas.'+
      (outras.length?`<div class="copyrow"><select id="cp-from" aria-label="Unidade de origem">${outras.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select><button class="btn ghost sm" onclick="copyProcs()">Copiar tipos desta unidade</button></div>`:'')+'</div>';
    return;
  }
  let h='<table><thead><tr><th>Tipo de aula</th><th class="n">% por aluno</th><th class="n">Desgaste ideal</th><th class="n">Alunos até o desgaste ideal</th><th class="n">Usos lançados</th><th class="n">Custo acumulado</th><th>Descrição</th><th></th></tr></thead><tbody>';
  procs.forEach(p=>{
    const as=aulas.filter(a=>a.procedimento_id===p.id), tot=as.reduce((s,a)=>s+custoAula(a),0);
    const ideal=Number(p.desgaste_ideal??100), ate=p.pct_por_aluno>0? ideal/Number(p.pct_por_aluno) : 0;
    h+=`<tr>
      <td><input value="${esc(p.nome)}" aria-label="Tipo de aula" onchange="saveProc('${p.id}','nome',this.value)"></td>
      <td class="n"><input class="w-int num" type="number" min="0" step="0.01" value="${p.pct_por_aluno}" aria-label="% por aluno" onchange="saveProc('${p.id}','pct_por_aluno',this.value)"></td>
      <td class="n"><span class="pctin"><input class="w-int num" type="number" min="1" max="100" step="1" value="${p.desgaste_ideal??100}" aria-label="Desgaste ideal (%)" onchange="saveProc('${p.id}','desgaste_ideal',this.value)">%</span></td>
      <td class="n calc">${ate?NUM.format(Math.floor(ate)):'—'}</td>
      <td class="n">${as.length}</td>
      <td class="n">${money(tot)}</td>
      <td><input value="${esc(p.descricao||'')}" aria-label="Descrição" onchange="saveProc('${p.id}','descricao',this.value)"></td>
      <td><button class="icon" title="Excluir tipo" onclick="delProc('${p.id}')">${TRASH}</button></td>
    </tr>`;
  });
  w.innerHTML=h+'</tbody></table>';
}
function renderSim(){
  const c=corpoById(el('sim-corpo').value), p=procById(el('sim-proc').value), n=Number(el('sim-alunos').value||0);
  const out=el('sim-out');
  if(!c||!p||!(n>0)){out.innerHTML='<b>—</b><span>escolha peça, tipo e alunos</span>';return;}
  const dep=Number(p.pct_por_aluno)*n, custo=Number(c.valor||0)*dep/100, porAluno=n?custo/n:0;
  const restante=Math.max(100-pctDoCorpo(c.id),0);
  const aviso=dep>restante? ` Esta peça só tem ${pct(restante)} de vida restante; o custo real ficaria em ${money(Number(c.valor||0)*restante/100)}.` : '';
  out.innerHTML=`<b>${money(custo)}</b><span>${pct(dep)} da peça · ${money(porAluno)} por aluno.${aviso}</span>`;
}

// ================= RELATÓRIOS =================
let charts={};
const cssv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function mkChart(id,cfg){ if(charts[id])charts[id].destroy(); charts[id]=new Chart(el(id),cfg); }
function baseBar(labels,data,color,horizontal){
  const grid=cssv('--line'), txt=cssv('--muted');
  const val={ticks:{color:txt,callback:v=>'R$ '+NUM.format(v)},grid:{color:grid},border:{display:false}};
  const cat={ticks:{color:txt,autoSkip:true,maxRotation:0},grid:{display:false},border:{color:grid}};
  return{type:'bar',data:{labels,datasets:[{data,backgroundColor:color,borderRadius:5,maxBarThickness:42}]},
    options:{indexAxis:horizontal?'y':'x',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(horizontal?c.parsed.x:c.parsed.y)}}},
      scales:horizontal?{x:val,y:cat}:{y:val,x:cat}}};
}
function alunosDia(ls,s){return (s&&Number(s.total_alunos)>0)?Number(s.total_alunos):ls.reduce((t,a)=>Math.max(t,Number(a.num_alunos||0)),0);}
function renderDash(){
  if(!cur) return;
  Chart.defaults.font.family=cssv('--f-body'); Chart.defaults.color=cssv('--muted');
  const totInvest=corpos.reduce((s,c)=>s+Number(c.valor||0),0);
  const totCusto=aulas.reduce((s,a)=>s+custoAula(a),0);
  const totResid=corpos.reduce((s,c)=>s+residualCorpo(c),0);
  const dias=sessoes.filter(s=>aulas.some(a=>a.sessao_id===s.id));
  const totAlunos=dias.reduce((t,s)=>t+alunosDia(aulas.filter(a=>a.sessao_id===s.id),s),0);
  el('kpis').innerHTML=
    kpi('Valor do acervo',money(totInvest),'lead')+
    kpi('Custo depreciado nas aulas',money(totCusto),'warn')+
    kpi('Valor residual',money(totResid),'accent')+
    kpi('Peças no acervo',corpos.length,'')+
    kpi('Dias de aula',dias.length,'')+
    kpi('Alunos atendidos',NUM.format(totAlunos),'')+
    kpi('Custo médio por dia de aula',money(dias.length?totCusto/dias.length:0),'small')+
    kpi('Custo médio por aluno',money(totAlunos?totCusto/totAlunos:0),'small');
  const G=cssv('--chart-1'), T=cssv('--chart-2');
  const byD=groupSum([...aulas].sort((a,b)=>(a.data||'').localeCompare(b.data||'')),a=>a.data||'',custoAula);
  mkChart('c-time',baseBar(Object.keys(byD).map(fmtD),Object.values(byD).map(v=>+v.toFixed(2)),G));
  mkChart('c-corpo',baseBar(corpos.map(cod),corpos.map(c=>+custoUsadoCorpo(c).toFixed(2)),T,corpos.length>6));
  const byM=groupSum([...aulas].sort((a,b)=>(a.data||'').localeCompare(b.data||'')),a=>(a.data||'').slice(0,7),custoAula);
  mkChart('c-mes',baseBar(Object.keys(byM).map(fmtMes),Object.values(byM).map(v=>+v.toFixed(2)),T));
  const byP=groupSum(aulas,a=>{const p=procById(a.procedimento_id);return p?p.nome:'sem tipo';},custoAula);
  mkChart('c-proc',baseBar(Object.keys(byP),Object.values(byP).map(v=>+v.toFixed(2)),G,true));
  el('deprec-list').innerHTML = corpos.length? corpos.map(c=>{
    const p=pctDoCorpo(c.id),lv=nivel(p);
    return `<div class="drow">
      <div class="nm" title="${esc(cod(c))}">${esc(cod(c))}</div>
      <div class="bar"><i class="${lv}" style="width:${Math.min(p,100)}%"></i></div>
      <div class="pv num">${pct(p)}</div>
      <div class="mv num">residual ${money(residualCorpo(c))} de ${money(c.valor)}</div>
      <span class="pill ${lv}">${rotulo(p)}</span>
    </div>`;}).join('') : '<div class="empty"><b>Sem peças nesta unidade</b>Cadastre peças na aba Peças.</div>';
}
function kpi(k,v,cls){return `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v ${cls==='small'?'small':''}">${v}</div></div>`;}
function groupSum(arr,keyf,valf){const o={};arr.forEach(x=>{const k=keyf(x);o[k]=(o[k]||0)+valf(x);});return o;}
function fmtD(d){if(!d)return'';const[y,m,dd]=d.split('-');return dd+'/'+m;}
function fmtMes(k){if(!k)return'—';const[y,m]=k.split('-');return MESES[+m-1]+'/'+y.slice(2);}
function fmtFull(d){if(!d)return'';const[y,m,dd]=d.split('-');return dd+'/'+m+'/'+y;}

function filtered(){
  const fc=el('f-corpo').value, fp=el('f-proc').value, fr=el('f-resp').value, de=el('f-de').value, ate=el('f-ate').value;
  return aulas.filter(a=>{
    if(fc&&a.corpo_id!==fc)return false;
    if(fp&&a.procedimento_id!==fp)return false;
    if(fr&&(sessById(a.sessao_id)||{}).responsavel!==fr)return false;
    if(de&&(a.data||'')<de)return false;
    if(ate&&(a.data||'')>ate)return false;
    return true;
  }).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
}
function clearFilters(){['f-corpo','f-proc','f-resp','f-de','f-ate'].forEach(i=>el(i).value='');renderRel();}
function renderRel(){
  const rows=filtered();
  const tot=rows.reduce((s,a)=>s+custoAula(a),0);
  const ds=new Set(rows.map(a=>a.sessao_id));
  el('rel-kpis').innerHTML=kpi('Usos no filtro',rows.length,'')+kpi('Dias de aula',ds.size,'')+kpi('Custo total',money(tot),'warn')+kpi('Alunos atendidos',NUM.format([...ds].reduce((t,id)=>t+alunosDia(aulas.filter(a=>a.sessao_id===id),sessById(id)),0)),'');
  const w=el('w-rel');
  if(!rows.length){w.innerHTML='<div class="empty"><b>Nenhum uso no filtro</b>Ajuste ou limpe os filtros acima.</div>';return;}
  let h='<table><thead><tr><th>Data</th><th>Curso</th><th>Responsável</th><th class="n">Alunos na aula</th><th>Peça</th><th>Tipo de aula</th><th class="n">Alunos na peça</th><th class="n">% por aluno</th><th class="n">Depreciação</th><th class="n">Custo</th><th class="n">Custo/aluno</th></tr></thead><tbody>';
  rows.forEach(a=>{const c=corpoById(a.corpo_id)||{},p=procById(a.procedimento_id),s=sessById(a.sessao_id)||{};
    h+=`<tr><td>${fmtFull(a.data)}</td><td>${esc(s.curso||'—')}</td><td>${esc(s.responsavel||'—')}</td><td class="n">${s.total_alunos??'—'}</td><td>${esc(c.id?cod(c):'—')}</td><td>${esc(p?p.nome:'sem tipo')}</td><td class="n">${a.num_alunos}</td><td class="n">${pct(pctAluno(a))}</td><td class="n">${pct(depAula(a))}</td><td class="n calc">${money(custoAula(a))}</td><td class="n">${money(custoAluno(a))}</td></tr>`;});
  w.innerHTML=h+'</tbody></table>';
}
function exportCSV(){
  const rows=filtered();
  const head=['Unidade','Data','Curso','Responsável','Alunos na aula','Código final','Código original','Espécimen','Valor da peça','Tipo de aula','Alunos na peça','% por aluno','Depreciação (%)','Custo','Custo por aluno','Observações do dia'];
  const dec=v=>Number(v).toFixed(2).replace('.',',');
  const lines=[head.join(';')];
  rows.forEach(a=>{const c=corpoById(a.corpo_id)||{},p=procById(a.procedimento_id),s=sessById(a.sessao_id)||{};
    lines.push([cur.nome,fmtFull(a.data),s.curso||'',s.responsavel||'',s.total_alunos??'',c.codigo_final||'',c.nome||'',c.especime||'',dec(c.valor||0),p?p.nome:'',a.num_alunos,dec(pctAluno(a)),dec(depAula(a)),
      dec(custoAula(a)),dec(custoAluno(a)),s.observacao||''].map(x=>`"${(x??'').toString().replace(/"/g,'""')}"`).join(';'));
  });
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='usos-pecas-'+slug(cur.nome)+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u);
  toast('CSV exportado.');
}

// redesenha os gráficos quando o tema do sistema muda
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(cur&&el('tab-rel').classList.contains('active'))renderDash();});

// ================= HISTÓRICO =================
let hist=[], histFim=true;
const ENT={cadaver_agenda:'a aula programada de',cadaver_corpos:'a peça',cadaver_procedimentos:'o tipo de aula',cadaver_sessoes:'o dia de aula',cadaver_aulas:'o uso de peça',cadaver_anexos:'o anexo',cadaver_unidades:'a unidade'};
const LBL={hora_inicio:'Início',procedimentos_previstos:'Tipos de prática previstos',hora_fim:'Término',alunos_previstos:'Alunos previstos',pecas_previstas:'Peças previstas',status:'Situação',nps_aberto_ate:'Avaliação aberta até',segmento:'Segmento',codigo_final:'Código final',especime:'Espécimen',local_atual:'Local atual',processamento:'Processamento',invoice:'Invoice',fornecedor:'Fornecedor',
  sexo:'Sexo',idade:'Idade',etnia:'Etnia',data_aquisicao:'Data de chegada',valor:'Valor de compra',uso_inicial:'Uso prévio (%)',link_drive:'Link do Drive',
  pct_por_aluno:'% por aluno',desgaste_ideal:'Desgaste ideal (%)',descricao:'Descrição',data:'Data',curso:'Curso',responsavel:'Responsável',observacao:'Observações',
  total_alunos:'Alunos na aula',num_alunos:'Alunos na peça',corpo_id:'Peça',procedimento_id:'Tipo de aula',titulo:'Título',categoria:'Categoria',sessao_id:'Dia de aula'};
const IGN=['nps_token','id','created_at','peso','pontos','procedimento','campus','unidade','unidade_id','url','arquivo_path','tamanho','mime','tipo'];
async function loadHist(more){
  if(!cur) return;
  const from=more?hist.length:0, uid=cur.id;
  if(!more) el('w-hist').innerHTML='<div class="tablewrap"><div class="empty">Carregando histórico…</div></div>';
  const r=await db.from('cadaver_historico').select('*').eq('unidade_id',uid).order('quando',{ascending:false}).range(from,from+199);
  if(!cur||cur.id!==uid) return;
  if(r.error){el('w-hist').innerHTML=`<div class="warnbox">${esc(errMsg(r.error))}</div>`;el('h-more').hidden=true;return;}
  hist=more?hist.concat(r.data):r.data; histFim=r.data.length<200;
  const keep=el('h-user').value;
  const users=sortPt(hist.map(quem));
  el('h-user').innerHTML='<option value="">Todas</option>'+users.map(u=>`<option ${u===keep?'selected':''}>${esc(u)}</option>`).join('');
  renderHist();
}
function quem(h){return h.usuario_nome||h.usuario_email||'Sistema';}
function nomeReg(h){
  const r=h.depois||h.antes||{};
  switch(h.tabela){
    case 'cadaver_corpos': return (r.codigo_final||'').trim()||r.nome||'—';
    case 'cadaver_procedimentos': case 'cadaver_unidades': return r.nome||'—';
    case 'cadaver_sessoes': return fmtFull(r.data)+(r.curso?' · '+r.curso:'');
    case 'cadaver_aulas': { const c=corpoById(r.corpo_id); return (c?cod(c):'peça excluída')+' em '+fmtFull(r.data); }
    case 'cadaver_anexos': return r.titulo||'—';
    case 'cadaver_agenda': return fmtFull(r.data)+(r.curso?' · '+r.curso:'');
  }
  return '—';
}
function fmtVal(k,v){
  if(v==null||v==='') return 'vazio';
  if(k==='corpo_id'){const c=corpoById(v);return c?cod(c):'peça excluída';}
  if(k==='procedimento_id'){const p=procById(v);return p?p.nome:'tipo excluído';}
  if(k==='sessao_id'){const s=sessById(v);return s?fmtFull(s.data):'—';}
  if(k==='data'||k==='data_aquisicao') return fmtFull(String(v));
  if(k==='valor') return money(Number(v));
  if(k==='procedimentos_previstos') return Array.isArray(v)&&v.length?v.map(id=>{const p=procById(id);return p?p.nome:'tipo excluído';}).join(', '):'nenhum';
  if(k==='pecas_previstas') return Array.isArray(v)&&v.length?v.map(id=>{const c=corpoById(id);return c?cod(c):'peça excluída';}).join(', '):'nenhuma';
  if(k==='status') return ST[v]||String(v);
  if(k==='hora_inicio'||k==='hora_fim') return hhmm(v);
  if(k==='nps_aberto_ate') return fmtDH(String(v));
  if(k==='segmento') return SEG[v]?SEG[v].l:String(v);
  return String(v);
}
function difs(h){
  if(h.acao!=='alterou'||!h.antes||!h.depois) return [];
  return Object.keys(h.depois).filter(k=>!IGN.includes(k)&&JSON.stringify(h.antes[k])!==JSON.stringify(h.depois[k])).map(k=>{
    const lab=k==='nome'?(h.tabela==='cadaver_corpos'?'Código original':'Nome'):(LBL[k]||k);
    return `<li>${esc(lab)}: <s>${esc(fmtVal(k,h.antes[k]))}</s> → <b>${esc(fmtVal(k,h.depois[k]))}</b></li>`;
  });
}
function detalhe(h){
  const r=h.depois||h.antes||{};
  if(h.tabela==='cadaver_aulas'&&h.acao!=='alterou'){const p=procById(r.procedimento_id);return `<li>${esc(p?p.nome:'sem tipo')} · ${r.num_alunos} aluno(s) na peça</li>`;}
  if(h.tabela==='cadaver_sessoes'&&h.acao==='criou') return `<li>Responsável: ${esc(r.responsavel||'—')}${r.total_alunos?` · ${r.total_alunos} aluno(s)`:''}</li>`;
  if(h.tabela==='cadaver_corpos'&&h.acao==='criou') return `<li>${esc([r.especime,r.processamento,r.valor!=null?money(Number(r.valor)):''].filter(Boolean).join(' · '))}</li>`;
  return '';
}
function diaRotulo(d){
  const hoje=today(), ontem=new Date(Date.now()-864e5).toLocaleDateString('sv');
  if(d===hoje) return 'Hoje'; if(d===ontem) return 'Ontem';
  const dt=new Date(d+'T12:00'); return dt.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}
function renderHist(){
  const fu=el('h-user').value, ft=el('h-tipo').value, fa=el('h-acao').value, q=(el('h-busca').value||'').trim().toLowerCase();
  const list=hist.filter(h=>{
    if(fu&&quem(h)!==fu) return false;
    if(ft&&!(ft==='aulas'?['cadaver_sessoes','cadaver_aulas'].includes(h.tabela):h.tabela===ft)) return false;
    if(fa&&h.acao!==fa) return false;
    if(q&&!(JSON.stringify([h.antes,h.depois,quem(h)])+nomeReg(h)).toLowerCase().includes(q)) return false;
    return true;
  });
  el('h-more').hidden=histFim;
  const w=el('w-hist');
  if(!hist.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nenhuma ação registrada ainda</b>A partir de agora, tudo o que for criado, alterado ou excluído nesta unidade aparece aqui.</div></div>';return;}
  if(!list.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nada encontrado</b>Ajuste os filtros acima.</div></div>';return;}
  const grupos={};
  list.forEach(h=>{const d=new Date(h.quando).toLocaleDateString('sv');(grupos[d]??=[]).push(h);});
  w.innerHTML=Object.entries(grupos).map(([d,ls])=>`<div class="hgroup"><h4>${esc(diaRotulo(d))}</h4><div class="hlist">`+ls.map(h=>{
    const nm=quem(h), ini=nm.split(/[\s@.]+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
    const det=h.acao==='alterou'?difs(h).join(''):detalhe(h);
    return `<div class="hi"><span class="av ${h.acao}">${esc(ini)}</span>
      <div class="hb"><div class="hl"><b>${esc(nm)}</b> ${h.acao} ${ENT[h.tabela]||'um registro'} <b>${esc(nomeReg(h))}</b></div>${det?`<ul class="hd">${det}</ul>`:''}</div>
      <time datetime="${esc(h.quando)}">${new Date(h.quando).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></div>`;}).join('')+'</div></div>').join('');
}

// ================= CALENDÁRIO (aulas programadas — só planejamento, fora das estatísticas) =================
let agenda=[], agendaErr=null, calMes=null, calDia=null, agEdit=null, agPecas=new Set(), agLancar=null;
const ST={programada:'Programada',realizada:'Realizada',cancelada:'Cancelada'};
const DOWL=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESL=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const hhmm=t=>t?String(t).slice(0,5):'';
const agById=id=>agenda.find(a=>a.id===id);
const procsDe=a=>(a.procedimentos_previstos&&a.procedimentos_previstos.length)?a.procedimentos_previstos:(a.procedimento_id?[a.procedimento_id]:[]);
let agProcs=new Set();
const agDoDia=d=>agenda.filter(a=>a.data===d).sort((x,y)=>(hhmm(x.hora_inicio)||'99').localeCompare(hhmm(y.hora_inicio)||'99'));
function isoDe(dt){return dt.toLocaleDateString('sv');}
function calInit(){const t=new Date();calMes=new Date(t.getFullYear(),t.getMonth(),1);calDia=today();}
function calNav(n){if(n===0){calInit();}else{calMes=new Date(calMes.getFullYear(),calMes.getMonth()+n,1);}renderCal();}
function calSel(d){calDia=d;renderCal();}
function renderCal(){
  if(!cur) return;
  if(!calMes) calInit();
  if(agendaErr){el('cal-wrap').innerHTML=`<div class="warnbox">${esc(errMsg(agendaErr))}</div>`;return;}
  const y=calMes.getFullYear(), m=calMes.getMonth();
  el('cal-mes').textContent=MESL[m][0].toUpperCase()+MESL[m].slice(1)+' de '+y;
  const ini=new Date(y,m,1), off=ini.getDay(), dias=new Date(y,m+1,0).getDate();
  const cells=[]; const hoje=today();
  for(let i=0;i<42;i++){
    const dt=new Date(y,m,1-off+i), d=isoDe(dt), out=dt.getMonth()!==m;
    if(i>=35&&out&&cells.length%7===0) break;
    const evs=agDoDia(d);
    cells.push(`<button type="button" class="cd ${out?'out':''} ${d===hoje?'hoje':''} ${d===calDia?'sel':''}" onclick="calSel('${d}')" aria-label="${dt.getDate()} de ${MESL[dt.getMonth()]}${evs.length?', '+evs.length+' aula(s) programada(s)':''}">
      <span class="dn">${dt.getDate()}</span>
      <span class="evs">${evs.slice(0,3).map(a=>`<span class="ev ${a.status}">${hhmm(a.hora_inicio)?`<b>${hhmm(a.hora_inicio)}</b> `:''}${esc(a.curso||'Aula')}</span>`).join('')}${evs.length>3?`<span class="more">+${evs.length-3}</span>`:''}</span>
      ${evs.length?`<span class="dots">${evs.map(a=>`<i class="${a.status}"></i>`).join('')}</span>`:''}
    </button>`);
  }
  el('cal-grid').innerHTML=DOWL.map(d=>`<div class="cw">${d}</div>`).join('')+cells.join('');
  const doMes=agenda.filter(a=>a.data&&a.data.slice(0,7)===`${y}-${String(m+1).padStart(2,'0')}`&&a.status!=='cancelada');
  el('cal-resumo').innerHTML=`<span class="chip"><b>${doMes.length}</b> aula(s) programada(s) no mês</span><span class="chip"><b>${NUM.format(doMes.reduce((t,a)=>t+(Number(a.alunos_previstos)||0),0))}</b> alunos previstos</span><span class="chip"><b>${new Set(doMes.flatMap(a=>a.pecas_previstas||[])).size}</b> peças previstas</span>`;
  renderCalDia(); renderProximas();
}
function pecaChipMini(id){const c=corpoById(id);if(!c)return '<span class="pchip off">peça excluída</span>';const p=pctDoCorpo(c.id);return `<span class="pchip ${p>=100?'hot':p>=90?'mid':''}" title="${esc(segLabel(c))} · Σ uso ${pct(p)}">${segThumb(c,'xs')}${esc(cod(c))}${p>=100?' · esgotada':''}</span>`;}
function conflitos(a){
  // mesma peça prevista em outra aula do mesmo dia
  const outros=agenda.filter(x=>x.id!==a.id&&x.data===a.data&&x.status!=='cancelada');
  return (a.pecas_previstas||[]).filter(id=>outros.some(o=>(o.pecas_previstas||[]).includes(id)));
}
function agCard(a,showDate){
  const pn=procsDe(a).map(id=>{const p=procById(id);return p?p.nome:null;}).filter(Boolean), cf=a.status!=='cancelada'?conflitos(a):[];
  const esg=(a.pecas_previstas||[]).filter(id=>{const c=corpoById(id);return c&&pctDoCorpo(c.id)>=100;});
  return `<article class="ag ${a.status}">
    <div class="ag-t">${showDate?`<span class="ag-d">${fmtFull(a.data)}</span>`:''}<span class="ag-h">${hhmm(a.hora_inicio)||'—'}${hhmm(a.hora_fim)?' – '+hhmm(a.hora_fim):''}</span><span class="pill st-${a.status}">${ST[a.status]}</span></div>
    <h4>${esc(a.curso||'Aula sem curso definido')}</h4>
    ${pn.length?`<div class="ag-tp">${pn.map(n=>`<span class="tpchip">${esc(n)}</span>`).join('')}</div>`:''}
    <div class="ag-m">${[a.alunos_previstos!=null?`${a.alunos_previstos} aluno(s) previsto(s)`:'',a.responsavel?'resp.: '+a.responsavel:''].filter(Boolean).map(esc).join(' · ')}</div>
    ${(a.pecas_previstas||[]).length?`<div class="ag-p">${a.pecas_previstas.map(pecaChipMini).join('')}</div>`:'<div class="ag-m muted">Nenhuma peça prevista.</div>'}
    ${a.observacao?`<p class="ag-o">${esc(a.observacao)}</p>`:''}
    ${cf.length?`<div class="ag-w">A peça ${cf.map(id=>esc(cod(corpoById(id)))).join(', ')} também está prevista em outra aula neste dia.</div>`:''}
    ${esg.length&&a.status==='programada'?`<div class="ag-w">Peça esgotada prevista: ${esg.map(id=>esc(cod(corpoById(id)))).join(', ')}.</div>`:''}
    <div class="ag-a">
      <button class="btn ghost sm" onclick="agAbrir('${a.id}')">Editar</button>
      ${a.status==='programada'?`<button class="btn ghost sm" onclick="agLancarAula('${a.id}')">Lançar como realizada</button>`:''}
      <span class="grow"></span>
      <button class="icon" title="Excluir aula programada" onclick="agExcluir('${a.id}')">${TRASH}</button>
    </div>
  </article>`;
}
function renderCalDia(){
  const d=calDia, evs=agDoDia(d), dt=new Date(d+'T12:00');
  const lb=dt.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}); el('cal-dia-t').textContent=lb[0].toUpperCase()+lb.slice(1);
  el('cal-dia').innerHTML=evs.length?evs.map(a=>agCard(a,false)).join(''):'<div class="empty"><b>Nada programado neste dia</b>Clique em “+ Programar aula” para planejar.</div>';
}
function renderProximas(){
  const h=today(), prox=agenda.filter(a=>a.data>=h&&a.status==='programada').sort((x,y)=>(x.data+(hhmm(x.hora_inicio)||'99')).localeCompare(y.data+(hhmm(y.hora_inicio)||'99'))).slice(0,8);
  el('cal-prox').innerHTML=prox.length?prox.map(a=>`<button type="button" class="px" onclick="calIr('${a.data}')"><span class="px-d"><b>${a.data.slice(8)}</b>${MESL[+a.data.slice(5,7)-1].slice(0,3)}</span><span class="px-b"><b>${esc(a.curso||'Aula')}</b><span>${[hhmm(a.hora_inicio),a.alunos_previstos!=null?a.alunos_previstos+' alunos':'',(a.pecas_previstas||[]).length+' peça(s)'].filter(Boolean).join(' · ')}</span></span></button>`).join(''):'<p class="muted" style="margin:0">Nenhuma aula programada a partir de hoje.</p>';
}
function calIr(d){const [y,m]=d.split('-');calMes=new Date(+y,+m-1,1);calDia=d;renderCal();}

// ---------- formulário ----------
function agAbrir(id,dia){
  agEdit=id||null; const a=id?agById(id):{data:dia||calDia||today(),status:'programada',pecas_previstas:[]};
  el('ag-title').textContent=id?'Editar aula programada':'Programar aula';
  el('ag-data').value=a.data||''; el('ag-ini').value=hhmm(a.hora_inicio); el('ag-fim').value=hhmm(a.hora_fim);
  el('ag-curso').value=a.curso||''; el('ag-alunos').value=a.alunos_previstos??''; el('ag-resp').value=a.responsavel||'';
  el('ag-obs').value=a.observacao||''; el('ag-status').value=a.status||'programada';
  agProcs=new Set(procsDe(a)); renderAgProcs();
  agPecas=new Set(a.pecas_previstas||[]); el('ag-busca').value='';
  renderAgPecas();
  el('ag-del').hidden=!id;
  el('agmodal').hidden=false; document.body.style.overflow='hidden';
  setTimeout(()=>el('ag-curso').focus(),30);
}
function agFechar(){el('agmodal').hidden=true;document.body.style.overflow='';}
function agToggleProc(id){agProcs.has(id)?agProcs.delete(id):agProcs.add(id);renderAgProcs();}
function renderAgProcs(){
  el('ag-procs').innerHTML=procs.length?procs.map(p=>{const on=agProcs.has(p.id);return `<button type="button" role="checkbox" aria-checked="${on}" class="tpk ${on?'on':''}" onclick="agToggleProc('${p.id}')"><span class="pk-c">${on?'✓':''}</span>${esc(p.nome)} <span class="muted">${pct(p.pct_por_aluno)}/aluno</span></button>`;}).join(''):'<p class="muted" style="margin:0">Cadastre os tipos de aula na aba Depreciação.</p>';
  el('ag-tn').textContent=agProcs.size?`${agProcs.size} selecionado(s)`:'nenhum selecionado';
}
function agTogglePeca(id){agPecas.has(id)?agPecas.delete(id):agPecas.add(id);renderAgPecas();}
function renderAgPecas(){
  const q=(el('ag-busca').value||'').trim().toLowerCase();
  const list=[...corpos].sort(byCod).filter(c=>!q||[cod(c),c.nome,segLabel(c),c.especime].some(v=>(v||'').toLowerCase().includes(q)));
  el('ag-pn').textContent=agPecas.size?`${agPecas.size} selecionada(s)`:'nenhuma selecionada';
  el('ag-pecas').innerHTML=corpos.length?list.map(c=>{const p=pctDoCorpo(c.id),on=agPecas.has(c.id);
    return `<button type="button" role="checkbox" aria-checked="${on}" class="pk ${on?'on':''}" onclick="agTogglePeca('${c.id}')">${segThumb(c,'xs')}<span class="pk-b"><b>${esc(cod(c))}</b><span>${esc(segLabel(c)||'—')} · Σ uso ${pct(p)}${p>=100?' · esgotada':''}</span></span><span class="pk-c">${on?'✓':''}</span></button>`;}).join('')||'<p class="muted">Nenhuma peça encontrada.</p>'
    :'<p class="muted">Cadastre as peças na aba Peças para poder prevê-las.</p>';
}
async function agSalvar(){
  const data=el('ag-data').value;
  if(!data){toast('Informe a data da aula programada.',true);return;}
  const ini=el('ag-ini').value||null, fim=el('ag-fim').value||null;
  if(ini&&fim&&fim<=ini){toast('O horário de término precisa ser depois do início.',true);return;}
  const al=el('ag-alunos').value;
  const row={data,hora_inicio:ini,hora_fim:fim,curso:el('ag-curso').value.trim()||null,procedimento_id:[...agProcs][0]||null,procedimentos_previstos:[...agProcs],
    alunos_previstos:al===''?null:Math.max(0,parseInt(al)),pecas_previstas:[...agPecas],responsavel:el('ag-resp').value.trim()||null,
    observacao:el('ag-obs').value.trim()||null,status:el('ag-status').value};
  if(agEdit){
    const {error}=await db.from('cadaver_agenda').update(row).eq('id',agEdit);
    if(error){toast('Erro: '+errMsg(error),true);return;}
    Object.assign(agById(agEdit),row); toast('Aula programada atualizada.');
  }else{
    row.unidade_id=cur.id;
    const {data:d,error}=await db.from('cadaver_agenda').insert(row).select().single();
    if(error){toast('Erro: '+errMsg(error),true);return;}
    agenda.push(d); toast('Aula programada.');
  }
  agFechar(); calIr(data);
}
async function agExcluir(id){
  id=id||agEdit; const a=agById(id); if(!a) return;
  const ok=await ask({title:'Excluir esta aula programada?',body:`${fmtFull(a.data)}${a.curso?' · '+esc(a.curso):''}. Isso não altera nenhuma aula já registrada.`});
  if(!ok) return;
  const {error}=await db.from('cadaver_agenda').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  agenda=agenda.filter(x=>x.id!==id); agFechar(); renderCal(); toast('Aula programada excluída.');
}
// Leva os dados previstos para o formulário da aba Aulas (só entra nas estatísticas depois de salvo lá)
function agLancarAula(id){
  const a=agById(id); if(!a) return;
  agLancar=id;
  el('ns-data').value=a.data; el('ns-curso').value=a.curso||''; el('ns-alunos').value=a.alunos_previstos??'';
  if(a.responsavel) el('ns-resp').value=a.responsavel;
  el('ns-obs').value=a.observacao||'';
  const ids=(a.pecas_previstas||[]).filter(x=>corpoById(x));
  const pp=procsDe(a).filter(x=>procById(x)), um=pp.length===1?pp[0]:'';
  lines=ids.length?ids.map(cid=>({corpo:cid,proc:um,alunos:''})):[newLine()];
  showTab('aulas'); renderLines(); window.scrollTo({top:0,behavior:'smooth'});
  toast(pp.length>1?'Dados copiados. Escolha o tipo de prática de cada peça, confira os alunos e salve.':'Dados da programação copiados. Confira os alunos de cada peça e salve.');
}

// ================= AVALIAÇÕES (NPS dos alunos) =================
let respostas=[], respErr=null, avAll=null;
const npsLink=t=>new URL('nps.html?t='+encodeURIComponent(t),location.href).href;
const aberta=s=>!!(s&&s.nps_token&&s.nps_aberto_ate&&new Date(s.nps_aberto_ate)>new Date());
function novoToken(){const a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',r=new Uint32Array(12);crypto.getRandomValues(r);return [...r].map(x=>a[x%a.length]).join('');}
function fmtDH(iso){if(!iso)return'';const d=new Date(iso);return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
function npsCalc(rs){const n=rs.length;if(!n)return null;const P=rs.filter(r=>r.nota_recomendacao>=9).length,D=rs.filter(r=>r.nota_recomendacao<=6).length;return {n,P,D,N:n-P-D,nps:Math.round((P-D)/n*100)};}
function formCalc(rs){const n=rs.length;if(!n)return null;return {media:rs.reduce((t,r)=>t+r.nota_formacao,0)/n,alta:rs.filter(r=>r.nota_formacao>=9).length/n*100};}
const npsCls=v=>v==null?'':v>=50?'ok':v>=0?'mid':'hot';
function npsStrip(s){
  if(respErr) return '';
  const rs=respostas.filter(r=>r.sessao_id===s.id), k=npsCalc(rs), f=formCalc(rs), tot=Number(s.total_alunos)||0;
  if(!s.nps_token) return `<div class="nps-strip"><span class="nps-ic">★</span><span class="muted">Avaliação dos alunos ainda não aberta para este dia.</span><button class="btn green sm" onclick="gerarLink('${s.id}')">Gerar link de avaliação</button></div>`;
  const ab=aberta(s);
  return `<div class="nps-strip ${ab?'on':''}"><span class="nps-ic">★</span>
    <span><b>${rs.length}${tot?` de ${tot}`:''}</b> aluno(s) avaliaram${k?` · formação <b>${NUM.format(f.media)}</b>/10 · NPS <b class="npsv ${npsCls(k.nps)}">${k.nps}</b>`:''}
    <span class="muted"> · ${ab?'aberta até '+fmtDH(s.nps_aberto_ate):'encerrada'}</span></span>
    <span class="grow"></span>
    <button class="btn ghost sm" onclick="mostrarQR('${s.id}')">${ab?'Mostrar QR Code':'Ver link'}</button>
    ${ab?`<button class="btn ghost sm" onclick="setAberto('${s.id}',0)">Encerrar</button>`:`<button class="btn ghost sm" onclick="setAberto('${s.id}',48)">Reabrir por 48 h</button>`}
  </div>`;
}
async function gerarLink(id){
  const s=sessById(id); if(!s) return;
  const patch={nps_token:s.nps_token||novoToken(), nps_aberto_ate:new Date(Date.now()+48*3600e3).toISOString()};
  const {error}=await db.from('cadaver_sessoes').update(patch).eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  Object.assign(s,patch); renderAulas(); mostrarQR(id);
}
async function setAberto(id,horas){
  const s=sessById(id); if(!s) return;
  const v=new Date(Date.now()+horas*3600e3).toISOString();
  const {error}=await db.from('cadaver_sessoes').update({nps_aberto_ate:v}).eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  s.nps_aberto_ate=v; renderAulas(); if(!el('qmodal').hidden) mostrarQR(id);
  toast(horas?'Avaliação reaberta por 48 h.':'Avaliação encerrada.');
}
function mostrarQR(id){
  const s=sessById(id); if(!s||!s.nps_token) return;
  qrSess=id;
  const url=npsLink(s.nps_token), ab=aberta(s);
  el('q-title').textContent=[s.curso,fmtFull(s.data)].filter(Boolean).join(' · ')||'Dia de aula';
  el('q-unid').textContent=cur?cur.nome:'';
  el('q-url').value=url; el('q-open').href=url;
  el('q-status').textContent=ab?'Aberta até '+fmtDH(s.nps_aberto_ate):'Encerrada: os alunos não conseguem mais responder.';
  el('q-status').className='q-status '+(ab?'ok':'off');
  el('q-act').innerHTML=ab?`<button class="btn ghost" onclick="setAberto('${id}',0)">Encerrar avaliação</button>`:`<button class="btn ghost" onclick="setAberto('${id}',48)">Reabrir por 48 h</button>`;
  const box=el('q-box'); box.innerHTML='';
  if(window.QRCode){ new QRCode(box,{text:url,width:300,height:300,colorDark:'#0f3e3c',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); }
  else box.innerHTML='<p class="muted">Não foi possível gerar o QR Code. Use o link abaixo.</p>';
  el('qmodal').hidden=false;
}
function fecharQR(){el('qmodal').hidden=true;}
// ---------- QR Code em PDF (cartaz A4 para imprimir ou projetar) ----------
let qrSess=null;
function carregarImg(src){return new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src;});}
async function qrImagem(url,px){
  const tmp=document.createElement('div'); tmp.style.cssText='position:fixed;left:-9999px;top:0';
  document.body.appendChild(tmp);
  new QRCode(tmp,{text:url,width:px,height:px,colorDark:'#0f3e3c',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  await new Promise(r=>setTimeout(r,60));
  let img=null; const cv=tmp.querySelector('canvas'), im=tmp.querySelector('img'), sv=tmp.querySelector('svg');
  if(cv&&cv.width) img=cv;
  else if(im&&im.src) img=await carregarImg(im.src);
  else if(sv) img=await carregarImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(sv)));
  tmp.remove(); return img;
}
function quebraTexto(ctx,txt,max){const ws=txt.split(' '),ls=[];let l='';ws.forEach(w=>{const t=l?l+' '+w:w;if(ctx.measureText(t).width>max&&l){ls.push(l);l=w;}else l=t;});if(l)ls.push(l);return ls;}
// Monta um PDF de uma página com a imagem JPEG do cartaz e um link clicável sobre o QR e o endereço
function pdfDeJpeg(jpeg,W,H,links){
  const enc=new TextEncoder(), parts=[], offs=[]; let len=0;
  const push=b=>{const u=typeof b==='string'?enc.encode(b):b;parts.push(u);len+=u.length;};
  const obj=(n,body)=>{offs[n]=len;push(`${n} 0 obj\n`);body();push('\nendobj\n');};
  const pw=595.28, ph=841.89;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const annots=links.map((_,i)=>`${6+i} 0 R`).join(' ');
  obj(1,()=>push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2,()=>push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3,()=>push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R${links.length?` /Annots [${annots}]`:''} >>`));
  obj(4,()=>{push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);push(jpeg);push('\nendstream');});
  const cs=`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5,()=>push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
  links.forEach((l,i)=>{const sx=pw/W, sy=ph/H; const r=[l.x*sx, ph-(l.y+l.h)*sy, (l.x+l.w)*sx, ph-l.y*sy].map(v=>v.toFixed(2)).join(' ');
    const uri=l.url.replace(/[()\\]/g,m=>'\\'+m);
    obj(6+i,()=>push(`<< /Type /Annot /Subtype /Link /Rect [${r}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`));});
  const n=6+links.length, xref=len;
  push(`xref\n0 ${n}\n0000000000 65535 f \n`);
  for(let i=1;i<n;i++) push(String(offs[i]).padStart(10,'0')+' 00000 n \n');
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts,{type:'application/pdf'});
}
async function baixarQRpdf(){
  const s=sessById(qrSess); if(!s||!s.nps_token) return;
  if(!window.QRCode){toast('Não foi possível gerar o QR Code agora. Recarregue a página e tente de novo.',true);return;}
  const btn=el('q-pdf'); btn.disabled=true; btn.textContent='Gerando PDF…';
  try{
    try{await document.fonts.ready;}catch(e){}
    const url=npsLink(s.nps_token), W=1654, H=2339, k=W/210;      // A4 a 200 dpi; k = px por mm
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const x=cv.getContext('2d');
    const F=getComputedStyle(document.documentElement).getPropertyValue('--f-display').trim()||'sans-serif';
    const B=getComputedStyle(document.documentElement).getPropertyValue('--f-body').trim()||'sans-serif';
    const TEAL='#0f3e3c', GREEN='#3d8b48', MUTED='#5a6f6c';
    x.fillStyle='#fff'; x.fillRect(0,0,W,H);
    // logos
    const [li,ld]=await Promise.all([carregarImg('logo-itc.png'),carregarImg('logo-idomed.png')]);
    const hI=24*k, hD=15*k, wI=li?li.width*hI/li.height:0, wD=ld?ld.width*hD/ld.height:0, gap=10*k;
    let lx=(W-(wI+gap+wD))/2, ly=18*k;
    if(li) x.drawImage(li,lx,ly,wI,hI);
    x.fillStyle='#d5e0dc'; x.fillRect(lx+wI+gap/2-1,ly+3*k,2,hI-6*k);
    if(ld) x.drawImage(ld,lx+wI+gap,ly+(hI-hD)/2,wD,hD);
    // faixa de título
    x.fillStyle=TEAL; x.fillRect(0,52*k,W,40*k);
    x.fillStyle=GREEN; x.fillRect(0,52*k,W,1.6*k);
    x.textAlign='center'; x.fillStyle='#fff'; x.font=`800 ${13*k/1.2}px ${F}`;
    x.fillText('Avalie esta aula prática',W/2,70*k);
    x.fillStyle='#cfe3de'; x.font=`500 ${5.2*k}px ${B}`;
    const sub=[cur?cur.nome:'',s.curso,fmtFull(s.data)].filter(Boolean).join('  ·  ');
    x.fillText(sub,W/2,83*k);
    // QR
    const q=await qrImagem(url,1000), qs=108*k, qx=(W-qs)/2, qy=101*k;
    x.fillStyle='#fff'; x.strokeStyle='#d5e0dc'; x.lineWidth=0.6*k;
    const pad=7*k; x.beginPath(); x.roundRect?x.roundRect(qx-pad,qy-pad,qs+2*pad,qs+2*pad,5*k):x.rect(qx-pad,qy-pad,qs+2*pad,qs+2*pad); x.fill(); x.stroke();
    if(q){x.imageSmoothingEnabled=false; x.drawImage(q,qx,qy,qs,qs);}
    // instruções
    let y=qy+qs+pad+14*k;
    x.fillStyle=TEAL; x.font=`700 ${7.4*k}px ${F}`; x.fillText('Aponte a câmera do celular para o código',W/2,y);
    y+=10*k; x.fillStyle=MUTED; x.font=`400 ${4.6*k}px ${B}`;
    quebraTexto(x,'São 3 perguntas rápidas, leva menos de 1 minuto. Você pode responder sem se identificar.',150*k).forEach(l=>{x.fillText(l,W/2,y);y+=6.5*k;});
    y+=4*k; x.fillStyle=GREEN; x.font=`600 ${3.9*k}px ${B}`;
    x.fillText(url,W/2,y); const lw=x.measureText(url).width, linkBox={x:(W-lw)/2,y:y-4*k,w:lw,h:6*k,url};
    if(aberta(s)){y+=9*k; x.fillStyle=MUTED; x.font=`500 ${4*k}px ${B}`; x.fillText('Avaliação aberta até '+fmtDH(s.nps_aberto_ate),W/2,y);}
    // rodapé
    x.fillStyle=TEAL; x.fillRect(0,H-16*k,W,16*k);
    x.fillStyle='#cfe3de'; x.font=`500 ${3.8*k}px ${B}`;
    x.fillText('ITC · Instituto de Treinamento em Cadáveres   ×   IDOMED · Instituto de Educação Médica',W/2,H-6.5*k);
    const bin=atob(cv.toDataURL('image/jpeg',0.93).split(',')[1]), jpeg=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) jpeg[i]=bin.charCodeAt(i);
    const blob=pdfDeJpeg(jpeg,W,H,[{x:qx,y:qy,w:qs,h:qs,url},linkBox]);
    const nome='qr-avaliacao-'+slug([s.curso||'aula',s.data].join('-'))+'.pdf';
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nome;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    toast('PDF do QR Code baixado.');
  }catch(e){ console.error(e); toast('Não foi possível gerar o PDF: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent='Baixar PDF'; }
}

async function copiarLink(){
  const i=el('q-url');
  try{await navigator.clipboard.writeText(i.value);toast('Link copiado.');}
  catch(e){i.select();toast('Selecione e copie o link (Ctrl+C).');}
}

// ---------- relatório semestral ----------
const semKey=d=>d?d.slice(0,4)+'.'+(+d.slice(5,7)<=6?1:2):'';
const semLabel=k=>{const [y,s]=k.split('.');return `${s}º semestre de ${y}`;};
function custosDe(cs,ps,as){
  const pm=new Map(ps.map(p=>[p.id,p])), out={};
  cs.forEach(c=>{
    const list=as.filter(a=>a.corpo_id===c.id).sort((x,y)=>((x.data||'')+(x.created_at||'')).localeCompare((y.data||'')+(y.created_at||'')));
    let acc=Math.min(Math.max(Number(c.uso_inicial||0),0),100);
    list.forEach(a=>{const p=pm.get(a.procedimento_id),nom=(p?Number(p.pct_por_aluno||0):0)*Number(a.num_alunos||0),ap=Math.min(nom,Math.max(100-acc,0));out[a.id]=Number(c.valor||0)*ap/100;acc+=ap;});
  });
  return out;
}
function avEscopo(){return el('av-esc').value||'unidade';}
async function avData(){
  if(avEscopo()==='unidade') return {unids:[cur],corpos,procs,aulas,sessoes,respostas};
  if(avAll) return avAll;
  el('av-rep').innerHTML='<div class="tablewrap"><div class="empty">Carregando dados de todas as unidades…</div></div>';
  const [a,b,c,d,e]=await Promise.all(['cadaver_corpos','cadaver_procedimentos','cadaver_aulas','cadaver_sessoes','cadaver_nps_respostas'].map(t=>db.from(t).select('*')));
  const er=a.error||b.error||c.error||d.error||e.error;
  if(er){toast('Erro: '+errMsg(er),true);return null;}
  avAll={unids:unidades,corpos:a.data,procs:b.data,aulas:c.data,sessoes:d.data,respostas:e.data};
  return avAll;
}
function avSemestres(D){
  const ks=new Set([semKey(today())]); D.sessoes.forEach(s=>s.data&&ks.add(semKey(s.data)));
  return [...ks].sort().reverse();
}
async function renderAval(){
  if(!cur) return;
  if(respErr){el('av-rep').innerHTML=`<div class="warnbox">${esc(errMsg(respErr))}</div>`;el('av-resp').innerHTML='';return;}
  const D=await avData(); if(!D) return;
  const sel=el('av-sem'), keep=sel.value, ks=avSemestres(D);
  sel.innerHTML=ks.map(k=>`<option value="${k}" ${k===keep?'selected':''}>${semLabel(k)}</option>`).join('');
  if(!ks.includes(keep)) sel.value=ks[0];
  const sem=sel.value, todas=avEscopo()==='todas';
  const custo=custosDe(D.corpos,D.procs,D.aulas);
  const uNome=id=>(D.unids.find(u=>u.id===id)||{}).nome||'—';
  const ses=D.sessoes.filter(s=>semKey(s.data)===sem).map(s=>{
    const ls=D.aulas.filter(a=>a.sessao_id===s.id), rs=D.respostas.filter(r=>r.sessao_id===s.id);
    const al=Number(s.total_alunos)>0?Number(s.total_alunos):ls.reduce((t,a)=>Math.max(t,Number(a.num_alunos||0)),0);
    return {s,ls,rs,al,custo:ls.reduce((t,a)=>t+(custo[a.id]||0),0)};
  });
  const rs=ses.flatMap(x=>x.rs), alunos=ses.reduce((t,x)=>t+x.al,0), inv=ses.reduce((t,x)=>t+x.custo,0);
  const alAval=ses.filter(x=>x.s.nps_token).reduce((t,x)=>t+x.al,0);
  const k=npsCalc(rs), f=formCalc(rs);
  const invAl=alunos?inv/alunos:0, promEst=k&&alunos?alunos*k.P/k.n:0;
  const titulo=todas?'IDOMED · todas as unidades':cur.nome;
  const grp=(keyf)=>{const m=new Map();ses.forEach(x=>{const kk=keyf(x)||'—';if(!m.has(kk))m.set(kk,[]);m.get(kk).push(x);});
    return [...m.entries()].map(([nome,xs])=>{const r=xs.flatMap(x=>x.rs),a=xs.reduce((t,x)=>t+x.al,0),c=xs.reduce((t,x)=>t+x.custo,0);return {nome,dias:xs.length,al:a,inv:c,invAl:a?c/a:0,n:r.length,f:formCalc(r),k:npsCalc(r)};}).sort((a,b)=>b.al-a.al);};
  const linhas=todas?grp(x=>uNome(x.s.unidade_id)):grp(x=>(x.s.curso||'').trim());
  const vozes=[...rs].filter(r=>(r.comentario||'').trim()).sort((a,b)=>(b.nota_formacao-a.nota_formacao)||(b.created_at||'').localeCompare(a.created_at||'')).slice(0,6);
  const fmtN=v=>v==null?'—':NUM.format(v);
  el('av-rep').innerHTML=`
  <article class="rep" id="rep">
    <header class="rep-h">
      <div class="rep-brand"><img class="itc-l" src="logo-itc.png" alt="ITC"><img class="itc-d" src="logo-itc-escuro.png" alt="ITC"><span class="sep"></span><img class="idomed" src="logo-idomed.png" alt="IDOMED"></div>
      <div><small>Relatório semestral · aulas práticas em cadáver fresco</small><h3>${esc(titulo)}</h3><p>${semLabel(sem)} · gerado em ${new Date().toLocaleDateString('pt-BR')}</p></div>
    </header>
    ${ses.length?`
    <p class="rep-lead">${f?`<b>${NUM.format(Math.round(f.alta))}%</b> dos alunos que avaliaram disseram que a aula em cadáver fresco <b>acrescentou muito</b> (nota 9 ou 10) à sua formação médica. A nota média foi <b>${NUM.format(f.media)}</b> de 10.`:'Ainda não há avaliações dos alunos neste semestre. Gere o link de avaliação nos dias de aula para medir a contribuição percebida.'}</p>
    <div class="kpis rep-k">
      ${kpi('Alunos atendidos',NUM.format(alunos),'lead')}
      ${kpi('Dias de aula prática',ses.length,'')}
      ${kpi('Investimento em material anatômico',money(inv),'warn')}
      ${kpi('Investimento por aluno',money(invAl),'')}
      ${kpi('Contribuição para a formação',f?NUM.format(f.media)+' <small>/10</small>':'—','accent')}
      ${kpi('NPS da aula',k?`<span class="npsv ${npsCls(k.nps)}">${k.nps}</span>`:'—','')}
      ${kpi('Avaliações recebidas',`${rs.length}${alAval?` <small>(${NUM.format(Math.round(rs.length/alAval*100))}% dos alunos)</small>`:''}`,'small')}
      ${kpi('Investimento por aluno promotor (estimado)',promEst?money(inv/promEst):'—','small')}
    </div>
    ${k?`<div class="npsbar" aria-label="Composição do NPS"><i class="d" style="width:${k.D/k.n*100}%"></i><i class="n" style="width:${k.N/k.n*100}%"></i><i class="p" style="width:${k.P/k.n*100}%"></i></div>
    <div class="npslg"><span><i class="d"></i>Detratores (0–6) ${k.D}</span><span><i class="n"></i>Neutros (7–8) ${k.N}</span><span><i class="p"></i>Promotores (9–10) ${k.P}</span></div>`:''}
    <div class="grid2 mt">
      <div class="panel"><h4>Quanto a aula acrescentou à formação</h4><div class="cap">Distribuição das notas de 0 a 10 dadas pelos alunos.</div><div class="chart-box"><canvas id="c-av-dist"></canvas></div></div>
      <div class="panel"><h4>Investimento por aluno × contribuição percebida</h4><div class="cap">Cada ponto é ${todas?'uma unidade':'um curso ou turma'}. Mais acima e à esquerda = mais retorno por real investido.</div><div class="chart-box"><canvas id="c-av-sc"></canvas></div></div>
    </div>
    <div class="panel mt"><h4>Por ${todas?'unidade':'curso ou turma'}</h4>
      <div class="tablewrap flat"><table><thead><tr><th>${todas?'Unidade':'Curso ou turma'}</th><th class="n">Dias</th><th class="n">Alunos</th><th class="n">Investimento</th><th class="n">Por aluno</th><th class="n">Avaliações</th><th class="n">Formação (0–10)</th><th class="n">NPS</th></tr></thead><tbody>
      ${linhas.map(l=>`<tr><td>${esc(l.nome)}</td><td class="n">${l.dias}</td><td class="n">${l.al}</td><td class="n">${money(l.inv)}</td><td class="n">${money(l.invAl)}</td><td class="n">${l.n}</td><td class="n">${l.f?fmtN(l.f.media):'—'}</td><td class="n">${l.k?`<span class="npsv ${npsCls(l.k.nps)}">${l.k.nps}</span>`:'—'}</td></tr>`).join('')}
      </tbody></table></div>
      ${rs.length&&rs.length<30?'<p class="foothint">Com menos de 30 avaliações, o NPS pode variar bastante de uma aula para outra. Leia os números junto com os comentários.</p>':''}
    </div>
    ${vozes.length?`<div class="panel mt"><h4>O que os alunos disseram</h4><div class="vozes">${vozes.map(r=>`<blockquote><p>“${esc(r.comentario.trim())}”</p><footer>Formação ${r.nota_formacao}/10 · recomendação ${r.nota_recomendacao}/10${r.nome?' · '+esc(r.nome):''}</footer></blockquote>`).join('')}</div></div>`:''}
    <p class="foothint">Investimento em material anatômico = parte do valor das peças consumida nas aulas do semestre (depreciação por tipo de aula × alunos). Investimento por aluno promotor = investimento ÷ (alunos atendidos × % de promotores entre os que avaliaram).</p>
    `:`<div class="empty"><b>Sem dias de aula neste semestre</b>Escolha outro semestre ou registre aulas na aba Aulas.</div>`}
  </article>`;
  if(ses.length){
    const cOk=cssv('--green'),cMid=cssv('--warn'),cHot=cssv('--danger'),grid=cssv('--line'),txt=cssv('--muted');
    const dist=Array.from({length:11},(_,i)=>rs.filter(r=>r.nota_formacao===i).length);
    mkChart('c-av-dist',{type:'bar',data:{labels:dist.map((_,i)=>String(i)),datasets:[{data:dist,backgroundColor:dist.map((_,i)=>i>=9?cOk:i>=7?cMid:cHot),borderRadius:4,maxBarThickness:34}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+' aluno(s)'}}},scales:{y:{beginAtZero:true,ticks:{color:txt,precision:0},grid:{color:grid}},x:{ticks:{color:txt},grid:{display:false},title:{display:true,text:'Nota',color:txt}}}}});
    const pts=linhas.filter(l=>l.f&&l.al).map(l=>({x:+l.invAl.toFixed(2),y:+l.f.media.toFixed(2),nome:l.nome}));
    mkChart('c-av-sc',{type:'scatter',data:{datasets:[{data:pts,backgroundColor:cssv('--chart-2'),pointRadius:7,pointHoverRadius:9}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.nome}: ${money(c.raw.x)} por aluno · formação ${NUM.format(c.raw.y)}`}}},
        scales:{x:{title:{display:true,text:'Investimento por aluno (R$)',color:txt},ticks:{color:txt,callback:v=>'R$ '+NUM.format(v)},grid:{color:grid},beginAtZero:true},y:{min:0,max:10,title:{display:true,text:'Contribuição (0–10)',color:txt},ticks:{color:txt},grid:{color:grid}}}}});
  }
  renderRespostas(D,ses);
}
function renderRespostas(D,ses){
  const fx=el('av-filtro').value, todas=avEscopo()==='todas';
  const sm=new Map(ses.map(x=>[x.s.id,x.s]));
  const list=ses.flatMap(x=>x.rs).filter(r=>!fx||(fx==='p'?r.nota_recomendacao>=9:fx==='n'?r.nota_recomendacao>=7&&r.nota_recomendacao<=8:fx==='d'?r.nota_recomendacao<=6:(r.comentario||'').trim()))
    .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  const w=el('av-resp');
  if(!list.length){w.innerHTML='<div class="tablewrap"><div class="empty"><b>Nenhuma resposta</b>As respostas aparecem aqui assim que os alunos enviarem a avaliação.</div></div>';return;}
  const uN=id=>(D.unids.find(u=>u.id===id)||{}).nome||'—';
  w.innerHTML='<div class="tablewrap"><table><thead><tr><th>Recebida</th>'+(todas?'<th>Unidade</th>':'')+'<th>Dia de aula</th><th class="n">Formação</th><th class="n">Recomendação</th><th>Comentário</th><th>Identificação</th><th></th></tr></thead><tbody>'+
    list.map(r=>{const s=sm.get(r.sessao_id)||{},c=r.nota_recomendacao>=9?'ok':r.nota_recomendacao>=7?'mid':'hot';
      return `<tr><td>${fmtDH(r.created_at)}</td>${todas?`<td>${esc(uN(r.unidade_id))}</td>`:''}<td>${fmtFull(s.data)}${s.curso?' · '+esc(s.curso):''}</td><td class="n"><b>${r.nota_formacao}</b></td><td class="n"><span class="pct ${c}">${r.nota_recomendacao}</span></td><td class="wrapcell">${esc(r.comentario||'')}</td><td>${r.nome||r.email?esc([r.nome,r.email].filter(Boolean).join(' · ')):'<span class="muted">anônimo</span>'}</td><td>${todas?'':`<button class="icon" title="Excluir resposta" onclick="delResposta(${r.id})">${TRASH}</button>`}</td></tr>`;}).join('')+'</tbody></table></div>';
}
async function delResposta(id){
  const ok=await ask({title:'Excluir esta resposta?',body:'Use só para respostas indevidas (teste, duplicada ou fora de contexto). Ela sai do relatório.'});
  if(!ok) return;
  const {error}=await db.from('cadaver_nps_respostas').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  respostas=respostas.filter(r=>r.id!==id); avAll=null; renderAll(); renderAval(); toast('Resposta excluída.');
}
function imprimirRel(){document.body.classList.add('print-av');setTimeout(()=>{window.print();setTimeout(()=>document.body.classList.remove('print-av'),300);},50);}
function exportRespostas(){
  const sem=el('av-sem').value, D=avEscopo()==='todas'?avAll:{unids:[cur],sessoes,respostas};
  if(!D) return;
  const sm=new Map(D.sessoes.map(s=>[s.id,s])), uN=id=>(D.unids.find(u=>u.id===id)||{}).nome||'';
  const rows=D.respostas.filter(r=>semKey((sm.get(r.sessao_id)||{}).data)===sem);
  const head=['Unidade','Data da aula','Curso ou turma','Recebida em','Formação (0-10)','Recomendação (0-10)','Categoria NPS','Comentário','Nome','E-mail'];
  const lines=[head.join(';')];
  rows.forEach(r=>{const s=sm.get(r.sessao_id)||{};lines.push([uN(r.unidade_id),fmtFull(s.data),s.curso||'',fmtDH(r.created_at),r.nota_formacao,r.nota_recomendacao,r.nota_recomendacao>=9?'Promotor':r.nota_recomendacao>=7?'Neutro':'Detrator',r.comentario||'',r.nome||'',r.email||''].map(x=>`"${(x??'').toString().replace(/"/g,'""')}"`).join(';'));});
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='avaliacoes-'+sem.replace('.','-')+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u);
  toast('CSV exportado.');
}

// ================= LOGIN (Supabase Auth) =================
let usuario=null, recuperando=false;
function showView(v){
  el('view-login').hidden=v!=='login'; el('view-units').hidden=v!=='units'; el('view-unit').hidden=v!=='unit';
  el('who').hidden=v==='login';
}
function loginMsg(id,msg,ok){const b=el(id);b.textContent=msg||'';b.hidden=!msg;b.classList.toggle('ok',!!ok);}
function showLogin(form){
  showView('login'); el('lg-boot').hidden=true;
  el('f-login').hidden=form==='nova'; el('f-nova').hidden=form!=='nova';
  setTimeout(()=>el(form==='nova'?'ns-s1':'lg-email').focus(),30);
}
async function entrar(ev){
  ev.preventDefault();
  const email=el('lg-email').value.trim(), password=el('lg-senha').value;
  if(!email||!password){loginMsg('lg-err','Preencha o e-mail e a senha.');return;}
  const b=el('lg-btn'); b.disabled=true; b.textContent='Entrando…'; loginMsg('lg-err','');
  const {data,error}=await db.auth.signInWithPassword({email,password});
  b.disabled=false; b.textContent='Entrar';
  if(error){
    const m=error.message||'';
    loginMsg('lg-err',/invalid login|invalid credentials/i.test(m)?'E-mail ou senha incorretos.':/email not confirmed/i.test(m)?'Este e-mail ainda não foi confirmado. Peça para a coordenação confirmar o seu acesso.':'Não foi possível entrar: '+m);
    return;
  }
  el('lg-senha').value='';
  const u=data.session.user, md=u.user_metadata||{};
  db.from('cadaver_historico').insert({acao:'entrou',usuario_id:u.id,usuario_email:u.email,usuario_nome:md.nome||md.name||null}).then(()=>{},()=>{});
  await entrouComo(data.session);
}
async function entrouComo(session){
  usuario=session.user;
  const nome=(usuario.user_metadata&&(usuario.user_metadata.nome||usuario.user_metadata.name))||'';
  el('who-mail').textContent=nome||usuario.email;
  if(!el('ns-resp').value) el('ns-resp').value=nome||'';
  showView('units'); el('ugrid').innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  await bootUnits();
}
async function sair(){
  usuario=null;
  await db.auth.signOut();
   cur=null; corpos=[];procs=[];aulas=[];sessoes=[];anexos=[];unidades=[];
  closePeca(); showLogin('login'); loginMsg('lg-err','');
}
async function esqueci(){
  const email=el('lg-email').value.trim();
  if(!email){loginMsg('lg-err','Digite seu e-mail no campo acima e clique de novo em “Esqueci minha senha”.');el('lg-email').focus();return;}
  const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  if(error){loginMsg('lg-err','Não foi possível enviar o e-mail: '+error.message);return;}
  loginMsg('lg-err','Se este e-mail tiver acesso, você vai receber um link para criar uma nova senha.',true);
}
async function novaSenha(ev){
  ev.preventDefault();
  const a=el('ns-s1').value, b=el('ns-s2').value;
  if(a.length<8){loginMsg('nv-err','A senha precisa ter pelo menos 8 caracteres.');return;}
  if(a!==b){loginMsg('nv-err','As duas senhas não são iguais.');return;}
  const {data,error}=await db.auth.updateUser({password:a});
  if(error){loginMsg('nv-err','Não foi possível salvar: '+error.message);return;}
  recuperando=false; el('ns-s1').value=''; el('ns-s2').value='';
  history.replaceState(null,'',location.pathname);
  toast('Senha alterada.');
  const {data:{session}}=await db.auth.getSession();
  if(session) await entrouComo(session); else showLogin('login');
}
db.auth.onAuthStateChange((evt,session)=>{
  if(evt==='PASSWORD_RECOVERY'){recuperando=true;showLogin('nova');}
  else if(evt==='SIGNED_OUT'&&usuario){usuario=null;cur=null;closePeca();showLogin('login');loginMsg('lg-err','Sua sessão terminou. Entre novamente.');}
});
(async()=>{
  if(/type=recovery/.test(location.hash)){recuperando=true;}
  const {data:{session}}=await db.auth.getSession();
  if(recuperando){showLogin('nova');return;}
  if(session) await entrouComo(session); else showLogin('login');
})();
