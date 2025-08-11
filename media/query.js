(function(){
  const vscode = acquireVsCodeApi();
  const runBtn = document.getElementById('run');
  const stopBtn = document.getElementById('stop');
  const saveBtn = document.getElementById('save');
  const sqlEl = document.getElementById('sql');
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');

  let running = false;
  let currentId = '';

  function appendRows(columns, rows){
    if(!resultsEl.dataset.hasHeader){
      const header = document.createElement('div');
      header.className = 'row header';
      columns.forEach(c=>{
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = String(c);
        header.appendChild(cell);
      });
      resultsEl.appendChild(header);
      resultsEl.dataset.hasHeader = '1';
    }
    rows.forEach(r=>{
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      columns.forEach(c=>{
        const cell = document.createElement('div');
        cell.className = 'cell';
        const v = r[c];
        cell.textContent = v == null ? '∅' : String(v);
        rowEl.appendChild(cell);
      });
      resultsEl.appendChild(rowEl);
    });
  }

  runBtn.addEventListener('click', ()=>{
    if(running) return;
    resultsEl.textContent = '';
    delete resultsEl.dataset.hasHeader;
    const sql = sqlEl.value;
    running = true;
    currentId = String(Date.now());
    statusEl.textContent = 'Running...';
    vscode.postMessage({ type: 'runQuery', id: currentId, connectionId: '', sql });
  });
  stopBtn.addEventListener('click', ()=>{
    // Extension will add AbortSignal support later
    running = false;
    statusEl.textContent = 'Stopped';
  });
  saveBtn.addEventListener('click', ()=>{
    vscode.postMessage({ type: 'saveQuery', payload: { name: 'New Query', sql: sqlEl.value } });
  });

  window.addEventListener('message', (e)=>{
    const msg = e.data;
    if(msg.type === 'queryChunk' && msg.id === currentId){
      appendRows(msg.columns, msg.rows);
    } else if(msg.type === 'queryDone' && msg.id === currentId){
      running = false;
      statusEl.textContent = `Done: ${msg.rowCount} rows in ${msg.durationMs} ms`;
    } else if(msg.type === 'error' && msg.id === currentId){
      running = false;
      statusEl.textContent = `Error: ${msg.message}`;
    }
  });
})();
