const ZONA = "America/Argentina/Buenos_Aires";

let clock: () => Date = () => new Date();

export function setClockForTests(next: (() => Date) | null): void {
  if (process.env.NODE_ENV !== "test" && next) {
    throw new Error("setClockForTests solo se usa con NODE_ENV=test");
  }
  clock = next ?? (() => new Date());
}

export function hoyAR(date = clock()): string {
  return date.toLocaleDateString("en-CA", { timeZone: ZONA });
}

export function toCbteFch(date = clock()): string {
  return hoyAR(date).replace(/-/g, "");
}
