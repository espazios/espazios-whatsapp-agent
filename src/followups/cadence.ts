/**
 * Cadencia de seguimiento (push), acordada con Kapso 2026-09-25 — ver
 * docs/isa-v2-system-prompt.md, entrada "CAMBIOS DE KAPSO APLICADOS".
 *
 * `attempt` cuenta los intentos YA enviados (arranca en 0 = ninguno
 * enviado todavia). Los 4 intentos se calculan siempre relativo a
 * `createdAt` (cuando el pending_action quedo registrado), no relativo
 * al ultimo envio — asi lo confirmo el ejemplo acordado con el usuario:
 * pendiente el martes 3:00pm -> intento 1 martes 3:10pm, intento 2
 * martes 5:10pm, intento 3 miercoles 6:00pm, intento 4 viernes 6:00pm.
 */

const TIMEZONE = "America/Bogota";
// Colombia no observa horario de verano — offset fijo UTC-5 todo el año.
const BOGOTA_UTC_OFFSET_HOURS = 5;

const BUSINESS_START_HOUR = 7;
const BUSINESS_END_HOUR = 19;
export const MAX_ATTEMPTS = 4;

interface BogotaParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo ... 6 = sabado */
  weekday: number;
}

function bogotaParts(date: Date): BogotaParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl con hour12:false devuelve "24" a medianoche en vez de "00" — normalizamos.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday],
  };
}

/** Construye el instante UTC correspondiente a una fecha/hora local de Bogota. */
function fromBogota(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + BOGOTA_UTC_OFFSET_HOURS, minute));
}

function addDaysBogota(date: Date, days: number): { year: number; month: number; day: number } {
  const p = bogotaParts(date);
  // Sumar dias en UTC sobre la fecha calendario local (evita drift de zona horaria).
  const asUtc = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate() };
}

function isBusinessWindow(date: Date): boolean {
  const p = bogotaParts(date);
  if (p.weekday === 0 || p.weekday === 6) return false; // fin de semana
  if (p.hour < BUSINESS_START_HOUR) return false;
  if (p.hour >= BUSINESS_END_HOUR) return false;
  return true;
}

/**
 * Si `date` cae fuera de lunes-viernes 07:00-19:00 Bogota, la recorre al
 * inicio de la siguiente ventana habil:
 * - sabado/domingo -> lunes 07:00
 * - antes de las 07:00 (dia habil) -> ese mismo dia 07:00
 * - 19:00 en adelante -> siguiente dia habil 07:00
 */
export function clampToBusinessWindow(date: Date): Date {
  if (isBusinessWindow(date)) return date;
  const p = bogotaParts(date);

  if (p.weekday === 0) {
    const { year, month, day } = addDaysBogota(date, 1); // domingo -> lunes
    return fromBogota(year, month, day, BUSINESS_START_HOUR, 0);
  }
  if (p.weekday === 6) {
    const { year, month, day } = addDaysBogota(date, 2); // sabado -> lunes
    return fromBogota(year, month, day, BUSINESS_START_HOUR, 0);
  }

  if (p.hour < BUSINESS_START_HOUR) {
    return fromBogota(p.year, p.month, p.day, BUSINESS_START_HOUR, 0);
  }

  // p.hour >= BUSINESS_END_HOUR: siguiente dia habil a las 07:00.
  const daysToAdd = p.weekday === 5 ? 3 : 1; // viernes tarde -> lunes; resto -> dia siguiente
  const next = addDaysBogota(date, daysToAdd);
  return fromBogota(next.year, next.month, next.day, BUSINESS_START_HOUR, 0);
}

/**
 * Calcula cuando debe salir el siguiente intento, dado cuantos ya se
 * mandaron (`attempt`, 0-indexado) y las fechas de referencia. Devuelve
 * `null` cuando ya no quedan intentos (`attempt >= MAX_ATTEMPTS`) — en
 * ese caso la cadena debe cerrarse (`status: "closed"`), no reprogramarse.
 */
export function computeNextDueAt(params: { attempt: number; createdAt: Date; lastSentAt: Date | null }): Date | null {
  const { attempt, createdAt, lastSentAt } = params;
  let raw: Date;

  switch (attempt) {
    case 0: {
      // Intento 1: 10 minutos despues de registrado.
      raw = new Date(createdAt.getTime() + 10 * 60 * 1000);
      break;
    }
    case 1: {
      // Intento 2: 2 horas despues del intento 1 (lastSentAt).
      const from = lastSentAt ?? createdAt;
      raw = new Date(from.getTime() + 2 * 60 * 60 * 1000);
      break;
    }
    case 2: {
      // Intento 3: dia siguiente a createdAt, 18:00 Bogota.
      const { year, month, day } = addDaysBogota(createdAt, 1);
      raw = fromBogota(year, month, day, 18, 0);
      break;
    }
    case 3: {
      // Intento 4 (ultimo): tercer dia despues de createdAt, 18:00 Bogota.
      const { year, month, day } = addDaysBogota(createdAt, 3);
      raw = fromBogota(year, month, day, 18, 0);
      break;
    }
    default:
      return null; // ya se agotaron los MAX_ATTEMPTS intentos.
  }

  return clampToBusinessWindow(raw);
}
