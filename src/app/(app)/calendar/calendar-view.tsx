'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dialog } from '@/components/ui/dialog';
import type {
  AvailabilityBlock,
  Campaign,
  Coach,
  Dealer,
  LookupOption,
} from '@/features/schedule/queries';
import { AvailabilityAdmin } from '@/features/schedule/availability-admin';
import { BookingForm } from './booking-form';
import { clampToGrid, GRID_LAST_INDEX } from './calendar-grid';
import { EventDetail } from './event-detail';

type Mode = 'app' | 'share';

type Props = {
  coaches: Coach[];
  campaigns: Campaign[];
  blocks: AvailabilityBlock[];
  mode: Mode;
  forcedCoachId?: number;
  // The signed-in viewer's coach contact id, when they have a team_member_roles
  // row with role='coach'. Used as the initial value of activeCoachFilter so
  // a coach lands on /calendar already pre-filtered to their own bookings —
  // legacy parity with deprecated/index.html doLogin() lines 702-710. The
  // user can clear/swap the filter via the existing pills.
  viewerCoachId?: number | null;
  dealers?: Dealer[];
  styles?: LookupOption[];
  sources?: LookupOption[];
};

type DialogState =
  | { kind: 'closed' }
  | { kind: 'detail'; campaign: Campaign }
  | { kind: 'create'; date?: string }
  | { kind: 'edit'; campaign: Campaign }
  | { kind: 'availability' };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Verbatim from legacy `deprecated/index.html`
const COACH_COLORS: Array<{ bg: string; border: string }> = [
  { bg: '#0f1e3c', border: '#c9963a' },
  { bg: '#1a5fa8', border: '#85b7eb' },
  { bg: '#1e7e4a', border: '#97c459' },
  { bg: '#993c1d', border: '#f0997b' },
  { bg: '#534ab7', border: '#afa9ec' },
  { bg: '#0f6e56', border: '#5dcaa5' },
  { bg: '#854f0b', border: '#fac775' },
  { bg: '#993556', border: '#ed93b1' },
  { bg: '#444441', border: '#d3d1c7' },
  { bg: '#185fa5', border: '#b5d4f4' },
];

const MAX_RIBBONS = 10;
const RIBBON_H = 22;
const RIBBON_GAP = 3;
const TOP_PAD = 26;

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function CalendarView({
  coaches,
  campaigns,
  blocks,
  mode,
  forcedCoachId,
  viewerCoachId = null,
  dealers = [],
  styles = [],
  sources = [],
}: Props) {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const closeDialog = useCallback(() => setDialog({ kind: 'closed' }), []);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [month, setMonth] = useState<number>(today.getMonth());
  const [year, setYear] = useState<number>(today.getFullYear());
  const [activeCoachFilter, setActiveCoachFilter] = useState<number | null>(
    forcedCoachId ?? viewerCoachId ?? null
  );
  const scopedCoachId = forcedCoachId ?? activeCoachFilter;

  // Stable per-coach color assignment in encounter order.
  const coachColorMap = useMemo(() => {
    const map = new Map<number, { bg: string; border: string }>();
    let idx = 0;
    for (const ev of campaigns) {
      if (ev.coachId == null) continue;
      if (!map.has(ev.coachId)) {
        map.set(ev.coachId, COACH_COLORS[idx % COACH_COLORS.length]);
        idx++;
      }
    }
    return map;
  }, [campaigns]);

  function getCoachColor(coachId: number | null) {
    if (coachId == null) return COACH_COLORS[0];
    return coachColorMap.get(coachId) ?? COACH_COLORS[0];
  }

  // Build the 42-cell grid for the visible month.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const out: { date: string; day: number; otherMonth: boolean; isToday: boolean }[] = [];
    for (let i = first - 1; i >= 0; i--) {
      const d = prevDays - i;
      const my = month === 0 ? year - 1 : year;
      const mm = month === 0 ? 11 : month - 1;
      out.push({
        date: isoDate(my, mm, d),
        day: d,
        otherMonth: true,
        isToday: false,
      });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const cellDate = new Date(year, month, i);
      out.push({
        date: isoDate(year, month, i),
        day: i,
        otherMonth: false,
        isToday: cellDate.getTime() === today.getTime(),
      });
    }
    const rem = 42 - out.length;
    for (let i = 1; i <= rem; i++) {
      const my = month === 11 ? year + 1 : year;
      const mm = month === 11 ? 0 : month + 1;
      out.push({
        date: isoDate(my, mm, i),
        day: i,
        otherMonth: true,
        isToday: false,
      });
    }
    return out;
  }, [month, year, today]);

  const cellIndexMap = useMemo(() => {
    const map: Record<string, number> = {};
    cells.forEach((c, i) => {
      map[c.date] = i;
    });
    return map;
  }, [cells]);

  const grid = useMemo(
    () => ({
      firstDate: cells[0].date,
      lastDate: cells[GRID_LAST_INDEX].date,
      indexOf: cellIndexMap,
    }),
    [cells, cellIndexMap]
  );

  const blockedByDate = useMemo(() => {
    const map: Record<string, AvailabilityBlock> = {};
    for (const b of blocks) {
      const appliesToCalendar =
        b.kind !== 'coach_unavailable' ||
        (scopedCoachId != null && b.coachId === scopedCoachId);
      if (!appliesToCalendar) continue;

      // Iterate every date in the block range; for the visible window only.
      const start = new Date(`${b.startDate}T12:00:00`);
      const end = new Date(`${b.endDate}T12:00:00`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
        if (cellIndexMap[ds] !== undefined && !map[ds]) {
          map[ds] = b;
        }
      }
    }
    return map;
  }, [blocks, cellIndexMap, scopedCoachId]);

  const visibleEvents = useMemo(() => {
    return scopedCoachId == null
      ? campaigns
      : campaigns.filter((c) => c.coachId === scopedCoachId);
  }, [campaigns, scopedCoachId]);

  // Slot assignment, ported from legacy renderCalendar slot-packing. Departs
  // from legacy by clamping events that overlap but extend past the grid
  // (legacy dropped them entirely).
  const slotAssignment = useMemo(() => {
    type Slotted = Campaign & {
      _rowSlotAssigned: Record<number, number>;
      _si: number;
      _ei: number;
    };
    const slotted: Slotted[] = [];
    for (const c of visibleEvents) {
      if (!c.startDate || !c.endDate) continue;
      const clamped = clampToGrid(c.startDate, c.endDate, grid);
      if (!clamped) continue;
      slotted.push({ ...c, _rowSlotAssigned: {}, _si: clamped.si, _ei: clamped.ei });
    }

    const rowEvents: Record<number, Slotted[]> = {};
    for (const ev of slotted) {
      for (let row = Math.floor(ev._si / 7); row <= Math.floor(ev._ei / 7); row++) {
        if (!rowEvents[row]) rowEvents[row] = [];
        if (!rowEvents[row].includes(ev)) rowEvents[row].push(ev);
      }
    }

    for (const rowKey of Object.keys(rowEvents)) {
      const row = Number(rowKey);
      const evs = rowEvents[row];
      evs.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
      const rowStart = row * 7;
      const rowEnd = rowStart + 6;
      for (const ev of evs) {
        const si = Math.max(ev._si, rowStart);
        const ei = Math.min(ev._ei, rowEnd);
        const usedSlots = new Set<number>();
        for (const other of evs) {
          if (other === ev) continue;
          if (other._rowSlotAssigned[row] === undefined) continue;
          const osi = Math.max(other._si, rowStart);
          const oei = Math.min(other._ei, rowEnd);
          if (si <= oei && ei >= osi) usedSlots.add(other._rowSlotAssigned[row]);
        }
        let slot = 0;
        while (usedSlots.has(slot) && slot < MAX_RIBBONS) slot++;
        ev._rowSlotAssigned[row] = slot;
      }
    }

    const rowMaxSlots: Record<number, number> = {};
    for (const ev of slotted) {
      for (let row = Math.floor(ev._si / 7); row <= Math.floor(ev._ei / 7); row++) {
        const slot = ev._rowSlotAssigned[row] ?? 0;
        rowMaxSlots[row] = Math.max(rowMaxSlots[row] ?? 0, slot + 1);
      }
    }

    return { slotted, rowMaxSlots };
  }, [visibleEvents, grid]);

  // Compute per-row cell heights from row max slots.
  const rowHeights = useMemo(() => {
    const heights: number[] = [];
    for (let row = 0; row < 6; row++) {
      const slots = Math.min(slotAssignment.rowMaxSlots[row] ?? 0, MAX_RIBBONS);
      heights.push(Math.max(TOP_PAD + slots * (RIBBON_H + RIBBON_GAP) + 10, 52));
    }
    return heights;
  }, [slotAssignment]);

  // The per-cell selected-range tint (event background under the ribbon).
  const selectedDates = useMemo(() => {
    const set = new Set<string>();
    for (const ev of visibleEvents) {
      if (!ev.startDate || !ev.endDate) continue;
      const s = new Date(`${ev.startDate}T12:00:00`);
      const e = new Date(`${ev.endDate}T12:00:00`);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        set.add(isoDate(d.getFullYear(), d.getMonth(), d.getDate()));
      }
    }
    return set;
  }, [visibleEvents]);

  // Ribbon overlay positioning. Ported from legacy drawRibbons; uses the
  // clamped indices precomputed by slotAssignment so ribbons line up with the
  // slots they were assigned (and don't fall off when the range extends past
  // the visible grid).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [, setLayoutTick] = useState(0);

  const drawRibbons = useCallback(() => {
    const overlay = overlayRef.current;
    const grid = gridRef.current;
    const wrap = wrapperRef.current;
    if (!overlay || !grid || !wrap) return;

    overlay.innerHTML = '';
    overlay.style.height = `${grid.offsetHeight}px`;

    const evs = slotAssignment.slotted;
    if (!evs.length) return;

    const gridRect = grid.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const offX = gridRect.left - wrapRect.left;
    const offY = gridRect.top - wrapRect.top;

    for (const ev of evs) {
      const si = ev._si;
      const ei = ev._ei;
      const color = getCoachColor(ev.coachId);
      const clientName = ev.dealerName || 'Event';
      const coachName = ev.coachName ?? '';

      for (let row = Math.floor(si / 7); row <= Math.floor(ei / 7); row++) {
        const slot = ev._rowSlotAssigned[row] ?? 0;
        if (slot >= MAX_RIBBONS) continue;
        const rs = Math.max(si, row * 7);
        const re = Math.min(ei, row * 7 + 6);
        // grid.children: 7 day-headers, then 42 cells
        const sc = grid.children[rs + 7] as HTMLElement | undefined;
        const ec = grid.children[re + 7] as HTMLElement | undefined;
        if (!sc || !ec) continue;
        const sr = sc.getBoundingClientRect();
        const er = ec.getBoundingClientRect();
        const left = sr.left - gridRect.left + offX + 3;
        const top = sr.top - gridRect.top + offY + TOP_PAD + slot * (RIBBON_H + RIBBON_GAP);
        const width = er.right - sr.left - 6;

        const bar = document.createElement('div');
        bar.className =
          'absolute flex items-center overflow-hidden rounded-md px-2 transition-opacity hover:opacity-80 cursor-pointer pointer-events-auto';
        bar.style.left = `${left}px`;
        bar.style.top = `${top}px`;
        bar.style.width = `${width}px`;
        bar.style.height = `${RIBBON_H}px`;
        bar.style.background = color.bg;
        bar.style.borderLeft = `3px solid ${color.border}`;

        const lbl = document.createElement('span');
        lbl.className = 'truncate text-[10px] font-semibold text-white';
        lbl.textContent = clientName;
        bar.appendChild(lbl);

        if (coachName) {
          const tag = document.createElement('span');
          tag.className = 'ml-1.5 flex-shrink-0 whitespace-nowrap text-[9px] text-white/60';
          tag.textContent = coachName;
          bar.appendChild(tag);
        }

        if (mode === 'app') {
          bar.title = `${clientName}${coachName ? ` · ${coachName}` : ''} · ${ev.startDate} → ${ev.endDate}`;
          bar.addEventListener('click', (e) => {
            e.stopPropagation();
            setDialog({ kind: 'detail', campaign: ev });
          });
        }

        overlay.appendChild(bar);
      }
    }
  }, [slotAssignment, getCoachColor, mode]);

  useLayoutEffect(() => {
    drawRibbons();
  }, [drawRibbons]);

  useEffect(() => {
    const handler = () => setLayoutTick((n) => n + 1);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useLayoutEffect(() => {
    drawRibbons();
  });

  // Coach filter pill bar — only coaches that actually have campaigns visible.
  const usedCoachIds = useMemo(() => {
    const set = new Set<number>();
    for (const ev of campaigns) if (ev.coachId != null) set.add(ev.coachId);
    return [...set];
  }, [campaigns]);

  const stats = useMemo(() => {
    const monthEvents = campaigns.filter((c) => {
      const d = new Date(`${c.startDate}T12:00:00`);
      return d.getMonth() === month && d.getFullYear() === year;
    });
    return {
      thisMonth: monthEvents.length,
      total: campaigns.length,
      activeCoaches: new Set(campaigns.filter((c) => c.coachId != null).map((c) => c.coachId)).size,
      activeClients: new Set(campaigns.map((c) => c.dealerId)).size,
    };
  }, [campaigns, month, year]);

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (m < 0) {
      m = 11;
      y--;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy">
            {mode === 'share' ? 'Schedule' : 'Master Schedule'}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {mode === 'share'
              ? `${forcedCoachId ? coaches.find((c) => c.id === forcedCoachId)?.displayName ?? 'Coach' : 'Coach'} — booked sales events.`
              : 'Click a date to book a campaign, or any ribbon for details.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'app' && (
            <>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'availability' })}
                className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-status-red transition hover:border-status-red hover:bg-red-50"
              >
                Block Date
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'create' })}
                className="rounded-lg bg-status-green px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                + Book Event
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-navy transition hover:border-navy hover:bg-stone-100"
          >
            ‹
          </button>
          <span className="min-w-[180px] text-center font-display text-xl text-navy">
            {MONTHS[month]} {year}
          </span>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-navy transition hover:border-navy hover:bg-stone-100"
          >
            ›
          </button>
        </div>
      </div>

      {mode === 'app' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="This Month" value={stats.thisMonth} sub="campaigns booked" />
          <Stat label="Total Campaigns" value={stats.total} sub="all time" />
          <Stat label="Active Coaches" value={stats.activeCoaches} sub="assigned" />
          <Stat label="Active Dealers" value={stats.activeClients} sub="on schedule" />
        </div>
      )}

      {mode === 'app' && usedCoachIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            active={activeCoachFilter === null}
            label="All Coaches"
            colorBg="#6b6760"
            onClick={() => setActiveCoachFilter(null)}
          />
          {usedCoachIds.map((cid) => {
            const coach = coaches.find((c) => c.id === cid);
            if (!coach) return null;
            const color = getCoachColor(cid);
            return (
              <Pill
                key={cid}
                active={activeCoachFilter === cid}
                label={`${coach.firstName} ${coach.lastName}`}
                colorBg={color.bg}
                onClick={() => setActiveCoachFilter(cid)}
              />
            );
          })}
        </div>
      )}

      <div className="relative" ref={wrapperRef}>
        <div
          ref={gridRef}
          className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-[0_1px_4px_rgba(15,30,60,0.08)]"
        >
          {DAYS.map((d) => (
            <div
              key={d}
              className="bg-navy py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/70"
            >
              {d}
            </div>
          ))}
          {cells.map((c, i) => {
            const row = Math.floor(i / 7);
            const blocked = blockedByDate[c.date];
            const isSelected = selectedDates.has(c.date);
            const clickable = mode === 'app' && !c.otherMonth && !blocked;
            return (
              <div
                key={c.date + ':' + i}
                data-date={c.date}
                style={{ height: rowHeights[row] }}
                onClick={
                  clickable ? () => setDialog({ kind: 'create', date: c.date }) : undefined
                }
                className={[
                  'relative bg-white p-2 text-left transition-colors',
                  clickable ? 'cursor-pointer hover:bg-navy-pale/60' : '',
                  c.otherMonth ? 'bg-stone-100' : '',
                  c.isToday ? 'bg-navy-pale' : '',
                  blocked ? 'bg-red-50' : '',
                  isSelected && !c.otherMonth && !blocked ? 'bg-amber-50' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div
                  className={[
                    'text-xs font-medium',
                    c.otherMonth ? 'text-stone-400' : 'text-stone-800',
                    c.isToday ? 'text-status-blue font-semibold' : '',
                    blocked ? 'text-status-red' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {c.day}
                </div>
                {blocked && (
                  <span className="mt-0.5 block text-[9px] font-bold tracking-wide text-status-red">
                    🚫 {blocked.reason ?? 'Blocked'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 z-10"
        />
      </div>

      {mode === 'app' && (
        <Dialog.Root open={dialog.kind !== 'closed'} onClose={closeDialog}>
          <Dialog.Backdrop />
          <Dialog.Panel className={dialog.kind === 'availability' ? 'max-w-[780px]' : undefined}>
            {dialog.kind === 'detail' && (
              <>
                <Dialog.Title>Campaign Detail</Dialog.Title>
                <EventDetail
                  campaign={dialog.campaign}
                  onEdit={() => setDialog({ kind: 'edit', campaign: dialog.campaign })}
                  onClose={closeDialog}
                />
              </>
            )}
            {dialog.kind === 'create' && (
              <>
                <Dialog.Title>Book Event</Dialog.Title>
                <BookingForm
                  mode="create"
                  dealers={dealers}
                  coaches={coaches}
                  styles={styles}
                  sources={sources}
                  defaultStartDate={dialog.date}
                  onSuccess={closeDialog}
                />
              </>
            )}
            {dialog.kind === 'edit' && (
              <>
                <Dialog.Title>Edit Campaign</Dialog.Title>
                <BookingForm
                  mode="edit"
                  campaign={dialog.campaign}
                  dealers={dealers}
                  coaches={coaches}
                  styles={styles}
                  sources={sources}
                  onSuccess={closeDialog}
                />
              </>
            )}
            {dialog.kind === 'availability' && (
              <>
                <Dialog.Title>Block Out Dates</Dialog.Title>
                <Dialog.Description>
                  Add, edit, or remove calendar blocks for holidays, closures, and coach time off.
                </Dialog.Description>
                <AvailabilityAdmin blocks={blocks} coaches={coaches} />
              </>
            )}
          </Dialog.Panel>
        </Dialog.Root>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl text-navy">{value}</div>
      <div className="text-xs text-stone-600">{sub}</div>
    </div>
  );
}

function Pill({
  active,
  label,
  colorBg,
  onClick,
}: {
  active: boolean;
  label: string;
  colorBg: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
        active ? 'border-navy' : 'border-transparent'
      }`}
      style={{ background: `${colorBg}22`, color: colorBg }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorBg }} />
      {label}
    </button>
  );
}
