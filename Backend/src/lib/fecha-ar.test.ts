import { afterEach, describe, expect, it } from "vitest";
import { hoyAR, setClockForTests, toCbteFch } from "./fecha-ar.js";

describe("fecha Argentina", () => {
  afterEach(() => setClockForTests(null));

  it("23:30 AR cae en el día argentino y no en el UTC del día siguiente", () => {
    setClockForTests(() => new Date("2026-10-18T02:30:00.000Z"));
    expect(hoyAR()).toBe("2026-10-17");
    expect(toCbteFch()).toBe("20261017");
  });
});
