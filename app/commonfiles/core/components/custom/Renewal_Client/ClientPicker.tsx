'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

export interface ClientOption {
  id: string;
  label: string;
  email: string;
}

export default function ClientPicker({ options, value, loading, disabled, canCreate, onChange, onCreate }: {
  options: ClientOption[];
  value: string;
  loading: boolean;
  disabled?: boolean;
  canCreate: boolean;
  onChange: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const filtered = options.filter(c => `${c.label} ${c.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = options.find(c => c.id === value);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, []);

  useEffect(() => {
    if (open) document.getElementById?.(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, listId]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={container} className="relative">
      <button ref={trigger} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { setOpen(!open); setSearch(''); setActiveIndex(0); }}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm disabled:opacity-50">
        <span className="truncate">{selected?.label || 'Search or create a client'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
          <div className="border-b border-gray-200 p-2">
            <input autoFocus type="search" role="combobox" aria-label="Search clients" aria-autocomplete="list"
              aria-expanded={open} aria-controls={listId}
              aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              value={search} placeholder="Search by company, contact or email"
              onChange={event => { setSearch(event.target.value); setActiveIndex(0); }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex(i => Math.max(0, Math.min(filtered.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1))));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (filtered[activeIndex]) choose(filtered[activeIndex].id);
                }
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            <button type="button" disabled={!canCreate} onClick={() => { setOpen(false); onCreate(); }}
              className="mt-2 w-full rounded px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              + Create New Client
            </button>
          </div>
          <div id={listId} role="listbox" aria-label="Clients" className="max-h-60 overflow-y-auto">
            {loading && <p role="status" className="px-3 py-2 text-sm text-gray-500">Loading clients…</p>}
            {!loading && filtered.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No matching clients</p>}
            {filtered.map((client, i) => (
              <button type="button" role="option" id={`${listId}-${i}`} key={client.id} aria-selected={client.id === value}
                onClick={() => choose(client.id)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${i === activeIndex ? 'bg-blue-50' : ''}`}>
                <span className="block">{client.label}</span>
                {client.email && <span className="block text-xs text-gray-500">{client.email}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
