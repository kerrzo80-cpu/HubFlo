"use client";

import { useMemo, useState } from "react";
import {
  addDaysIso,
  isoDate,
  monthYearLabel,
  shiftMonthIso,
  startOfWeekIso,
  weekdayShort,
} from "@/lib/field/format";

type DayPickerProps = {
  selectedDate: string;
  datesWithJobs: string[];
  onSelectDate: (date: string) => void;
};

export function DayPicker({ selectedDate, datesWithJobs, onSelectDate }: DayPickerProps) {
  const today = isoDate();
  const jobSet = useMemo(() => new Set(datesWithJobs), [datesWithJobs]);
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(selectedDate));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => `${selectedDate.slice(0, 7)}-01`);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index)),
    [weekStart],
  );

  const monthCells = useMemo(() => {
    const first = `${monthCursor.slice(0, 7)}-01`;
    const gridStart = startOfWeekIso(first);
    return Array.from({ length: 42 }, (_, index) => addDaysIso(gridStart, index));
  }, [monthCursor]);

  function selectDate(date: string) {
    onSelectDate(date);
    setWeekStart(startOfWeekIso(date));
    setMonthCursor(`${date.slice(0, 7)}-01`);
  }

  return (
    <section className="field-day-picker" aria-label="Choose day">
      <div className="field-week-nav">
        <button
          type="button"
          className="field-day-nav"
          aria-label="Previous week"
          onClick={() => setWeekStart((current) => addDaysIso(current, -7))}
        >
          ‹
        </button>
        <div className="field-week-strip" role="list">
          {weekDays.map((date) => {
            const dayNumber = Number(date.slice(8, 10));
            const selected = date === selectedDate;
            const isToday = date === today;
            const hasJobs = jobSet.has(date);
            return (
              <button
                key={date}
                type="button"
                role="listitem"
                className={[
                  "field-week-day",
                  selected ? "is-selected" : "",
                  isToday ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={selected}
                aria-label={`${weekdayShort(date)} ${dayNumber}${hasJobs ? ", has jobs" : ""}`}
                onClick={() => selectDate(date)}
              >
                <span className="field-week-dow">{weekdayShort(date)}</span>
                <span className="field-week-num">{dayNumber}</span>
                <span className={`field-week-dot${hasJobs ? " has-jobs" : ""}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="field-day-nav"
          aria-label="Next week"
          onClick={() => setWeekStart((current) => addDaysIso(current, 7))}
        >
          ›
        </button>
      </div>

      <div className="field-day-actions">
        <button
          type="button"
          className={`field-day-action${calendarOpen ? " is-active" : ""}`}
          aria-expanded={calendarOpen}
          onClick={() => setCalendarOpen((open) => !open)}
        >
          Calendar
        </button>
        {selectedDate !== today ? (
          <button type="button" className="field-day-action" onClick={() => selectDate(today)}>
            Today
          </button>
        ) : null}
      </div>

      {calendarOpen ? (
        <div className="field-month-panel">
          <div className="field-month-nav">
            <button
              type="button"
              className="field-day-nav"
              aria-label="Previous month"
              onClick={() => setMonthCursor((current) => shiftMonthIso(current, -1))}
            >
              ‹
            </button>
            <p className="field-month-label">{monthYearLabel(monthCursor)}</p>
            <button
              type="button"
              className="field-day-nav"
              aria-label="Next month"
              onClick={() => setMonthCursor((current) => shiftMonthIso(current, 1))}
            >
              ›
            </button>
          </div>
          <div className="field-month-dows" aria-hidden>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="field-month-grid" role="grid" aria-label={monthYearLabel(monthCursor)}>
            {monthCells.map((date) => {
              const inMonth = date.slice(0, 7) === monthCursor.slice(0, 7);
              const selected = date === selectedDate;
              const isToday = date === today;
              const hasJobs = jobSet.has(date);
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  className={[
                    "field-month-day",
                    inMonth ? "" : "is-outside",
                    selected ? "is-selected" : "",
                    isToday ? "is-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={selected}
                  onClick={() => {
                    selectDate(date);
                    setCalendarOpen(false);
                  }}
                >
                  <span>{Number(date.slice(8, 10))}</span>
                  <span className={`field-week-dot${hasJobs ? " has-jobs" : ""}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
