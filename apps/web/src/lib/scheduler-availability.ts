import { weekDays, type EmployeeAvailability, type Weekday } from "@/lib/access";

export const inactiveAvailabilitySlot = { active: false, from: "00:00", to: "00:00" } as const;

export const defaultContractorDaySlot = { active: true, from: "08:00", to: "17:00" } as const;

/** Weekday key for an ISO date (noon UTC — matches schedule week builders). */
export function weekdayFromIsoDate(date: string): Weekday {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekDays[(day + 6) % 7] ?? "Mon";
}

/**
 * Employee-card availability is authoritative when a card record exists.
 * Never fall back to hardcoded name tables — unticked Friday must stay unavailable.
 */
export function availabilityForDate(
  date: string,
  cardAvailability?: EmployeeAvailability | null,
  options?: { isContractor?: boolean },
) {
  if (!date) return { ...inactiveAvailabilitySlot };
  const day = weekdayFromIsoDate(date);

  if (cardAvailability) {
    const slot = cardAvailability[day];
    if (!slot) return { ...inactiveAvailabilitySlot };
    return {
      active: Boolean(slot.active),
      from: slot.from || "00:00",
      to: slot.to || "00:00",
    };
  }

  // No employee card — contractors default Mon–Fri office hours; everyone else unavailable.
  if (options?.isContractor && day !== "Sat" && day !== "Sun") {
    return { ...defaultContractorDaySlot };
  }

  return { ...inactiveAvailabilitySlot };
}

export function availabilityLabelForDate(
  date: string,
  cardAvailability?: EmployeeAvailability | null,
  options?: { isContractor?: boolean },
) {
  if (!date) return "Pick a date";
  const availability = availabilityForDate(date, cardAvailability, options);
  return availability.active ? `${availability.from}-${availability.to}` : "Unavailable";
}

export function employeeHasAnyAvailability(availability?: EmployeeAvailability | null) {
  if (!availability) return false;
  return weekDays.some((day) => Boolean(availability[day]?.active));
}

export function scheduleBookingChipLabel(booking: {
  ref: string;
  customerName?: string;
  customer?: string;
  costCentreName?: string;
  time?: string;
}) {
  const customer = (booking.customerName || booking.customer || "").trim();
  const costCentre = (booking.costCentreName || "").trim();
  const parts = [booking.ref];
  if (customer) parts.push(customer);
  if (costCentre) parts.push(costCentre);
  return parts.join(" · ");
}

export function scheduleBookingChipDetail(booking: {
  time?: string;
  endTime?: string;
  description?: string;
}) {
  const time = (booking.time || "").trim();
  const end = (booking.endTime || "").trim();
  if (time && end) return `${time}–${end}`;
  if (time) return time;
  return (booking.description || "").trim();
}
