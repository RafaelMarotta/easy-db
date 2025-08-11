(function(){
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const form = $('form');
  const driver = $('driver');
  const port = $('port');
  const vars = $('vars');
  const varsList = $('varsList');
  const togglePw = $('togglePw');

  driver.addEventListener('change', ()=>{
    port.value = driver.value === 'mysql' ? '3306' : '5432';
  });

  function draft(){
    return {
      id: $('connId') ? $('connId').value : undefined,
      name: $('name').value.trim(),
      driver: driver.value,
      host: $('host').value.trim(),
      port: Number(port.value || (driver.value==='mysql'?3306:5432)),
      database: $('database').value.trim() || undefined,
      user: $('user').value.trim() || undefined,
      password: $('password').value,
      ssl: { mode: $('sslMode').value, caPath: $('sslCa').value || undefined },
      ssh: $('sshHost').value ? { host: $('sshHost').value.trim(), user: $('sshUser').value.trim(), port: Number($('sshPort').value||22), keyPath: $('sshKey').value || undefined, passphrase: $('sshPass').value || undefined } : undefined
    };
  }

  $('test').addEventListener('click', ()=>{
    status.textContent = 'Testing...';
    vscode.postMessage({ type: 'test', draft: draft() });
  });
  $('cancel').addEventListener('click', ()=>{
    vscode.postMessage({ type: 'cancel' });
  });
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const d = draft();
    if(!d.name || !d.host){ status.textContent = 'Name and Host are required'; return; }
    vscode.postMessage({ type: 'save', draft: d });
  });

  togglePw.addEventListener('click', ()=>{
    const pw = $('password');
    if (!pw) return;
    if (pw.type === 'password') { pw.type = 'text'; togglePw.textContent = 'Hide'; togglePw.setAttribute('aria-label','Hide password'); }
    else { pw.type = 'password'; togglePw.textContent = 'Show'; togglePw.setAttribute('aria-label','Show password'); }
  });

  window.addEventListener('message', (e)=>{
    const msg = e.data;
    if(msg.type==='variablesPreview'){
      vars.textContent = JSON.stringify(msg.masked || {});
    }
    if(msg.type==='variablesList'){
      renderVars(msg.items || [], msg.masked || {});
    }
    if(msg.type==='variablesSaved' || msg.type==='variableDeleted' || msg.type==='variableSaved'){
      vscode.postMessage({ type: 'variablesList' });
      vscode.postMessage({ type: 'variablesPreview' });
    }
    if(msg.type==='testResult'){ status.textContent = msg.ok ? `Connected: ${msg.message}` : `Failed: ${msg.message}`; }
    if(msg.type==='saved'){ status.textContent = 'Saved'; }
    if(msg.type==='error'){ status.textContent = `Error: ${msg.message}`; }
    if(msg.type==='initDefaults' && msg.defaults){
      if ($('connId')) $('connId').value = msg.defaults.id || '';
      $('name').value = msg.defaults.name || '';
      driver.value = msg.defaults.driver || 'postgres';
      $('host').value = msg.defaults.host || 'localhost';
      $('port').value = msg.defaults.port != null ? String(msg.defaults.port) : (driver.value==='mysql'?'3306':'5432');
      $('database').value = msg.defaults.database || '';
      $('user').value = msg.defaults.user || '';
      $('password').value = msg.defaults.password || '';
    }
  });

  vscode.postMessage({ type: 'variablesPreview' });
  vscode.postMessage({ type: 'variablesList' });

  document.getElementById('varAdd').addEventListener('click', ()=>{
    if (varsList.querySelector('.row.new')) return;
    const row = document.createElement('div'); row.className='row new';
    const nameCell=document.createElement('div'); nameCell.className='cell';
    const valueCell=document.createElement('div'); valueCell.className='cell';
    const actionsCell=document.createElement('div'); actionsCell.className='cell';
    const nameInput=document.createElement('input'); nameInput.placeholder='name'; nameInput.autocomplete='off';
    const valueInput=document.createElement('input'); valueInput.placeholder='value'; valueInput.autocomplete='off';
    const saveBtn=document.createElement('button'); saveBtn.textContent='Save';
    const cancelBtn=document.createElement('button'); cancelBtn.textContent='Cancel';
    nameCell.appendChild(nameInput); valueCell.appendChild(valueInput);
    actionsCell.appendChild(saveBtn); actionsCell.appendChild(cancelBtn);
    row.appendChild(nameCell); row.appendChild(valueCell); row.appendChild(actionsCell);
    varsList.insertBefore(row, varsList.children[1] || null);
    nameInput.focus();
    saveBtn.addEventListener('click', ()=>{
      const id = (nameInput.value||'').trim(); if(!id){ status.textContent='Name is required'; return; }
      const value = valueInput.value || '';
      // Add to current list UI; Save All will persist
      const items = collectRows();
      const exists = items.find(i=>i.id===id);
      if (!exists) items.unshift({ id, value }); else exists.value = value;
      vscode.postMessage({ type: 'variablesBulkSave', items });
    });
    cancelBtn.addEventListener('click', ()=>{ row.remove(); });
  });

  function renderVars(items){
    varsList.textContent = '';
    const header = document.createElement('div'); header.className='row header';
    ;['Name','Value','Actions'].forEach(h=>{ const d=document.createElement('div'); d.className='cell'; d.textContent=h; header.appendChild(d); });
    varsList.appendChild(header);
    items.forEach(v=>{
      const row=document.createElement('div'); row.className='row';
      const val = v.value || '';
      row.innerHTML = `<div class="cell">${v.id}</div><div class="cell"><input value="${val}" data-id="${v.id}"/></div><div class="cell"><button data-id="${v.id}" class="del" title="Remove">🗑️</button></div>`;
      varsList.appendChild(row);
    });
    varsList.querySelectorAll('.del').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.getAttribute('data-id');
        vscode.postMessage({ type: 'variableDelete', id });
      });
    });
  }

  document.getElementById('varsSaveAll').addEventListener('click', ()=>{
    const items = collectRows();
    vscode.postMessage({ type: 'variablesBulkSave', items });
  });

  function collectRows(){
    const rows = Array.from(varsList.querySelectorAll('.row'));
    const items = [];
    for (const r of rows.slice(1)) { // skip header
      const id = r.children[0].textContent.trim();
      const input = r.querySelector('input');
      items.push({ id, value: input ? input.value : '' });
    }
    return items;
  }
})();
