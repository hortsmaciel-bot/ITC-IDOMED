// SUPABASE_URL e SUPABASE_KEY vêm de js/config.js
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const NUM = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const money = v => BRL.format(isFinite(v)?v:0);
const pct = v => NUM.format(isFinite(v)?v:0)+'%';
const esc = s => (s??'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv');
const el = id => document.getElementById(id);
const TRASH = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let unidades=[], resumo={}, cur=null;
let corpos=[], procs=[], aulas=[];
let applied={}; // aula.id -> {nominal, aplicado, capped}

// ---------- toast ----------
let tt; function toast(msg,err){const t=el('toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(tt);tt=setTimeout(()=>t.className='toast',2600);}
function errMsg(e){
  if(!e) return '';
  if(e.code==='23505') return 'Já existe um registro com esse nome.';
  if(/unidade_id|cadaver_unidades/.test(e.message||'')) return 'O banco ainda não tem a estrutura de unidades. Rode o script de migração no Supabase.';
  return e.message;
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
    const done=v=>{m.hidden=true;document.removeEventListener('keydown',key);res(v);};
    const key=e=>{if(e.key==='Escape')done(false);};
    document.addEventListener('keydown',key);
    okb.onclick=()=>done(true); el('m-cancel').onclick=()=>done(false);
    m.onclick=e=>{if(e.target===m)done(false);};
  });
}

// ================= UNIDADES =================
async function bootUnits(){
  const r=await db.from('cadaver_unidades').select('*').order('created_at');
  if(r.error){
    showSetup('Não foi possível ler a lista de unidades ('+esc(r.error.message)+'). Se ainda não rodou o script de migração no Supabase, rode-o e recarregue a página.');
    el('ugrid').innerHTML=''; return;
  }
  unidades=r.data||[];
  await loadResumo();
  renderUnits();
}
function showSetup(html){const s=el('setup');s.innerHTML='<b>Atenção.</b> '+html;s.hidden=false;}
async function loadResumo(){
  resumo={};
  const [c,a]=await Promise.all([
    db.from('cadaver_corpos').select('unidade_id,valor'),
    db.from('cadaver_aulas').select('unidade_id,num_alunos')
  ]);
  if(c.error||a.error){showSetup(esc(errMsg(c.error||a.error)));return;}
  const r=id=>resumo[id]??={corpos:0,valor:0,aulas:0,alunos:0};
  c.data.forEach(x=>{const o=r(x.unidade_id);o.corpos++;o.valor+=Number(x.valor||0);});
  a.data.forEach(x=>{const o=r(x.unidade_id);o.aulas++;o.alunos+=Number(x.num_alunos||0);});
}
function renderUnits(){
  const cards=unidades.map(u=>{
    const s=resumo[u.id]||{corpos:0,valor:0,aulas:0};
    return `<article class="ucard">
      <button class="icon del" title="Excluir unidade" aria-label="Excluir ${esc(u.nome)}" onclick="delUnit('${u.id}')">${TRASH}</button>
      <button class="open" onclick="openUnit('${u.id}')">
        <div class="uname"><small>Unidade</small>${esc(u.nome)}</div>
        <div class="ustats">
          <div><b>${s.corpos}</b><span>corpos</span></div>
          <div><b>${s.aulas}</b><span>aulas</span></div>
          <div><b>${s.valor>=1e5?NUM.format(Math.round(s.valor/1000))+' mil':NUM.format(Math.round(s.valor))}</b><span>R$ investidos</span></div>
        </div>
      </button>
      <div class="go" aria-hidden="true">Abrir unidade <span>→</span></div>
    </article>`;}).join('');
  el('ugrid').innerHTML=cards+`
    <form class="uadd" onsubmit="addUnit(event)">
      <h3>Nova unidade</h3>
      <p>Adicione outra unidade IDOMED. Ela começa vazia, com corpos e tipos de aula próprios.</p>
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
  const s=resumo[id]||{corpos:0,aulas:0};
  const vazio=!s.corpos&&!s.aulas;
  const ok=await ask({
    title:'Excluir '+u.nome+'?',
    body: vazio? 'A unidade não tem corpos nem aulas cadastrados.'
      : `Isso apaga também <b>${s.corpos} corpo(s)</b>, <b>${s.aulas} aula(s)</b> e os tipos de aula desta unidade. Não dá para desfazer.`,
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
  ['f-de','f-ate','na-obs','nc-nome','nc-valor','nc-forn','np-nome','np-pct','np-desc'].forEach(i=>el(i).value='');
  el('na-data').value=today(); el('nc-data').value=today(); el('na-alunos').value=1;
  showTab('dash');
  corpos=[];procs=[];aulas=[]; renderAll();
  const {error}=await load();
  if(error){toast('Erro ao carregar: '+errMsg(error),true);}
  if(cur&&cur.id===id) renderAll();
}

// ---------- abas ----------
function showTab(t){
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id==='tab-'+t));
  if(t==='dash') renderDash();
  if(t==='rel') renderRel();
}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

// ---------- cálculo ----------
const corpoById = id => corpos.find(c=>c.id===id);
const procById = id => procs.find(p=>p.id===id);
const pctAluno = a => { const p=procById(a.procedimento_id); return p? Number(p.pct_por_aluno||0) : 0; };
const nominalAula = a => pctAluno(a)*Number(a.num_alunos||0);
// Percorre as aulas de cada corpo em ordem de data e aplica o teto de 100%.
function recompute(){
  applied={};
  corpos.forEach(c=>{
    const list=aulas.filter(a=>a.corpo_id===c.id)
      .sort((x,y)=>((x.data||'')+(x.created_at||'')).localeCompare((y.data||'')+(y.created_at||'')));
    let acc=0;
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
const pctDoCorpo = id => aulas.filter(a=>a.corpo_id===id).reduce((s,a)=>s+depAula(a),0);
const custoUsadoCorpo = c => Number(c.valor||0)*pctDoCorpo(c.id)/100;

// ---------- carga ----------
async function load(){
  const uid=cur.id;
  const [r1,r2,r3]=await Promise.all([
    db.from('cadaver_corpos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_procedimentos').select('*').eq('unidade_id',uid).order('created_at'),
    db.from('cadaver_aulas').select('*').eq('unidade_id',uid).order('data')
  ]);
  const e=r1.error||r2.error||r3.error; if(e) return {error:e};
  if(!cur||cur.id!==uid) return {};
  corpos=r1.data||[]; procs=r2.data||[]; aulas=r3.data||[]; return {};
}
function renderAll(){ recompute(); renderCorpos(); renderProcs(); renderAulas(); fillSelects(); renderSim(); renderDash(); if(el('tab-rel').classList.contains('active')) renderRel(); }

// ---------- corpos ----------
async function addCorpo(){
  const nome=el('nc-nome').value.trim();
  if(!nome){toast('Dê uma identificação ao corpo.',true);return;}
  const row={nome, valor:Number(el('nc-valor').value||0), data_aquisicao:el('nc-data').value||null,
    fornecedor:el('nc-forn').value.trim()||null, unidade:cur.nome, unidade_id:cur.id};
  const {data,error}=await db.from('cadaver_corpos').insert(row).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  corpos.push(data); ['nc-nome','nc-valor','nc-forn'].forEach(i=>el(i).value='');
  renderAll(); toast('Corpo adicionado.');
}
async function saveCorpo(id,field,val){
  const c=corpoById(id); if(!c)return;
  if(field==='valor') val=Number(val||0);
  if(field==='data_aquisicao') val=val||null;
  c[field]=val;
  const {error}=await db.from('cadaver_corpos').update({[field]:val}).eq('id',id);
  if(error){toast('Erro ao salvar: '+errMsg(error),true);return;}
  renderAll(); toast('Salvo.');
}
async function delCorpo(id){
  const c=corpoById(id), n=aulas.filter(a=>a.corpo_id===id).length;
  const ok=await ask({title:'Excluir '+(c?c.nome:'corpo')+'?', body: n? `As <b>${n} aula(s)</b> ligadas a este corpo também serão apagadas.` : 'Este corpo não tem aulas lançadas.'});
  if(!ok)return;
  const {error}=await db.from('cadaver_corpos').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  corpos=corpos.filter(c=>c.id!==id); aulas=aulas.filter(a=>a.corpo_id!==id);
  renderAll(); toast('Corpo excluído.');
}
function nivel(p){return p>=90?'hot':p>=60?'mid':'ok';}
function rotulo(p){const lv=nivel(p);return p>=100?'esgotado':lv==='hot'?'quase esgotado':lv==='mid'?'em uso':'disponível';}
function renderCorpos(){
  const w=el('w-corpos');
  if(!corpos.length){w.innerHTML='<div class="empty"><b>Nenhum corpo cadastrado nesta unidade</b>Adicione o primeiro corpo no formulário acima.</div>';return;}
  let h='<table><thead><tr><th>Identificação</th><th class="n">Valor (R$)</th><th>Aquisição</th><th class="n">Aulas</th><th class="n">Alunos</th><th>Desgaste</th><th class="n">Custo já usado</th><th class="n">Residual</th><th>Fornecedor</th><th></th></tr></thead><tbody>';
  corpos.forEach(c=>{
    const p=pctDoCorpo(c.id), usado=custoUsadoCorpo(c), resid=Number(c.valor||0)-usado, lv=nivel(p);
    const as=aulas.filter(a=>a.corpo_id===c.id), al=as.reduce((s,a)=>s+Number(a.num_alunos||0),0);
    h+=`<tr>
      <td><input value="${esc(c.nome)}" aria-label="Identificação" onchange="saveCorpo('${c.id}','nome',this.value)"></td>
      <td class="n"><input class="w-val num" type="number" step="0.01" value="${c.valor}" aria-label="Valor" onchange="saveCorpo('${c.id}','valor',this.value)"></td>
      <td><input type="date" value="${c.data_aquisicao||''}" aria-label="Aquisição" onchange="saveCorpo('${c.id}','data_aquisicao',this.value)"></td>
      <td class="n">${as.length}</td>
      <td class="n">${al}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="width:90px"><i class="${lv}" style="width:${Math.min(p,100)}%"></i></div><span class="num" style="font-size:12.5px;color:var(--muted)">${pct(p)}</span></div></td>
      <td class="n">${money(usado)}</td>
      <td class="n" style="color:${resid<0?'var(--danger)':'inherit'}">${money(resid)}</td>
      <td><input value="${esc(c.fornecedor||'')}" aria-label="Fornecedor" onchange="saveCorpo('${c.id}','fornecedor',this.value)"></td>
      <td><button class="icon" title="Excluir corpo" onclick="delCorpo('${c.id}')">${TRASH}</button></td>
    </tr>`;
  });
  w.innerHTML=h+'</tbody></table>';
}

// ---------- tipos de aula ----------
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
  const ok=await ask({title:'Excluir '+(p?p.nome:'tipo de aula')+'?', body: n? `Há <b>${n} aula(s)</b> com este tipo. Elas ficam sem tipo e com custo zero até você escolher outro.` : 'Nenhuma aula usa este tipo.'});
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
  const rows=r.data.map(x=>({...x,unidade_id:cur.id}));
  const {data,error}=await db.from('cadaver_procedimentos').insert(rows).select();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  procs.push(...data); renderAll(); toast(data.length+' tipo(s) de aula copiados.');
}
function renderProcs(){
  const w=el('w-procs');
  if(!procs.length){
    const outras=unidades.filter(u=>cur&&u.id!==cur.id);
    w.innerHTML='<div class="empty"><b>Nenhum tipo de aula nesta unidade</b>Cadastre o primeiro tipo acima. Sem tipos não é possível lançar aulas.'+
      (outras.length?`<div class="copyrow"><select id="cp-from" aria-label="Unidade de origem">${outras.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select><button class="btn ghost sm" onclick="copyProcs()">Copiar tipos desta unidade</button></div>`:'')+'</div>';
    return;
  }
  let h='<table><thead><tr><th>Tipo de aula</th><th class="n">% por aluno</th><th class="n">Alunos até esgotar</th><th class="n">Aulas lançadas</th><th class="n">Custo acumulado</th><th>Descrição</th><th></th></tr></thead><tbody>';
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

// ---------- simulador ----------
function renderSim(){
  const c=corpoById(el('sim-corpo').value), p=procById(el('sim-proc').value), n=Number(el('sim-alunos').value||0);
  const out=el('sim-out');
  if(!c||!p||!(n>0)){out.innerHTML='<b>—</b><span>escolha corpo, tipo e alunos</span>';return;}
  const dep=Number(p.pct_por_aluno)*n, custo=Number(c.valor||0)*dep/100, porAluno=n?custo/n:0;
  const restante=Math.max(100-pctDoCorpo(c.id),0);
  const aviso=dep>restante? ` Este corpo só tem ${pct(restante)} de vida restante; o custo real ficaria em ${money(Number(c.valor||0)*restante/100)}.` : '';
  out.innerHTML=`<b>${money(custo)}</b><span>${pct(dep)} do corpo · ${money(porAluno)} por aluno.${aviso}</span>`;
}

// ---------- aulas ----------
function fillSelects(){
  const optC=corpos.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  const optP=procs.map(p=>`<option value="${p.id}">${esc(p.nome)} (${pct(p.pct_por_aluno)}/aluno)</option>`).join('');
  const keep=(id,html,first)=>{const s=el(id),v=s.value;s.innerHTML=first+html;if([...s.options].some(o=>o.value===v))s.value=v;};
  keep('na-corpo',optC,'<option value="">selecione</option>');
  keep('na-proc',optP,'<option value="">selecione</option>');
  keep('f-corpo',optC,'<option value="">Todos</option>');
  keep('f-proc',optP,'<option value="">Todos</option>');
  keep('sim-corpo',optC,'<option value="">selecione</option>');
  keep('sim-proc',optP,'<option value="">selecione</option>');
}
async function addAula(){
  const corpo_id=el('na-corpo').value;
  if(!corpo_id){toast('Escolha o corpo da aula.',true);return;}
  const procedimento_id=el('na-proc').value;
  if(!procedimento_id){toast('Escolha o tipo de aula.',true);return;}
  const alunos=parseInt(el('na-alunos').value||0);
  if(!(alunos>0)){toast('Informe o número de alunos.',true);return;}
  const p=procById(procedimento_id);
  const row={corpo_id, procedimento_id, procedimento:p?p.nome:null, data:el('na-data').value||today(),
    campus:cur.nome, unidade_id:cur.id, num_alunos:alunos, observacao:el('na-obs').value.trim()||null,
    peso:p?Number(p.pct_por_aluno):0, pontos:p?Number(p.pct_por_aluno)*alunos:0};
  const {data,error}=await db.from('cadaver_aulas').insert(row).select().single();
  if(error){toast('Erro: '+errMsg(error),true);return;}
  aulas.push(data); el('na-obs').value=''; el('na-alunos').value=1;
  renderAll(); toast('Aula lançada.');
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
  const ok=await ask({title:'Excluir esta aula?', body: a? `${fmtFull(a.data)} · ${esc(c?c.nome:'—')} · ${a.num_alunos} aluno(s). O custo dela sai dos totais.` : ''});
  if(!ok)return;
  const {error}=await db.from('cadaver_aulas').delete().eq('id',id);
  if(error){toast('Erro: '+errMsg(error),true);return;}
  aulas=aulas.filter(a=>a.id!==id); renderAll(); toast('Aula excluída.');
}
function corpoOptions(sel){return corpos.map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.nome)}</option>`).join('');}
function procOptions(sel){return '<option value="">sem tipo</option>'+procs.map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(p.nome)}</option>`).join('');}
function depCell(a){
  const s=applied[a.id]||{nominal:0,aplicado:0};
  if(!a.procedimento_id) return '<span class="pill hot">sem tipo</span>';
  if(s.capped) return `<span class="num">${pct(s.aplicado)}</span> <span class="pill hot" title="previsto ${pct(s.nominal)}, corpo esgotado">esgotado</span>`;
  return `<span class="num">${pct(s.aplicado)}</span>`;
}
function renderAulas(){
  const w=el('w-aulas');
  if(!aulas.length){w.innerHTML='<div class="empty"><b>Nenhuma aula lançada nesta unidade</b>Lance a primeira aula acima. O custo aparece automaticamente.</div>';return;}
  let h='<table><thead><tr><th>Data</th><th>Corpo</th><th>Tipo de aula</th><th class="n">Alunos</th><th class="n">Depreciação</th><th class="n">Custo aula</th><th class="n">Custo/aluno</th><th>Obs.</th><th></th></tr></thead><tbody>';
  [...aulas].sort((a,b)=>(b.data||'').localeCompare(a.data||'')).forEach(a=>{
    h+=`<tr>
      <td><input type="date" value="${a.data||''}" aria-label="Data" onchange="saveAula('${a.id}','data',this.value)"></td>
      <td><select aria-label="Corpo" onchange="saveAula('${a.id}','corpo_id',this.value)">${corpoOptions(a.corpo_id)}</select></td>
      <td><select aria-label="Tipo de aula" onchange="saveAula('${a.id}','procedimento_id',this.value)">${procOptions(a.procedimento_id)}</select></td>
      <td class="n"><input class="w-int num" type="number" min="1" step="1" value="${a.num_alunos}" aria-label="Alunos" onchange="saveAula('${a.id}','num_alunos',this.value)"></td>
      <td class="n">${depCell(a)}</td>
      <td class="n calc">${money(custoAula(a))}</td>
      <td class="n">${money(custoAluno(a))}</td>
      <td><input value="${esc(a.observacao||'')}" aria-label="Observação" onchange="saveAula('${a.id}','observacao',this.value)"></td>
      <td><button class="icon" title="Excluir aula" onclick="delAula('${a.id}')">${TRASH}</button></td>
    </tr>`;
  });
  w.innerHTML=h+'</tbody></table>';
}

// ---------- painel ----------
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
function renderDash(){
  if(!cur) return;
  Chart.defaults.font.family=cssv('--f-body'); Chart.defaults.color=cssv('--muted');
  const totInvest=corpos.reduce((s,c)=>s+Number(c.valor||0),0);
  const totCusto=aulas.reduce((s,a)=>s+custoAula(a),0);
  const totAlunos=aulas.reduce((s,a)=>s+Number(a.num_alunos||0),0);
  const totResid=corpos.reduce((s,c)=>s+Math.max(Number(c.valor||0)-custoUsadoCorpo(c),0),0);
  el('kpis').innerHTML=
    kpi('Valor investido',money(totInvest),'lead')+
    kpi('Custo já depreciado',money(totCusto),'warn')+
    kpi('Valor residual',money(totResid),'accent')+
    kpi('Corpos cadastrados',corpos.length,'')+
    kpi('Aulas lançadas',aulas.length,'')+
    kpi('Alunos atendidos',NUM.format(totAlunos),'')+
    kpi('Custo médio por aula',money(aulas.length?totCusto/aulas.length:0),'small')+
    kpi('Custo médio por aluno',money(totAlunos?totCusto/totAlunos:0),'small');
  const G=cssv('--chart-1'), T=cssv('--chart-2');
  const ord=[...aulas].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  mkChart('c-time',baseBar(ord.map(a=>fmtD(a.data)),ord.map(a=>+custoAula(a).toFixed(2)),G));
  mkChart('c-corpo',baseBar(corpos.map(c=>c.nome),corpos.map(c=>+custoUsadoCorpo(c).toFixed(2)),T,corpos.length>6));
  const byM=groupSum(ord,a=>(a.data||'').slice(0,7),custoAula);
  mkChart('c-mes',baseBar(Object.keys(byM).map(fmtMes),Object.values(byM).map(v=>+v.toFixed(2)),T));
  const byP=groupSum(aulas,a=>{const p=procById(a.procedimento_id);return p?p.nome:'sem tipo';},custoAula);
  mkChart('c-proc',baseBar(Object.keys(byP),Object.values(byP).map(v=>+v.toFixed(2)),G,true));
  el('deprec-list').innerHTML = corpos.length? corpos.map(c=>{
    const p=pctDoCorpo(c.id),lv=nivel(p);
    return `<div class="drow">
      <div class="nm" title="${esc(c.nome)}">${esc(c.nome)}</div>
      <div class="bar"><i class="${lv}" style="width:${Math.min(p,100)}%"></i></div>
      <div class="pv num">${pct(p)}</div>
      <div class="mv num">${money(custoUsadoCorpo(c))} de ${money(c.valor)}</div>
      <span class="pill ${lv}">${rotulo(p)}</span>
    </div>`;}).join('') : '<div class="empty"><b>Sem corpos nesta unidade</b>Cadastre corpos na aba Depreciação.</div>';
}
function kpi(k,v,cls){return `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v ${cls==='small'?'small':''}">${v}</div></div>`;}
function groupSum(arr,keyf,valf){const o={};arr.forEach(x=>{const k=keyf(x);o[k]=(o[k]||0)+valf(x);});return o;}
function fmtD(d){if(!d)return'';const[y,m,dd]=d.split('-');return dd+'/'+m;}
const MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function fmtMes(k){if(!k)return'—';const[y,m]=k.split('-');return MESES[+m-1]+'/'+y.slice(2);}
function fmtFull(d){if(!d)return'';const[y,m,dd]=d.split('-');return dd+'/'+m+'/'+y;}

// ---------- relatórios ----------
function filtered(){
  const fc=el('f-corpo').value, fp=el('f-proc').value, de=el('f-de').value, ate=el('f-ate').value;
  return aulas.filter(a=>{
    if(fc&&a.corpo_id!==fc)return false;
    if(fp&&a.procedimento_id!==fp)return false;
    if(de&&(a.data||'')<de)return false;
    if(ate&&(a.data||'')>ate)return false;
    return true;
  }).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
}
function clearFilters(){['f-corpo','f-proc','f-de','f-ate'].forEach(i=>el(i).value='');renderRel();}
function renderRel(){
  const rows=filtered();
  const tot=rows.reduce((s,a)=>s+custoAula(a),0), al=rows.reduce((s,a)=>s+Number(a.num_alunos||0),0);
  el('rel-kpis').innerHTML=kpi('Aulas no filtro',rows.length,'')+kpi('Custo total',money(tot),'warn')+kpi('Alunos',NUM.format(al),'')+kpi('Custo médio por aluno',money(al?tot/al:0),'small');
  const w=el('w-rel');
  if(!rows.length){w.innerHTML='<div class="empty"><b>Nenhuma aula no filtro</b>Ajuste ou limpe os filtros acima.</div>';return;}
  let h='<table><thead><tr><th>Data</th><th>Corpo</th><th>Tipo de aula</th><th class="n">Alunos</th><th class="n">% por aluno</th><th class="n">Depreciação</th><th class="n">Custo aula</th><th class="n">Custo/aluno</th></tr></thead><tbody>';
  rows.forEach(a=>{const c=corpoById(a.corpo_id)||{},p=procById(a.procedimento_id);
    h+=`<tr><td>${fmtFull(a.data)}</td><td>${esc(c.nome||'—')}</td><td>${esc(p?p.nome:'sem tipo')}</td><td class="n">${a.num_alunos}</td><td class="n">${pct(pctAluno(a))}</td><td class="n">${pct(depAula(a))}</td><td class="n calc">${money(custoAula(a))}</td><td class="n">${money(custoAluno(a))}</td></tr>`;});
  w.innerHTML=h+'</tbody></table>';
}
function exportCSV(){
  const rows=filtered();
  const head=['Unidade','Data','Corpo','Valor do corpo','Tipo de aula','Alunos','% por aluno','Depreciação da aula (%)','Custo da aula','Custo por aluno','Observação'];
  const dec=v=>Number(v).toFixed(2).replace('.',',');
  const lines=[head.join(';')];
  rows.forEach(a=>{const c=corpoById(a.corpo_id)||{},p=procById(a.procedimento_id);
    lines.push([cur.nome,fmtFull(a.data),c.nome||'',dec(c.valor||0),p?p.nome:'',a.num_alunos,dec(pctAluno(a)),dec(depAula(a)),
      dec(custoAula(a)),dec(custoAluno(a)),a.observacao||''].map(x=>`"${(x??'').toString().replace(/"/g,'""')}"`).join(';'));
  });
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  const slug=cur.nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  a.href=u;a.download='custo-aulas-'+slug+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u);
  toast('CSV exportado.');
}

// redesenha os gráficos quando o tema do sistema muda
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(cur&&el('tab-dash').classList.contains('active'))renderDash();});

bootUnits();
