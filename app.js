// Central de Controle Anatômico – IDOMED · v2
// SUPABASE_URL e SUPABASE_KEY vêm de config.js
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const NUM = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const money = v => BRL.format(isFinite(v)?v:0);
const pct = v => NUM.format(isFinite(v)?v:0)+'%';
const esc = s => (s??'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv');
const el = id => document.getElementById(id);
const TRASH = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  corpos=[];procs=[];aulas=[];sessoes=[];anexos=[]; renderAll();
  const {error}=await load();
  if(error){toast('Erro ao carregar: '+errMsg(error),true);}
  if(cur&&cur.id===id) renderAll();
}

// ---------- abas ----------
function showTab(t){
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id==='tab-'+t));
  if(t==='rel'){ renderDash(); renderRel(); }
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
  const [r1,r2,r3,r4,r5]=await Promise.all([
    db.from('cadaver_corpos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_procedimentos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_aulas').select('*').eq('unidade_id',uid).order('data'),
    db.from('cadaver_sessoes').select('*').eq('unidade_id',uid).order('data',{ascending:false}),
    db.from('cadaver_anexos').select('*').eq('unidade_id',uid).order('created_at',{ascending:false})
  ]);
  if(!cur||cur.id!==uid) return {};
  const e=r1.error||r2.error||r3.error;
  if(e) return {error:e};
  corpos=r1.data||[]; procs=r2.data||[]; aulas=r3.data||[];
  sessoes=r4.error?[]:(r4.data||[]); anexos=r5.error?[]:(r5.data||[]);
  if(r4.error||r5.error) return {error:r4.error||r5.error};
  return {};
}
function renderAll(){
  recompute(); fillLists(); fillSelects();
  renderPecas(); renderLines(); renderAulas(); renderAnexos(); renderProcs(); renderSim();
  if(el('tab-rel').classList.contains('active')){ renderDash(); renderRel(); }
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
  const nomeP=c=>esc(c.nome)+(c.especime?' · '+esc(c.especime):'');
  const optC=corpos.map(c=>`<option value="${c.id}">${nomeP(c)}</option>`).join('');
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
  {k:'nome',l:'Código original',req:1},
  {k:'codigo_final',l:'Código final'},
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
function renderPecas(){
  const q=(el('pc-busca').value||'').trim().toLowerCase();
  const list=corpos.filter(c=>!q||[c.nome,c.codigo_final,c.especime,c.local_atual,c.processamento,c.fornecedor,c.invoice].some(v=>(v||'').toLowerCase().includes(q)));
  const tot=corpos.reduce((s,c)=>s+Number(c.valor||0),0);
  const esg=corpos.filter(c=>pctDoCorpo(c.id)>=100).length;
  el('pc-resumo').innerHTML=corpos.length?`<span class="chip"><b>${corpos.length}</b> peças</span><span class="chip"><b>${money(tot)}</b> em acervo</span><span class="chip"><b>${money(corpos.reduce((s,c)=>s+residualCorpo(c),0))}</b> de valor residual</span>${esg?`<span class="chip"><b>${esg}</b> esgotada(s)</span>`:''}`:'';
  const w=el('w-pecas');
  if(!corpos.length){w.innerHTML='<div class="empty"><b>Nenhuma peça cadastrada nesta unidade</b>Clique em “+ Nova peça” para cadastrar a primeira peça do acervo.</div>';return;}
  if(!list.length){w.innerHTML='<div class="empty"><b>Nenhuma peça encontrada</b>Nenhuma peça corresponde à busca.</div>';return;}
  let h='<table><thead><tr><th>Código</th><th>Espécimen</th><th>Processamento</th><th>Local atual</th><th>Sexo · idade</th><th>Chegada</th><th class="n">Valor</th><th>Σ uso</th><th>Status</th><th>Drive</th></tr></thead><tbody>';
  list.forEach(c=>{
    const p=pctDoCorpo(c.id), lv=nivel(p);
    h+=`<tr class="click" onclick="openPeca('${c.id}')" tabindex="0" onkeydown="if(event.key==='Enter')openPeca('${c.id}')">
      <td><span class="code">${esc(c.nome)}</span>${c.codigo_final?`<span class="sub">final: ${esc(c.codigo_final)}</span>`:''}</td>
      <td>${esc(c.especime||'—')}</td>
      <td>${esc(c.processamento||'—')}</td>
      <td>${esc(c.local_atual||'—')}</td>
      <td>${esc([c.sexo,c.idade?c.idade+' anos':''].filter(Boolean).join(' · ')||'—')}</td>
      <td>${c.data_aquisicao?fmtFull(c.data_aquisicao):'—'}</td>
      <td class="n">${money(c.valor)}</td>
      <td><div class="uso"><div class="bar"><i class="${lv}" style="width:${Math.min(p,100)}%"></i></div><span class="num">${pct(p)}</span></div></td>
      <td><span class="pill ${lv}">${rotulo(p)}</span></td>
      <td>${c.link_drive?`<a class="drive" href="${esc(safeUrl(c.link_drive))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Abrir ↗</a>`:'<span class="muted">—</span>'}</td>
    </tr>`;
  });
  w.innerHTML=h+'</tbody></table>';
}
function safeUrl(u){u=(u||'').trim();if(!u)return'';if(!/^https?:\/\//i.test(u))u='https://'+u;return u;}
function openPeca(id){
  curPeca=id; const c=id?corpoById(id):{};
  el('pf-grid').innerHTML=PF.map(f=>{
    if(f.calc) return `<div class="field"><label>${f.l}</label><div class="calcv" id="pf-${f.k}">—</div></div>`;
    const v=c[f.k]??'';
    let inp;
    if(f.opts) inp=`<select id="pf-${f.k}">${f.opts.map(([val,lab])=>`<option value="${val}" ${String(v)===val?'selected':''}>${lab}</option>`).join('')}</select>`;
    else inp=`<input id="pf-${f.k}" type="${f.type||'text'}" ${f.step?`step="${f.step}" min="0"`:''} ${f.list?`list="${f.list}"`:''} value="${esc(v)}" placeholder="${esc(f.ph||'')}">`;
    return `<div class="field ${f.req?'req':''}"><label for="pf-${f.k}">${f.l}</label>${inp}</div>`;
  }).join('');
  el('pf-link_drive').value=c.link_drive||'';
  el('pf-del').hidden=!id; el('pf-hist-wrap').hidden=!id; el('pf-ringwrap').hidden=!id;
  el('pf-link_drive').oninput=updDrive; updDrive();
  el('pf-nome').oninput=()=>{el('pf-title').textContent=el('pf-nome').value.trim()||'Nova peça';};
  el('pf-title').textContent=c.nome||'Nova peça';
  fillPecaCalc();
  el('pmodal').hidden=false; el('pmodal').scrollTop=0;
  document.body.style.overflow='hidden';
  setTimeout(()=>el('pf-nome').focus(),30);
}
function updDrive(){const u=safeUrl(el('pf-link_drive').value);const a=el('pf-drive-open');a.hidden=!u;if(u)a.href=u;}
function fillPecaCalc(){
  const c=curPeca?corpoById(curPeca):null;
  const tags=c?[c.especime,c.local_atual,c.processamento].filter(Boolean).map(t=>`<span class="tag">${esc(t)}</span>`).join('')+(c.sexo?`<span class="tag n">${c.sexo==='F'?'♀ Fem.':'♂ Masc.'}</span>`:''):'';
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
  const ok=await ask({title:'Excluir a peça '+(c?c.nome:'')+'?', body: n? `Os <b>${n} uso(s)</b> desta peça nas aulas também serão apagados.` : 'Esta peça não tem usos registrados.'});
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
  const optC=corpos.map(c=>[c.id,c.nome+(c.especime?' · '+c.especime:'')+(pctDoCorpo(c.id)>=100?' (esgotada)':'')]);
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
  const optC=corpos.map(c=>`<option value="${c.id}">${esc(c.nome)}${c.especime?' · '+esc(c.especime):''}</option>`).join('');
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
  const corpoOpts=sel=>corpos.map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.nome)}</option>`).join('');
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
  const ok=await ask({title:'Remover esta peça do dia?', body: a? `${esc(c?c.nome:'—')} · ${fmtFull(a.data)} · ${a.num_alunos} aluno(s). O custo sai dos totais.` : '', ok:'Remover'});
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
    const url=db.storage.from('anexos').getPublicUrl(path).data.publicUrl;
    Object.assign(row,{tipo:'arquivo',url,arquivo_path:path,tamanho:f.size,mime:f.type||null});
  }
  const {data,error}=await db.from('cadaver_anexos').insert(row).select().single();
  if(error){ if(row.arquivo_path) await db.storage.from('anexos').remove([row.arquivo_path]); toast('Erro: '+errMsg(error),true);return;}
  anexos.unshift(data); ['ax-titulo','ax-url','ax-desc'].forEach(i=>el(i).value=''); el('ax-file').value='';
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
        <a class="btn ghost sm" href="${esc(a.url)}" target="_blank" rel="noopener">${a.tipo==='arquivo'?'Abrir arquivo':'Abrir link'} ↗</a>
        <button class="icon del" title="Excluir anexo" onclick="delAnexo('${a.id}')">${TRASH}</button></div>`;}).join('')+'</div></div>';
  }).join('');
}

// ================= DEPRECIAÇÃO (tipos de aula + simulador) =================
async function addProc(){
  const nome=el('np-nome').value.trim();
  if(!nome){toast('Dê um nome ao tipo de aula.',true);return;}
  const p=Number(el('np-pct').value||0);
  if(!(p>0)){toast('Informe o percentual por aluno.',true);return;}
  const row={nome, pct_por_aluno:p, descricao:el('np-desc').value.trim()||null, unidade_id:cur.id};
  const {data,error}=await db.from('cadaver_procedimentos').insert(row).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  procs.push(data); ['np-nome','np-pct','np-desc'].forEach(i=>el(i).value='');
  renderAll(); toast('Tipo de aula adicionado.');
}
async function saveProc(id,field,val){
  const p=procById(id); if(!p)return;
  if(field==='pct_por_aluno') val=Number(val||0);
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
  const r=await db.from('cadaver_procedimentos').select('nome,pct_por_aluno,descricao').eq('unidade_id',from).order('created_at');
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
  let h='<table><thead><tr><th>Tipo de aula</th><th class="n">% por aluno</th><th class="n">Alunos até esgotar</th><th class="n">Usos lançados</th><th class="n">Custo acumulado</th><th>Descrição</th><th></th></tr></thead><tbody>';
  procs.forEach(p=>{
    const as=aulas.filter(a=>a.procedimento_id===p.id), tot=as.reduce((s,a)=>s+custoAula(a),0);
    const ate=p.pct_por_aluno>0? 100/Number(p.pct_por_aluno) : 0;
    h+=`<tr>
      <td><input value="${esc(p.nome)}" aria-label="Tipo de aula" onchange="saveProc('${p.id}','nome',this.value)"></td>
      <td class="n"><input class="w-int num" type="number" min="0" step="0.01" value="${p.pct_por_aluno}" aria-label="% por aluno" onchange="saveProc('${p.id}','pct_por_aluno',this.value)"></td>
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
  mkChart('c-corpo',baseBar(corpos.map(c=>c.nome),corpos.map(c=>+custoUsadoCorpo(c).toFixed(2)),T,corpos.length>6));
  const byM=groupSum([...aulas].sort((a,b)=>(a.data||'').localeCompare(b.data||'')),a=>(a.data||'').slice(0,7),custoAula);
  mkChart('c-mes',baseBar(Object.keys(byM).map(fmtMes),Object.values(byM).map(v=>+v.toFixed(2)),T));
  const byP=groupSum(aulas,a=>{const p=procById(a.procedimento_id);return p?p.nome:'sem tipo';},custoAula);
  mkChart('c-proc',baseBar(Object.keys(byP),Object.values(byP).map(v=>+v.toFixed(2)),G,true));
  el('deprec-list').innerHTML = corpos.length? corpos.map(c=>{
    const p=pctDoCorpo(c.id),lv=nivel(p);
    return `<div class="drow">
      <div class="nm" title="${esc(c.nome)}">${esc(c.nome)}</div>
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
    h+=`<tr><td>${fmtFull(a.data)}</td><td>${esc(s.curso||'—')}</td><td>${esc(s.responsavel||'—')}</td><td class="n">${s.total_alunos??'—'}</td><td>${esc(c.nome||'—')}</td><td>${esc(p?p.nome:'sem tipo')}</td><td class="n">${a.num_alunos}</td><td class="n">${pct(pctAluno(a))}</td><td class="n">${pct(depAula(a))}</td><td class="n calc">${money(custoAula(a))}</td><td class="n">${money(custoAluno(a))}</td></tr>`;});
  w.innerHTML=h+'</tbody></table>';
}
function exportCSV(){
  const rows=filtered();
  const head=['Unidade','Data','Curso','Responsável','Alunos na aula','Código da peça','Espécimen','Valor da peça','Tipo de aula','Alunos na peça','% por aluno','Depreciação (%)','Custo','Custo por aluno','Observações do dia'];
  const dec=v=>Number(v).toFixed(2).replace('.',',');
  const lines=[head.join(';')];
  rows.forEach(a=>{const c=corpoById(a.corpo_id)||{},p=procById(a.procedimento_id),s=sessById(a.sessao_id)||{};
    lines.push([cur.nome,fmtFull(a.data),s.curso||'',s.responsavel||'',s.total_alunos??'',c.nome||'',c.especime||'',dec(c.valor||0),p?p.nome:'',a.num_alunos,dec(pctAluno(a)),dec(depAula(a)),
      dec(custoAula(a)),dec(custoAluno(a)),s.observacao||''].map(x=>`"${(x??'').toString().replace(/"/g,'""')}"`).join(';'));
  });
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='usos-pecas-'+slug(cur.nome)+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u);
  toast('CSV exportado.');
}

// redesenha os gráficos quando o tema do sistema muda
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(cur&&el('tab-rel').classList.contains('active'))renderDash();});

bootUnits();
