"use client";

import { CalendarDays } from "lucide-react";

const SLOTS_PER_DAY = 20;
const START_MINUTES = 8 * 60;
const SLOT_MINUTES = 30;
const DAY_WINDOW_MINUTES = SLOTS_PER_DAY * SLOT_MINUTES;

export type DashboardGanttBooking = {
  id: string;
  surveyor: string;
  ref: string;
  customerName: string;
  date: string;
  time: string;
  endDate?: string;
  endTime?: string;
  plannedHours?: number;
  type?: "Job";
  jobId?: string;
};

export type DashboardGanttNowMarker = {
  left: string;
  label: string;
};

function timeToMinutes(time: string) {
  const parts = time.split(":").map((part) => Number.parseInt(part, 10));
  const hours = parts[0];
  const minutes = parts[1];
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return START_MINUTES;
  return (hours as number) * 60 + (minutes as number);
}

function slotForTime(time: string, isEnd = false) {
  const rawSlot = (timeToMinutes(time) - START_MINUTES) / SLOT_MINUTES;
  const rounded = isEnd ? Math.ceil(rawSlot) : Math.floor(rawSlot);
  return Math.min(SLOTS_PER_DAY, Math.max(0, rounded));
}

function bookingSlotRange(booking: DashboardGanttBooking, day: string) {
  const startSlot = booking.date < day ? 0 : Math.min(SLOTS_PER_DAY - 1, slotForTime(booking.time));
  const endSlot =
    booking.endDate && booking.endDate > day
      ? SLOTS_PER_DAY
      : booking.endTime
        ? slotForTime(booking.endTime, true)
        : Math.min(SLOTS_PER_DAY, startSlot + Math.max(1, Math.ceil((booking.plannedHours ?? 1) * 2)));
  return {
    startSlot,
    endSlot: Math.min(SLOTS_PER_DAY, Math.max(startSlot + 1, endSlot)),
  };
}

function bookingFallsOnDate(booking: DashboardGanttBooking, date: string) {
  return date >= booking.date && date <= (booking.endDate || booking.date);
}

export function computeDashboardGanttNowMarker(
  now: Date | null,
  today: string | null,
  days: string[],
  formatDayLabel: (day: string) => string,
  formatTime: (now: Date) => string,
): DashboardGanttNowMarker | null {
  if (!now || !today || days.length === 0) return null;
  const dayIndex = days.indexOf(today);
  if (dayIndex < 0) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const dayProgress = Math.max(0, Math.min(1, (minutes - START_MINUTES) / DAY_WINDOW_MINUTES));
  const left = ((dayIndex + dayProgress) / days.length) * 100;
  return {
    label: `${formatDayLabel(today)} ${formatTime(now)}`,
    left: `${Math.max(0, Math.min(100, left))}%`,
  };
}

type Props = {
  days: string[];
  people: string[];
  bookings: DashboardGanttBooking[];
  nowMarker: DashboardGanttNowMarker | null;
  formatDayLabel: (day: string) => string;
  onOpenBooking: (booking: DashboardGanttBooking) => void;
  onOpenScheduler: () => void;
};

export function DashboardWeeklyGantt({
  days,
  people,
  bookings,
  nowMarker,
  formatDayLabel,
  onOpenBooking,
  onOpenScheduler,
}: Props) {
  const totalSlots = Math.max(1, days.length * SLOTS_PER_DAY);
  const weekBookings = bookings.filter((booking) => days.some((day) => bookingFallsOnDate(booking, day)));
  const bookingCount = weekBookings.length;

  return (
    <section className="ops-queue-panel dashboard-weekly-gantt" id="dashboard-weekly-gantt" aria-label="Weekly schedule Gantt">
      <header>
        <div>
          <h3>Weekly schedule</h3>
          <p>
            {bookingCount} booking{bookingCount === 1 ? "" : "s"} · overview for the week
          </p>
        </div>
        <div className="dashboard-weekly-gantt-actions">
          <button className="secondary-button" type="button" onClick={onOpenScheduler}>
            <CalendarDays size={15} />
            Open scheduler
          </button>
          <CalendarDays size={18} aria-hidden="true" />
        </div>
      </header>

      <div className="dashboard-weekly-gantt-scroll">
        <div className="dashboard-weekly-gantt-board">
          <div className="dashboard-weekly-gantt-row head">
            <span>Engineer</span>
            <div className="dashboard-weekly-gantt-axis" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((day) => (
                <time key={day}>{formatDayLabel(day)}</time>
              ))}
              {nowMarker ? (
                <span
                  aria-label={`Current time ${nowMarker.label}`}
                  className="job-gantt-live-marker job-gantt-live-marker-head dashboard-gantt-now"
                  style={{ left: nowMarker.left }}
                >
                  <b>{nowMarker.label}</b>
                </span>
              ) : null}
            </div>
          </div>

          {people.map((person) => {
            const personBookings = weekBookings.filter((booking) => booking.surveyor === person);
            return (
              <article className="dashboard-weekly-gantt-row" key={person}>
                <header>
                  <strong>{person}</strong>
                  <span>
                    {personBookings.length} item{personBookings.length === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="dashboard-weekly-gantt-track">
                  {days.map((day) => (
                    <span className="dashboard-weekly-gantt-day" key={day} aria-hidden="true" />
                  ))}
                  <div className="dashboard-weekly-gantt-scale" aria-hidden="true">
                    {days.map((day) => (
                      <span key={day}>
                        <i>08</i>
                        <i>12</i>
                        <i>18</i>
                      </span>
                    ))}
                  </div>
                  {nowMarker ? (
                    <span aria-hidden="true" className="job-gantt-live-marker dashboard-gantt-now" style={{ left: nowMarker.left }} />
                  ) : null}
                  {personBookings.map((booking, index) => {
                    const dayIndex = days.findIndex((day) => bookingFallsOnDate(booking, day));
                    if (dayIndex < 0) return null;
                    const firstDay = days[dayIndex]!;
                    const range = bookingSlotRange(booking, firstDay);
                    const lastDayIndex = days.reduce((last, day, idx) => (bookingFallsOnDate(booking, day) ? idx : last), dayIndex);
                    const endRange = bookingSlotRange(booking, days[lastDayIndex]!);
                    const startSlot = dayIndex * SLOTS_PER_DAY + range.startSlot;
                    const endSlot = lastDayIndex * SLOTS_PER_DAY + endRange.endSlot;
                    const left = (startSlot / totalSlots) * 100;
                    const width = (Math.max(startSlot + 1, endSlot) - startSlot) / totalSlots * 100;
                    return (
                      <button
                        className={`dashboard-weekly-gantt-bar tone-${index % 4}`}
                        key={booking.id}
                        type="button"
                        style={{ left: `${left}%`, width: `${Math.max(width, 2.2)}%` }}
                        title={`${booking.ref} · ${booking.time} · ${booking.customerName}`}
                        onClick={() => onOpenBooking(booking)}
                      >
                        <strong>{booking.ref}</strong>
                        <span>{booking.time}</span>
                      </button>
                    );
                  })}
                  {!personBookings.length ? <div className="dashboard-weekly-gantt-empty">No bookings</div> : null}
                </div>
              </article>
            );
          })}

          {!people.length ? <div className="ops-queue-empty">No engineers to show on the week board.</div> : null}
        </div>
      </div>
    </section>
  );
}
