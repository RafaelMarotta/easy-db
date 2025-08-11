(function(){
  const vscode = acquireVsCodeApi();
  const grid = document.getElementById('grid');
  const statusEl = document.getElementById('status');
  const refresh = document.getElementById('refresh');
  const commit = document.getElementById('commit');

  let headerColumns = [];
  const pendingEdits = new Set();

  function clear(){ grid.textContent=''; delete grid.dataset.hasHeader; headerColumns = []; pendingEdits.clear(); }
  function append(columns, rows){
    if(!grid.dataset.hasHeader){
      headerColumns = columns.slice();
      const header = document.createElement('div');
      header.className = 'row header';
      columns.forEach((c, idx)=>{
        const d=document.createElement('div'); d.className='cell'; d.textContent=String(c);
        // Resizer handle
        const h=document.createElement('span'); h.className='resizer'; h.title='Drag to resize • Double‑click to fit'; h.addEventListener('mousedown', startResize(idx));
        h.addEventListener('dblclick', ()=> autoFitColumn(idx));
        d.addEventListener('dblclick', ()=> autoFitColumn(idx));
        d.appendChild(h);
        header.appendChild(d);
      });
      grid.appendChild(header); grid.dataset.hasHeader='1';
    }
    rows.forEach(r=>{
      const rowEl=document.createElement('div'); rowEl.className='row';
      headerColumns.forEach(c=>{
        const d=document.createElement('div'); d.className='cell'; d.contentEditable = true; d.spellcheck = false; d.dataset.col = c;
        const v=r[c]; d.textContent=v==null?'':String(v);
        d.addEventListener('input', ()=>{ d.classList.add('editing'); pendingEdits.add(rowEl); });
        // mark pk cells non-editable later when schema arrives
        rowEl.appendChild(d);
      });
      rowEl.dataset.pk = JSON.stringify(extractPk(headerColumns, r));
      grid.appendChild(rowEl);
    });
  }

  function extractPk(columns, row){
    if ('id' in row) return { id: row['id'] };
    if (columns.length) return { [columns[0]]: row[columns[0]] };
    return {};
  }

  // Column resizing affecting all rows
  function startResize(colIdx){
    return function(e){
      e.preventDefault();
      const startX = e.clientX;
      const colWidth = getColumnWidth(colIdx);
      function onMove(ev){
        const delta = ev.clientX - startX;
        setColumnWidth(colIdx, Math.max(60, colWidth + delta));
      }
      function onUp(){
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }
  function getColumnWidth(colIdx){
    const style = getComputedStyle(grid);
    const template = style.getPropertyValue('--grid-template') || style.gridTemplateColumns;
    const parts = parseTemplate(template, headerColumns.length);
    return parts[colIdx];
  }
  function setColumnWidth(colIdx, px){
    const style = getComputedStyle(grid);
    const template = style.getPropertyValue('--grid-template') || style.gridTemplateColumns || `repeat(${headerColumns.length}, 1fr)`;
    const parts = parseTemplate(template, headerColumns.length);
    parts[colIdx] = px;
    const css = parts.map(v=> typeof v === 'number' ? `${v}px` : v).join(' ');
    grid.style.setProperty('--grid-template', css);
  }
  function parseTemplate(tpl, count){
    // parse 'repeat(n, ...)' or series of values; fallback to equal widths
    if(/^repeat\(/.test(tpl)){
      return Array(count).fill(160);
    }
    const vals = tpl.split(/\s+/).filter(Boolean);
    const out = vals.map(v=> v.endsWith('px') ? parseFloat(v) : 160);
    while(out.length < count) out.push(160);
    return out.slice(0, count);
  }

  function autoFitColumn(colIdx){
    const header = grid.querySelector('.row.header');
    if(!header) return;
    let max = header.children[colIdx] ? header.children[colIdx].scrollWidth : 120;
    const rows = grid.querySelectorAll('.row:not(.header)');
    rows.forEach(r=>{ const c = r.children[colIdx]; if(c) max = Math.max(max, c.scrollWidth); });
    setColumnWidth(colIdx, Math.min(800, Math.max(80, max + 24)));
  }

  refresh.addEventListener('click', ()=>{
    clear();
    vscode.postMessage({ type: 'fetchPage', pageSize: 100, offset: 0 });
  });
  commit.addEventListener('click', async ()=>{
    const edits = collectEdits();
    if(!edits.length){ statusEl.textContent='No changes'; return; }
    for(const e of edits){
      await vscodePostAsync({ type: 'editRow', pk: e.pk, patch: e.patch });
    }
    statusEl.textContent = 'Committed changes';
    refresh.click();
  });

  window.addEventListener('message', (e)=>{
    const msg = e.data;
    if(msg.type==='schema'){
      // prevent PK edits by disabling contentEditable and styling
      const pk = new Set((msg.pkColumns||[]).map(String));
      grid.dataset.pk = JSON.stringify(Array.from(pk));
      // apply lock to existing cells
      Array.from(grid.querySelectorAll('.row:not(.header) .cell')).forEach(cell=>{
        if(pk.has(cell.dataset.col)){
          cell.classList.add('pk');
          cell.contentEditable = false;
        }
      });
    }
    if(msg.type==='queryChunk'){ append(msg.columns, msg.rows); }
    if(msg.type==='queryDone'){ statusEl.textContent = `Loaded ${msg.rowCount} rows`; }
    if(msg.type==='mutationDone'){ statusEl.textContent = `Affected ${msg.affected}`; }
    if(msg.type==='error'){ statusEl.textContent = `Error: ${msg.message}`; }
  });

  vscode.postMessage({ type: 'fetchPage', pageSize: 100, offset: 0 });

  function collectEdits(){
    const edits = [];
    pendingEdits.forEach(rowEl=>{
      const pk = JSON.parse(rowEl.dataset.pk || '{}');
      const patch = {};
      const pkCols = new Set(JSON.parse(grid.dataset.pk || '[]'));
      rowEl.querySelectorAll('.cell.editing').forEach(c=>{ if(!pkCols.has(c.dataset.col)) patch[c.dataset.col] = c.textContent; });
      edits.push({ pk, patch });
    });
    pendingEdits.clear();
    return edits;
  }

  function vscodePostAsync(message){
    return new Promise((resolve)=>{
      const handler = (e)=>{
        const m = e.data;
        if(m && (m.type==='mutationDone' || m.type==='error')){
          window.removeEventListener('message', handler);
          resolve(m);
        }
      };
      window.addEventListener('message', handler);
      vscode.postMessage(message);
    });
  }
})();
