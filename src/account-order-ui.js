'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AstriaAccountOrder = api;
})(typeof window === 'object' ? window : globalThis, () => {
  function connect({ list, workspaceId, onOrder }) {
    const document = list.ownerDocument;
    const selector = '.account-link[data-id][data-account]';
    let drag, pending = false, suppressClick = false;
    const rows = () => [...list.querySelectorAll(selector)];
    const ids = () => rows().map(row => row.dataset.id);
    const rowAt = target => {
      const row = target.closest?.(selector);
      return row && list.contains(row) ? row : null;
    };
    function clearMarks() {
      list.querySelectorAll('.account-dragging,.drop-before,.drop-after').forEach(row => row.classList.remove('account-dragging', 'drop-before', 'drop-after'));
    }
    function cancel() { drag = undefined; clearMarks(); }
    function valid() {
      const current = ids();
      return drag && workspaceId() === drag.workspaceId && current.length === drag.ids.length && current.every((id, index) => id === drag.ids[index]);
    }
    function start(event) {
      const row = rowAt(event.target);
      if (!row) return;
      if (pending || !row.draggable || row.disabled) { event.preventDefault(); return; }
      cancel();
      const current = ids(), workspace = workspaceId();
      if (!workspace || !current.every(id => id && typeof id === 'string') || new Set(current).size !== current.length || row.dataset.id !== row.dataset.account) {
        event.preventDefault(); return;
      }
      drag = { id: row.dataset.id, ids: current, workspaceId: workspace };
      suppressClick = true;
      row.classList.add('account-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-astria-account', drag.id);
      }
    }
    function destination(event) {
      if (!drag) return;
      if (!valid()) { cancel(); return; }
      const row = rowAt(event.target);
      if (!row || row.dataset.id === drag.id) return;
      const rect = row.getBoundingClientRect();
      return { row, after: event.clientY >= rect.top + rect.height / 2 };
    }
    function over(event) {
      const target = destination(event);
      clearMarks();
      if (!drag) return;
      rows().find(row => row.dataset.id === drag.id)?.classList.add('account-dragging');
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      target.row.classList.add(target.after ? 'drop-after' : 'drop-before');
    }
    async function drop(event) {
      const target = destination(event), current = drag;
      cancel();
      if (!target || !current) return;
      event.preventDefault(); event.stopPropagation();
      const order = current.ids.filter(id => id !== current.id);
      order.splice(order.indexOf(target.row.dataset.id) + (target.after ? 1 : 0), 0, current.id);
      if (order.every((id, index) => id === current.ids[index])) return;
      pending = true;
      try { await onOrder(current.workspaceId, order); }
      catch (cause) { console.error('Unable to reorder accounts.', cause); }
      finally { pending = false; }
    }
    function leave(event) { if (!list.contains(event.relatedTarget)) clearMarks(); }
    function outside(event) { if (!list.contains(event.target)) cancel(); }
    function key(event) { if (event.key === 'Escape') cancel(); }
    function pointer() { suppressClick = false; }
    function click(event) {
      if (suppressClick && event.detail > 0 && rowAt(event.target)) {
        suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    const observer = new document.defaultView.MutationObserver(() => {
      if (drag && !valid()) cancel();
    });
    observer.observe(list, { childList: true, subtree: true });
    list.addEventListener('dragstart', start);
    list.addEventListener('dragover', over);
    list.addEventListener('drop', drop);
    list.addEventListener('dragleave', leave);
    list.addEventListener('click', click, true);
    document.addEventListener('drop', outside, true);
    document.addEventListener('dragend', cancel, true);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      cancel(); observer.disconnect();
      list.removeEventListener('dragstart', start);
      list.removeEventListener('dragover', over);
      list.removeEventListener('drop', drop);
      list.removeEventListener('dragleave', leave);
      list.removeEventListener('click', click, true);
      document.removeEventListener('drop', outside, true);
      document.removeEventListener('dragend', cancel, true);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', pointer, true);
    };
  }
  return { connect };
});
