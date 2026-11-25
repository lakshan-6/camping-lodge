import {useEffect, useId, useRef, useState} from 'react';

const matches = (item, term) => (item.label + ' ' + (item.searchText || '')).toLocaleLowerCase().includes(term);

export default function EquipmentPicker({
  id, label, value = '', items = [], disabled = false, required = false,
  placeholder = 'Search items by name or SKU', onChange,
}) {
  const generatedId = useId();
  const inputId = id || 'equipment-picker-' + generatedId.replaceAll(':', '');
  const listId = inputId + '-options';
  const input = useRef(null);
  const optionElements = useRef(new Map());
  const selected = items.find(item => item.value === value);
  const previousSelection = useRef(selected);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null);
  const [activeValue, setActiveValue] = useState(null);
  const search = (query || '').trim().toLocaleLowerCase();
  const filtered = items.filter(item => matches(item, search));
  const enabled = filtered.filter(item => !item.disabled);
  const activeIndex = filtered.findIndex(item => item.value === activeValue && !item.disabled);
  const selectedLabel = selected?.label || (previousSelection.current?.value === value ? previousSelection.current.label : '');
  const display = open && query !== null ? query : selectedLabel;

  useEffect(() => {
    if (selected) previousSelection.current = selected;
  }, [selected]);

  useEffect(() => {
    setQuery(null);
    setOpen(false);
    setActiveValue(null);
  }, [value]);

  useEffect(() => {
    if (disabled) setOpen(false);
    const invalidSelection = value && (!selected || selected.disabled);
    const unmatchedText = open && query?.trim() && !selected;
    input.current?.setCustomValidity(!disabled && (invalidSelection || unmatchedText)
      ? 'Choose an available item from the list.' : '');
  }, [value, selected, disabled, open, query]);

  useEffect(() => {
    if (open) optionElements.current.get(activeValue)?.scrollIntoView({block: 'nearest'});
  }, [open, activeValue]);

  function show() {
    if (disabled || open) return;
    setQuery(null);
    setActiveValue(selected && !selected.disabled ? selected.value : items.find(item => !item.disabled)?.value ?? null);
    setOpen(true);
    input.current?.select();
  }

  function close() {
    setOpen(false);
    setQuery(null);
    setActiveValue(null);
  }

  function choose(item) {
    if (disabled || item.disabled) return;
    onChange(item.value);
    input.current?.focus();
    close();
  }

  function changeSearch(event) {
    const next = event.target.value;
    const term = next.trim().toLocaleLowerCase();
    setQuery(next);
    setOpen(true);
    setActiveValue(items.find(item => !item.disabled && matches(item, term))?.value ?? null);
    if (!next) onChange('');
  }

  function keydown(event) {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        if (event.key === 'ArrowUp') setActiveValue(items.findLast(item => !item.disabled)?.value ?? null);
        return;
      }
      if (!enabled.length) return;
      const current = enabled.findIndex(item => item.value === activeValue);
      const next = event.key === 'ArrowDown'
        ? (current + 1) % enabled.length
        : current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length;
      setActiveValue(enabled[next].value);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const active = filtered[activeIndex];
      if (active) choose(active);
    }
  }

  return <div className="equipment-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    {label && <label htmlFor={inputId}>{label}{required && <span aria-hidden="true" className="required-mark"> *</span>}</label>}
    <div className="equipment-picker-control">
      <input ref={input} id={inputId} type="text" role="combobox"
        aria-label={label || 'Choose item'} aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? listId + '-' + activeIndex : undefined}
        aria-required={required} disabled={disabled} required={required}
        autoComplete="off" spellCheck={false} placeholder={placeholder} value={display}
        onFocus={event => {show(); event.currentTarget.select();}}
        onMouseUp={event => {if (query === null) event.preventDefault();}}
        onClick={show} onChange={changeSearch} onKeyDown={keydown}/>
      {!disabled && (value || query) ? <button className="equipment-picker-clear" type="button"
        tabIndex={-1} aria-label="Clear item selection" onMouseDown={event => event.preventDefault()}
        onClick={() => {onChange(''); setQuery(''); input.current?.focus(); setOpen(true);}}>×</button>
        : <span className="equipment-picker-arrow" aria-hidden="true">⌄</span>}
    </div>
    {open && !disabled && <div className="equipment-picker-menu">
      <div id={listId} role="listbox" aria-label={label || 'Items'} className="equipment-picker-list">
        {filtered.map((item, index) => <button key={item.value} id={listId + '-' + index}
          ref={element => {if (element) optionElements.current.set(item.value, element); else optionElements.current.delete(item.value);}}
          type="button" role="option" tabIndex={-1} className="equipment-picker-option"
          aria-selected={item.value === value} aria-disabled={!!item.disabled} disabled={!!item.disabled}
          data-active={item.value === activeValue && !item.disabled}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
          {item.label}
        </button>)}
      </div>
      {!filtered.length && <p className="equipment-picker-empty" role="status">No matching items.</p>}
    </div>}
  </div>;
}
