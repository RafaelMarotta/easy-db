(function(){
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('list');
  const addBtn = document.getElementById('add');
  const statusEl = document.getElementById('status');

  function render(items){
    list.textContent='';
    const header = document.createElement('div'); header.className='row header';
    ['Id','Scope','Value','Secret','Actions'].forEach(h=>{ const d=document.createElement('div'); d.className='cell'; d.textContent=h; header.appendChild(d); });
    list.appendChild(header);
    items.forEach(v=>{
      const row=document.createElement('div'); row.className='row';
      row.innerHTML = `<div class="cell">${v.id}</div><div class="cell">${v.scope}</div><div class="cell">${v.value ?? '••••'}</div><div class="cell">${v.isSecret?'Yes':'No'}</div><div class="cell"><button data-id="${v.id}" class="del">Delete</button></div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('.del').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.getAttribute('data-id');
        vscode.postMessage({ type: 'delete', id });
      });
    });
  }

  addBtn.addEventListener('click', async ()=>{
    const id = prompt('Variable id'); if(!id) return;
    const scope = prompt('Scope (user|workspace|connection)', 'workspace'); if(!scope) return;
    const isSecret = confirm('Secret?');
    const value = isSecret ? undefined : prompt('Value') || '';
    vscode.postMessage({ type: 'save', variable: { id, scope, value, isSecret } });
  });

  window.addEventListener('message', (e)=>{
    const msg = e.data;
    if(msg.type==='variables'){ render(msg.items || []); }
    if(msg.type==='saved'){ statusEl.textContent = 'Saved'; vscode.postMessage({ type: 'list' }); }
    if(msg.type==='deleted'){ statusEl.textContent = 'Deleted'; vscode.postMessage({ type: 'list' }); }
    if(msg.type==='error'){ statusEl.textContent = `Error: ${msg.message}`; }
  });

  vscode.postMessage({ type: 'list' });
})();
