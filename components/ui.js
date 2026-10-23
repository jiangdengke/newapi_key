"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CirclePlus,
  Database,
  Ellipsis,
  Eye,
  EyeOff,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";

import { getStatusText } from "../lib/format.js";

const escapeLayers = [];

function handleEscapeKey(event) {
  if (event.key === "Escape") {
    escapeLayers.at(-1)?.current?.();
  }
}

// Only the most recently opened overlay, menu or popover reacts to Escape.
function useEscapeLayer(isActive, onEscape) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    if (escapeLayers.length === 0) {
      document.addEventListener("keydown", handleEscapeKey);
    }
    escapeLayers.push(onEscapeRef);
    return () => {
      escapeLayers.splice(escapeLayers.lastIndexOf(onEscapeRef), 1);
      if (escapeLayers.length === 0) {
        document.removeEventListener("keydown", handleEscapeKey);
      }
    };
  }, [isActive]);
}

function useOverlayBehavior(isOpen, onEscape) {
  useEscapeLayer(isOpen, onEscape);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
}

function OverlayPanel({
  variant,
  open,
  title,
  description,
  onClose,
  closeDisabled = false,
  closeOnBackdrop = true,
  onSubmit,
  footer,
  size = "md",
  role = "dialog",
  children,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const requestClose = () => {
    if (!closeDisabled) {
      onClose?.();
    }
  };
  useOverlayBehavior(open, requestClose);
  if (!open) {
    return null;
  }

  const Container = onSubmit ? "form" : "section";
  return (
    <div
      className={`overlay overlay-${variant}`}
      role="presentation"
      onMouseDown={closeOnBackdrop ? requestClose : undefined}
    >
      <Container
        className={`${variant} ${variant}-${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        autoComplete={onSubmit ? "off" : undefined}
      >
        <header className={`${variant}-header`}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            aria-label="关闭"
            disabled={closeDisabled}
            onClick={requestClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className={`${variant}-body`}>{children}</div>
        {footer ? <footer className={`${variant}-footer`}>{footer}</footer> : null}
      </Container>
    </div>
  );
}

export function Modal(props) {
  return <OverlayPanel variant="dialog" {...props} />;
}

export function Sheet(props) {
  return <OverlayPanel variant="sheet" {...props} />;
}

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "确认",
  busyLabel = "正在处理...",
  tone = "danger",
  isBusy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      role="alertdialog"
      size="sm"
      closeDisabled={isBusy}
      onClose={onCancel}
      footer={(
        <>
          <button className="btn btn-outline" type="button" disabled={isBusy} onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
          >
            {isBusy ? <Spinner /> : null}
            {isBusy ? busyLabel : confirmLabel}
          </button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}

export function Spinner({ size = 14 }) {
  return <LoaderCircle className="spin" size={size} aria-hidden="true" />;
}

export function Field({ label, hint, error, extra, wide = false, children }) {
  const generatedId = useId();
  const onlyChild = Children.count(children) === 1 && isValidElement(children)
    ? children
    : null;
  const controlId = onlyChild?.props.id ?? generatedId;
  return (
    <div className={`field ${wide ? "field-wide" : ""}`}>
      <div className="field-label-row">
        <label htmlFor={onlyChild ? controlId : undefined}>{label}</label>
        {extra}
      </div>
      {onlyChild ? cloneElement(onlyChild, { id: controlId }) : children}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function Select({ className = "", children, ...selectProps }) {
  return (
    <span className={`select ${className}`}>
      <select {...selectProps}>{children}</select>
      <ChevronsUpDown size={14} aria-hidden="true" />
    </span>
  );
}

export function PasswordInput({ className = "", ...inputProps }) {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <span className={`input-affix ${className}`}>
      <input className="input" {...inputProps} type={isVisible ? "text" : "password"} />
      <button
        className="input-affix-button"
        type="button"
        aria-label={isVisible ? "隐藏内容" : "显示内容"}
        onClick={() => setIsVisible((currentValue) => !currentValue)}
      >
        {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  disabled = false,
  separatorPattern = /[\s,，]+/,
  "aria-label": ariaLabel,
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  function addValues(rawText) {
    const nextValues = [...values];
    for (const rawValue of String(rawText).split(separatorPattern)) {
      const value = rawValue.trim();
      if (value && !nextValues.includes(value)) {
        nextValues.push(value);
      }
    }
    if (nextValues.length !== values.length) {
      onChange(nextValues);
    }
  }

  function commitDraft() {
    if (draft.trim()) {
      addValues(draft);
    }
    setDraft("");
  }

  return (
    <div
      className={`tag-input ${disabled ? "is-disabled" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {values.map((value) => (
        <span className="tag-chip" key={value}>
          <span>{value}</span>
          {disabled ? null : (
            <button
              type="button"
              aria-label={`移除 ${value}`}
              onClick={() => onChange(values.filter((currentValue) => currentValue !== value))}
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        spellCheck="false"
        autoComplete="off"
        placeholder={values.length === 0 ? placeholder : "添加..."}
        onChange={(event) => {
          const nextDraft = event.target.value;
          if (separatorPattern.test(nextDraft)) {
            addValues(nextDraft);
            setDraft("");
            return;
          }
          setDraft(nextDraft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          } else if (event.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
      />
    </div>
  );
}

export function Switch({ checked, onChange, disabled = false, label, description, ariaLabel }) {
  const control = (
    <button
      className={`switch ${checked ? "is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
  if (!label) {
    return control;
  }
  return (
    <label className={`switch-field ${disabled ? "is-disabled" : ""}`}>
      <span className="switch-text">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
      {control}
    </label>
  );
}

export function Segmented({ options, value, onChange, disabled = false, ariaLabel }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === value;
        const OptionIcon = option.icon;
        return (
          <button
            className={`segmented-item ${isActive ? "is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            key={option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {OptionIcon ? <OptionIcon size={14} aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function DropdownMenu({ items, label = "更多操作", disabled = false }) {
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const visibleItems = items.filter(Boolean);
  useEscapeLayer(Boolean(position), () => setPosition(null));

  useEffect(() => {
    if (!position) {
      return undefined;
    }
    function handlePointerDown(event) {
      if (
        menuRef.current?.contains(event.target)
        || buttonRef.current?.contains(event.target)
      ) {
        return;
      }
      setPosition(null);
    }
    function closeMenu() {
      setPosition(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [position]);

  function toggleMenu() {
    if (position) {
      setPosition(null);
      return;
    }
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const estimatedMenuHeight = visibleItems.length * 34 + 10;
    const opensUpward = buttonRect.bottom + estimatedMenuHeight > window.innerHeight - 8;
    setPosition({
      right: Math.max(8, window.innerWidth - buttonRect.right),
      ...(opensUpward
        ? { bottom: window.innerHeight - buttonRect.top + 4 }
        : { top: buttonRect.bottom + 4 }),
    });
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="btn btn-ghost btn-icon btn-sm"
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={toggleMenu}
      >
        <Ellipsis size={16} />
      </button>
      {position ? createPortal(
        <div className="menu" role="menu" ref={menuRef} style={position}>
          {visibleItems.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                className={`menu-item ${item.danger ? "is-danger" : ""}`}
                type="button"
                role="menuitem"
                key={item.label}
                disabled={item.disabled}
                onClick={() => {
                  setPosition(null);
                  item.onSelect();
                }}
              >
                {ItemIcon ? <ItemIcon size={15} aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  pageSizeOptions,
  disabled = false,
  onPageChange,
  onPageSizeChange,
}) {
  const isFirstPage = page <= 1;
  const isLastPage = page >= totalPages;
  return (
    <div className="pagination">
      <span className="pagination-total">总计：<strong>{total}</strong></span>
      <label className="pagination-size">
        <span>每页行数</span>
        <Select
          className="select-sm"
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizeOptions.map((pageSizeOption) => (
            <option key={pageSizeOption} value={pageSizeOption}>{pageSizeOption}</option>
          ))}
        </Select>
      </label>
      <div className="pagination-pages">
        <button className="btn btn-outline btn-icon btn-sm" type="button" aria-label="第一页" disabled={disabled || isFirstPage} onClick={() => onPageChange(1)}>
          <ChevronsLeft size={14} />
        </button>
        <button className="btn btn-outline btn-icon btn-sm" type="button" aria-label="上一页" disabled={disabled || isFirstPage} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={14} />
        </button>
        <span className="pagination-current" aria-current="page">{page}</span>
        <span className="pagination-of">/ {totalPages}</span>
        <button className="btn btn-outline btn-icon btn-sm" type="button" aria-label="下一页" disabled={disabled || isLastPage} onClick={() => onPageChange(page + 1)}>
          <ChevronRight size={14} />
        </button>
        <button className="btn btn-outline btn-icon btn-sm" type="button" aria-label="最后一页" disabled={disabled || isLastPage} onClick={() => onPageChange(totalPages)}>
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: EmptyIcon = Database, title, description, action }) {
  return (
    <div className="empty-state">
      <EmptyIcon size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function StatCard({ icon: StatIcon, label, value, hint, tone = "primary" }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-card-label">
        <span className="stat-icon"><StatIcon size={15} aria-hidden="true" /></span>
        {label}
      </div>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function SectionHeading({ icon: SectionIcon, title, description, tone = "primary" }) {
  return (
    <div className="section-heading">
      <span className={`section-icon tone-${tone}`}><SectionIcon size={16} aria-hidden="true" /></span>
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}

export function StatusText({ status, children }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {children ?? getStatusText(status)}
    </span>
  );
}

export function useDebouncedValue(value, delayMilliseconds = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}

export function SearchInput({ value, onChange, placeholder, className = "", "aria-label": ariaLabel }) {
  return (
    <span className={`input-affix input-search ${className}`}>
      <Search size={15} aria-hidden="true" />
      <input
        className="input"
        type="text"
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck="false"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          className="input-affix-button"
          type="button"
          aria-label={`清除${ariaLabel || "搜索内容"}`}
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      ) : null}
    </span>
  );
}

export function FacetFilter({ label, value, options, onChange, allLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [optionQuery, setOptionQuery] = useState("");
  const containerRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);
  const totalCount = options.reduce((total, option) => total + (option.count || 0), 0);
  const normalizedOptionQuery = optionQuery.trim().toLowerCase();
  const visibleOptions = normalizedOptionQuery
    ? options.filter((option) => String(option.label).toLowerCase().includes(normalizedOptionQuery))
    : options;
  useEscapeLayer(isOpen, () => setIsOpen(false));

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  function choose(nextValue) {
    onChange(nextValue);
    setIsOpen(false);
    setOptionQuery("");
  }

  return (
    <div className="facet" ref={containerRef}>
      <button
        className={`facet-trigger ${selectedOption ? "is-active" : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <CirclePlus size={15} aria-hidden="true" />
        {label}
        {selectedOption ? <span className="facet-selected">{selectedOption.label}</span> : null}
      </button>
      {isOpen ? (
        <div className="facet-popover">
          <span className="input-affix input-search facet-search">
            <Search size={14} aria-hidden="true" />
            <input
              className="input"
              type="text"
              aria-label={`搜索${label}`}
              placeholder={label}
              value={optionQuery}
              onChange={(event) => setOptionQuery(event.target.value)}
              autoFocus
            />
          </span>
          <div className="facet-options" role="listbox" aria-label={label}>
            {normalizedOptionQuery ? null : (
              <button
                className={`facet-option ${value ? "" : "is-selected"}`}
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose("")}
              >
                <span className="facet-radio" aria-hidden="true" />
                <span className="facet-option-label">{allLabel}</span>
                <span className="facet-count">{totalCount}</span>
              </button>
            )}
            {visibleOptions.map((option) => (
              <button
                className={`facet-option ${option.value === value ? "is-selected" : ""}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                key={option.value}
                onClick={() => choose(option.value)}
              >
                <span className="facet-radio" aria-hidden="true" />
                <span className="facet-option-label">{option.label}</span>
                <span className="facet-count">{option.count || 0}</span>
              </button>
            ))}
            {visibleOptions.length === 0 ? <p className="facet-empty">没有匹配的选项</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SortControl({ field, order, options, onChange }) {
  const isAscending = order === "asc";
  return (
    <span className="sort-control">
      <Select
        className="sort-select"
        aria-label="排序字段"
        value={field}
        onChange={(event) => onChange({ field: event.target.value, order })}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
      <button
        className="btn btn-outline btn-icon"
        type="button"
        title={isAscending ? "升序（点击切换为降序）" : "降序（点击切换为升序）"}
        aria-label={isAscending ? "当前升序，切换为降序" : "当前降序，切换为升序"}
        onClick={() => onChange({ field, order: isAscending ? "desc" : "asc" })}
      >
        {isAscending ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
      </button>
    </span>
  );
}
