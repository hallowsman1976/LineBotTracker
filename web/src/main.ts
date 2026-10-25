import '@phosphor-icons/web/regular';
import './styles.css';

import { formatBaht, formatThaiDate } from '../../src/format';
import { bangkokDate, CATEGORIES, type Entry, type LedgerEntry, type TxType } from '../../src/parse';
import { API_URL, LIFF_ID } from '../../src/publicConfig';
import { dayText, nextDueDate, type RecurringIncome } from '../../src/recurring';
import { thaiMonthYear } from '../../src/summary';
import { ApiBackend, ApiFailure, DemoBackend, type Backend } from './backend';
import { categoryIcon } from './icons';
import {
  categoryBreakdown,
  dayLabel,
  filterEntries,
  groupByDay,
  monthOf,
  replaceEntry,
  shiftMonth,
  totals,
  withoutEntry,
  type TypeFilter,
} from './model';

type Status = 'loading' | 'ready' | 'error' | 'forbidden' | 'expired';

const state = {
  today: bangkokDate(new Date()),
  month: '',
  status: 'loading' as Status,
  entries: [] as LedgerEntry[],
  type: 'all' as TypeFilter,
  category: null as string | null,
  userId: '',
  demo: false,
};

let backend: Backend;
let loadSeq = 0;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------------------------------------------------------------- helpers

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function baht(n: number, sign: '' | '+' | '−' = ''): string {
  return `${sign}${formatBaht(n)}`;
}

function signed(n: number): string {
  return n < 0 ? baht(-n, '−') : baht(n, '+');
}

function amountFor(e: Entry): string {
  return e.type === 'income' ? baht(e.amount, '+') : baht(e.amount, '−');
}

// ---------------------------------------------------------------- render

function render(): void {
  const isCurrent = state.month === monthOf(state.today);
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="month-nav">
        <button class="icon-btn" data-action="prev" aria-label="เดือนก่อนหน้า"><i class="ph ph-caret-left"></i></button>
        <h1>${esc(thaiMonthYear(`${state.month}-01`))}</h1>
        <button class="icon-btn" data-action="next" aria-label="เดือนถัดไป" ${isCurrent ? 'disabled' : ''}>
          <i class="ph ph-caret-right"></i>
        </button>
      </div>
      <div class="top-actions">
        <button class="icon-btn" data-action="recurring" aria-label="รายรับประจำ"><i class="ph ph-repeat"></i></button>
        <button class="icon-btn" data-action="theme" aria-label="สลับโหมดสว่าง/มืด">
          <i class="ph ${isDark() ? 'ph-sun' : 'ph-moon'}"></i>
        </button>
      </div>
    </header>
    ${state.demo ? '<div class="demo-pill"><i class="ph ph-flask"></i> โหมดตัวอย่าง · ข้อมูลสมมติ</div>' : ''}
    <main>${renderBody()}</main>`;
}

function renderBody(): string {
  switch (state.status) {
    case 'loading':
      return `
        <div class="skeleton" style="height:172px"></div>
        <div class="skeleton" style="height:180px;margin-top:24px"></div>
        <div class="skeleton" style="height:220px;margin-top:24px"></div>`;
    case 'forbidden':
      return stateBlock(
        'ph-lock-simple',
        'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน',
        'ส่งรหัสนี้ให้ผู้ดูแลเพื่อเพิ่มในรายชื่อผู้ใช้',
        `<div class="code">${esc(state.userId)}</div>`,
      );
    case 'expired':
      return stateBlock(
        'ph-clock-counter-clockwise',
        'เซสชันหมดอายุ',
        'เข้าสู่ระบบอีกครั้งเพื่อดูข้อมูล',
        '<button class="btn btn-primary" data-action="relogin" style="margin-top:16px">เข้าสู่ระบบ</button>',
      );
    case 'error':
      return stateBlock(
        'ph-cloud-warning',
        'โหลดข้อมูลไม่สำเร็จ',
        'ตรวจการเชื่อมต่อแล้วลองใหม่',
        '<button class="btn btn-quiet" data-action="reload" style="margin-top:16px">ลองใหม่</button>',
      );
    case 'ready':
      return renderHero() + renderCategories() + renderList();
  }
}

function stateBlock(icon: string, title: string, text: string, extra = ''): string {
  return `<div class="card state"><i class="ph ${icon}"></i><h3>${title}</h3><p>${text}</p>${extra}</div>`;
}

function renderHero(): string {
  const t = totals(state.entries);
  return `
    <section class="card hero">
      <div class="label">คงเหลือ</div>
      <div class="net num">${signed(t.net)} <span class="label">บาท</span></div>
      <div class="split">
        <div class="stat">
          <div class="label"><i class="ph ph-arrow-down-left"></i> รายรับ</div>
          <div class="value num income">${baht(t.income, '+')}</div>
        </div>
        <div class="stat">
          <div class="label"><i class="ph ph-arrow-up-right"></i> รายจ่าย</div>
          <div class="value num">${baht(t.expense, '−')}</div>
        </div>
      </div>
    </section>`;
}

function renderCategories(): string {
  const rows = categoryBreakdown(state.entries, 'expense');
  if (rows.length === 0) return '';
  return `
    <section class="section">
      <div class="section-head"><h2>รายจ่ายตามหมวด</h2></div>
      <div class="card" style="padding:8px">
        <div class="bars">
          ${rows
            .map(
              (r) => `
            <button class="bar-row" data-action="category" data-category="${esc(r.category)}"
                    aria-pressed="${state.category === r.category}">
              <span class="cat-icon"><i class="ph ${categoryIcon(r.category)}"></i></span>
              <span>
                <span class="name"><span>${esc(r.category)}</span><span class="share num">${Math.round(r.share * 100)}%</span></span>
                <span class="track"><span style="width:${Math.max(2, r.share * 100)}%"></span></span>
              </span>
              <span class="amount num">${baht(r.amount)}</span>
            </button>`,
            )
            .join('')}
        </div>
      </div>
    </section>`;
}

function renderList(): string {
  const visible = filterEntries(state.entries, state.type, state.category);
  const segments: [TypeFilter, string][] = [
    ['all', 'ทั้งหมด'],
    ['expense', 'รายจ่าย'],
    ['income', 'รายรับ'],
  ];
  const chip = state.category
    ? `<button class="chip" data-action="clear-category" aria-label="ล้างตัวกรองหมวด">
         <i class="ph ${categoryIcon(state.category)}"></i>${esc(state.category)}<i class="ph ph-x"></i>
       </button>`
    : '';

  const body =
    state.entries.length === 0
      ? stateBlock('ph-receipt', 'ยังไม่มีรายการในเดือนนี้', 'พิมพ์หรือพูดในแชท LINE เพื่อจดรายการ')
      : visible.length === 0
        ? stateBlock('ph-funnel-simple', 'ไม่มีรายการที่ตรงตัวกรอง', 'ลองเปลี่ยนประเภทหรือล้างหมวด')
        : groupByDay(visible)
            .map(
              (g) => `
          <div class="day">
            <div class="day-head"><span>${dayLabel(g.date, state.today, formatThaiDate)}</span><span class="num">${signed(g.net)}</span></div>
            <div class="rows">${g.entries.map(renderRow).join('')}</div>
          </div>`,
            )
            .join('');

  return `
    <section class="section">
      <div class="section-head"><h2>รายการ</h2><span class="label num">${visible.length} รายการ</span></div>
      <div class="segmented" role="group" aria-label="ประเภท">
        ${segments
          .map(([v, label]) => `<button data-action="type" data-type="${v}" aria-pressed="${state.type === v}">${label}</button>`)
          .join('')}
      </div>
      ${chip}
      ${body}
    </section>`;
}

function renderRow(e: LedgerEntry): string {
  const title = e.note || e.category;
  const sub = e.note ? e.category : e.type === 'income' ? 'รายรับ' : 'รายจ่าย';
  const fromImage = e.source === 'slip' || e.source === 'receipt';
  const badge = fromImage
    ? `<i class="ph ph-receipt source-badge" aria-label="${e.source === 'slip' ? 'จากสลิป' : 'จากใบเสร็จ'}"></i>`
    : e.source === 'recurring'
      ? '<i class="ph ph-repeat source-badge" aria-label="รายรับประจำ"></i>'
      : '';
  return `
    <button class="row" data-action="edit" data-id="${esc(e.entryId)}">
      <span class="cat-icon"><i class="ph ${categoryIcon(e.category)}"></i></span>
      <span style="min-width:0"><div class="title">${esc(title)}${badge}</div><div class="sub">${esc(sub)}</div></span>
      <span class="amount num ${e.type === 'income' ? 'income' : ''}">${amountFor(e)}</span>
    </button>`;
}

// ---------------------------------------------------------------- data

async function load(): Promise<void> {
  const seq = ++loadSeq;
  state.status = 'loading';
  render();
  try {
    const entries = await backend.month(state.month);
    if (seq !== loadSeq) return; // a newer month was requested meanwhile
    state.entries = entries;
    state.status = 'ready';
  } catch (err) {
    if (seq !== loadSeq) return;
    handleFailure(err);
  }
  render();
}

function handleFailure(err: unknown): void {
  const code = err instanceof ApiFailure ? err.code : 'network';
  if (code === 'forbidden') {
    state.status = 'forbidden';
    state.userId = (err as ApiFailure).userId ?? '';
  } else if (code === 'unauthorized') {
    state.status = 'expired';
  } else {
    state.status = 'error';
  }
}

// ---------------------------------------------------------------- edit sheet

let editing: LedgerEntry | null = null;
let draftType: TxType = 'expense';
let draftCategory = '';

function openSheet(entry: LedgerEntry): void {
  editing = entry;
  draftType = entry.type;
  draftCategory = entry.category;
  $('#sheet-root').innerHTML = `
    <div class="scrim" data-action="close"></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" novalidate>
      <div class="grabber"></div>
      <h2 id="sheet-title">แก้ไขรายการ</h2>
      <div class="segmented" role="group" aria-label="ประเภท" id="f-type">
        <button type="button" data-action="draft-type" data-type="expense">รายจ่าย</button>
        <button type="button" data-action="draft-type" data-type="income">รายรับ</button>
      </div>
      <div class="field">
        <label class="label" for="f-amount">จำนวนเงิน</label>
        <div class="amount-input">
          <input id="f-amount" class="num" inputmode="decimal" autocomplete="off" value="${entry.amount}">
          <span>บาท</span>
        </div>
      </div>
      <div class="field">
        <span class="label">หมวด</span>
        <div class="cat-grid" id="f-cats"></div>
      </div>
      <div class="field">
        <label class="label" for="f-note">โน้ต</label>
        <input id="f-note" class="text-input" maxlength="100" value="${esc(entry.note)}" placeholder="เช่น ข้าวมันไก่">
      </div>
      <div class="field">
        <label class="label" for="f-date">วันที่</label>
        <input id="f-date" class="text-input num" type="date" max="${state.today}" value="${entry.date}">
      </div>
      <div class="form-error" id="f-error" role="alert"></div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-danger" data-action="delete"><i class="ph ph-trash"></i> ลบ</button>
        <button type="submit" class="btn btn-primary">บันทึก</button>
      </div>
    </form>`;
  renderDraft();
  requestAnimationFrame(() => document.body.classList.add('sheet-open'));
}

function renderDraft(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#f-type button')) {
    b.setAttribute('aria-pressed', String(b.dataset.type === draftType));
  }
  $('#f-cats').innerHTML = CATEGORIES[draftType]
    .map(
      (c) => `<button type="button" data-action="draft-category" data-category="${esc(c)}" aria-pressed="${c === draftCategory}">
                <i class="ph ${categoryIcon(c)}"></i>${esc(c)}</button>`,
    )
    .join('');
}

function closeSheet(): void {
  document.body.classList.remove('sheet-open');
  editing = null;
  recurringOpen = false;
  setTimeout(() => {
    if (!editing && !recurringOpen) $('#sheet-root').innerHTML = '';
  }, 250);
}

async function saveDraft(): Promise<void> {
  if (!editing) return;
  const original = editing;
  const draft: LedgerEntry = {
    entryId: original.entryId,
    source: original.source,
    type: draftType,
    amount: Number(($<HTMLInputElement>('#f-amount').value || '').replace(/,/g, '')),
    category: draftCategory,
    note: $<HTMLInputElement>('#f-note').value.trim(),
    date: $<HTMLInputElement>('#f-date').value,
  };
  const problem = clientCheck(draft);
  if (problem) {
    $('#f-error').textContent = problem;
    return;
  }

  // Optimistic: show the change now, roll back if the server refuses.
  const before = state.entries;
  state.entries = draft.date.startsWith(state.month)
    ? replaceEntry(state.entries, draft)
    : withoutEntry(state.entries, draft.entryId);
  closeSheet();
  render();
  try {
    await backend.update(draft.entryId, draft);
    toast(draft.date.startsWith(state.month) ? 'บันทึกแล้ว' : `ย้ายไปเดือน${thaiMonthYear(draft.date)}แล้ว`);
  } catch (err) {
    state.entries = before;
    render();
    toast(err instanceof ApiFailure && err.code === 'bad_request' && err.message ? err.message : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}

function clientCheck(e: Entry): string {
  if (!Number.isFinite(e.amount) || e.amount <= 0) return 'ใส่จำนวนเงินมากกว่า 0';
  if (!CATEGORIES[e.type].includes(e.category)) return 'เลือกหมวด';
  if (!e.date) return 'เลือกวันที่';
  if (e.date > state.today) return 'วันที่ต้องไม่เกินวันนี้';
  return '';
}

let deleteArmed: number | undefined;

/** First tap arms the button, second tap within 3s confirms: no surprise data loss, no native confirm(). */
function confirmDelete(button: HTMLButtonElement): boolean {
  if (deleteArmed === undefined) {
    button.classList.add('armed');
    button.innerHTML = '<i class="ph ph-trash"></i> ยืนยันลบ';
    deleteArmed = window.setTimeout(() => {
      deleteArmed = undefined;
      button.classList.remove('armed');
      button.innerHTML = '<i class="ph ph-trash"></i> ลบ';
    }, 3000);
    return false;
  }
  clearTimeout(deleteArmed);
  deleteArmed = undefined;
  return true;
}

async function deleteEditing(button: HTMLButtonElement): Promise<void> {
  if (!editing || !confirmDelete(button)) return;

  const target = editing;
  const before = state.entries;
  state.entries = withoutEntry(state.entries, target.entryId);
  closeSheet();
  render();
  try {
    await backend.remove(target.entryId);
    toast('ลบแล้ว');
  } catch {
    state.entries = before;
    render();
    toast('ลบไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}

// ---------------------------------------------------------------- recurring income sheet

let recurringOpen = false;
/** null while loading */
let rules: RecurringIncome[] | null = null;
/** The rule in the form; 'new' while adding one, null while the list shows. */
let editingRule: RecurringIncome | 'new' | null = null;

async function openRecurring(): Promise<void> {
  recurringOpen = true;
  editingRule = null;
  rules = null;
  renderRecurring();
  requestAnimationFrame(() => document.body.classList.add('sheet-open'));
  try {
    rules = await backend.recurring();
  } catch (err) {
    closeSheet();
    const code = err instanceof ApiFailure ? err.code : 'network';
    if (code === 'forbidden' || code === 'unauthorized') {
      handleFailure(err);
      render();
    } else {
      toast('โหลดรายรับประจำไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
    return;
  }
  if (recurringOpen && !editingRule) renderRecurring();
}

function renderRecurring(): void {
  $('#sheet-root').innerHTML = `
    <div class="scrim" data-action="close"></div>
    ${editingRule ? ruleForm(editingRule) : ruleList()}`;
  if (editingRule) renderDraft();
}

function ruleList(): string {
  const body =
    rules === null
      ? '<div class="skeleton" style="height:64px;margin-bottom:16px"></div>'
      : rules.length === 0
        ? `<div class="state" style="padding:var(--s6) var(--s4)"><i class="ph ph-repeat"></i><h3>ยังไม่ได้ตั้งรายรับประจำ</h3>
             <p>เช่น เงินเดือน ระบบจะบันทึกเป็นรายรับให้เองทุกเดือน</p></div>`
        : `<div class="rows">${rules.map(ruleRow).join('')}</div>`;
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="grabber"></div>
      <h2 id="sheet-title">รายรับประจำ</h2>
      <p class="sheet-hint">บันทึกให้อัตโนมัติตามวันที่ตั้งไว้ (ราว 7 โมงเช้า) แล้วแจ้งในแชท LINE พร้อมปุ่มยกเลิก</p>
      ${body}
      <button class="btn btn-primary block" data-action="rule-new" ${rules === null ? 'disabled' : ''}>
        <i class="ph ph-plus"></i> เพิ่มรายรับประจำ
      </button>
    </div>`;
}

function ruleRow(r: RecurringIncome): string {
  return `
    <button class="row" data-action="rule-edit" data-id="${esc(r.id)}">
      <span class="cat-icon"><i class="ph ${categoryIcon(r.category)}"></i></span>
      <span style="min-width:0">
        <div class="title">${esc(r.note || r.category)}</div>
        <div class="sub">${dayText(r.day)} · ครั้งถัดไป ${formatThaiDate(nextDueDate(r, state.today))}</div>
      </span>
      <span class="amount num income">${baht(r.amount, '+')}</span>
    </button>`;
}

function ruleForm(rule: RecurringIncome | 'new'): string {
  const r = rule === 'new' ? { amount: '', note: '', day: 25 } : rule;
  const days = Array.from({ length: 31 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === r.day ? 'selected' : ''}>${d === 31 ? 'สิ้นเดือน' : `วันที่ ${d}`}</option>`)
    .join('');
  const left =
    rule === 'new'
      ? '<button type="button" class="btn btn-quiet" data-action="rule-back">ยกเลิก</button>'
      : '<button type="button" class="btn btn-danger" data-action="rule-delete"><i class="ph ph-trash"></i> ลบ</button>';
  return `
    <form class="sheet" id="rule-form" role="dialog" aria-modal="true" aria-labelledby="sheet-title" novalidate>
      <div class="grabber"></div>
      <h2 id="sheet-title" class="with-back">
        <button type="button" class="icon-btn back" data-action="rule-back" aria-label="กลับ"><i class="ph ph-caret-left"></i></button>
        ${rule === 'new' ? 'เพิ่มรายรับประจำ' : 'แก้ไขรายรับประจำ'}
      </h2>
      <div class="field">
        <label class="label" for="f-amount">จำนวนเงินต่อเดือน</label>
        <div class="amount-input">
          <input id="f-amount" class="num" inputmode="decimal" autocomplete="off" value="${r.amount}" placeholder="0">
          <span>บาท</span>
        </div>
      </div>
      <div class="field">
        <label class="label" for="f-day">บันทึกทุกเดือน</label>
        <select id="f-day" class="text-input">${days}</select>
      </div>
      <div class="field">
        <span class="label">หมวด</span>
        <div class="cat-grid" id="f-cats"></div>
      </div>
      <div class="field">
        <label class="label" for="f-note">โน้ต</label>
        <input id="f-note" class="text-input" maxlength="100" value="${esc(r.note)}" placeholder="เช่น บริษัท ABC">
      </div>
      <div class="form-error" id="f-error" role="alert"></div>
      <div class="sheet-actions">
        ${left}
        <button type="submit" class="btn btn-primary">บันทึก</button>
      </div>
    </form>`;
}

/** The form reuses the entry sheet's category grid, so it sets the same draft state. */
function editRule(rule: RecurringIncome | 'new'): void {
  editingRule = rule;
  draftType = 'income';
  draftCategory = rule === 'new' ? 'เงินเดือน' : rule.category;
  renderRecurring();
}

async function saveRuleDraft(button: HTMLButtonElement): Promise<void> {
  if (!editingRule) return;
  const id = editingRule === 'new' ? undefined : editingRule.id;
  const input = {
    amount: Number(($<HTMLInputElement>('#f-amount').value || '').replace(/,/g, '')),
    category: draftCategory,
    note: $<HTMLInputElement>('#f-note').value.trim(),
    day: Number($<HTMLSelectElement>('#f-day').value),
  };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    $('#f-error').textContent = 'ใส่จำนวนเงินมากกว่า 0';
    return;
  }

  // Not optimistic: the server decides the next date, which the toast shows.
  button.disabled = true;
  try {
    const saved = await backend.saveRecurring(id, input);
    rules = id ? (rules ?? []).map((r) => (r.id === id ? saved : r)) : [...(rules ?? []), saved];
    editingRule = null;
    renderRecurring();
    toast(`บันทึกแล้ว ครั้งถัดไป ${formatThaiDate(nextDueDate(saved, state.today))}`);
  } catch (err) {
    button.disabled = false;
    $('#f-error').textContent =
      err instanceof ApiFailure && err.code === 'bad_request' && err.message ? err.message : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
  }
}

async function deleteRule(button: HTMLButtonElement): Promise<void> {
  if (!editingRule || editingRule === 'new' || !confirmDelete(button)) return;
  const target = editingRule;
  button.disabled = true;
  try {
    await backend.removeRecurring(target.id);
    rules = (rules ?? []).filter((r) => r.id !== target.id);
    editingRule = null;
    renderRecurring();
    toast('ลบแล้ว รายการที่บันทึกไปแล้วยังอยู่');
  } catch {
    button.disabled = false;
    toast('ลบไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}

// ---------------------------------------------------------------- toast & theme

let toastTimer: number | undefined;

function toast(message: string): void {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

const THEME_KEY = 'lbt-theme';

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyStoredTheme(): void {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // Storage can be unavailable (private mode); the system theme still applies.
  }
}

function toggleTheme(): void {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // ignore
  }
  render();
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  switch (action) {
    case 'prev':
    case 'next':
      state.month = shiftMonth(state.month, action === 'prev' ? -1 : 1);
      state.category = null;
      void load();
      break;
    case 'theme':
      toggleTheme();
      break;
    case 'recurring':
      void openRecurring();
      break;
    case 'rule-new':
      editRule('new');
      break;
    case 'rule-edit': {
      const rule = rules?.find((r) => r.id === el.dataset.id);
      if (rule) editRule(rule);
      break;
    }
    case 'rule-back':
      editingRule = null;
      renderRecurring();
      break;
    case 'rule-delete':
      void deleteRule(el as HTMLButtonElement);
      break;
    case 'type':
      state.type = el.dataset.type as TypeFilter;
      render();
      break;
    case 'category':
      state.category = state.category === el.dataset.category ? null : el.dataset.category!;
      state.type = 'all';
      render();
      break;
    case 'clear-category':
      state.category = null;
      render();
      break;
    case 'edit': {
      const entry = state.entries.find((e) => e.entryId === el.dataset.id);
      if (entry) openSheet(entry);
      break;
    }
    case 'draft-type':
      draftType = el.dataset.type as TxType;
      if (!CATEGORIES[draftType].includes(draftCategory)) draftCategory = CATEGORIES[draftType][0];
      renderDraft();
      break;
    case 'draft-category':
      draftCategory = el.dataset.category!;
      renderDraft();
      break;
    case 'close':
      closeSheet();
      break;
    case 'delete':
      void deleteEditing(el as HTMLButtonElement);
      break;
    case 'reload':
      void load();
      break;
    case 'relogin':
      void relogin();
      break;
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  if (form.id === 'rule-form') void saveRuleDraft(form.querySelector<HTMLButtonElement>('[type=submit]')!);
  else void saveDraft();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && (editing || recurringOpen)) closeSheet();
});

// ---------------------------------------------------------------- boot

let reloginHandler: () => void = () => location.reload();

async function relogin(): Promise<void> {
  reloginHandler();
}

async function boot(): Promise<void> {
  applyStoredTheme();
  const params = new URLSearchParams(location.search);
  state.month = monthOf(state.today);
  state.demo = !LIFF_ID || params.has('demo');

  if (state.demo) {
    backend = new DemoBackend(state.today);
    return load();
  }

  render();
  try {
    const { default: liff } = await import('@line/liff');
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return;
    }
    reloginHandler = () => {
      liff.logout();
      liff.login({ redirectUri: location.href });
    };
    backend = new ApiBackend(API_URL, () => liff.getIDToken());
  } catch (err) {
    console.error('LIFF init failed', err);
    state.status = 'error';
    render();
    return;
  }
  return load();
}

void boot();
