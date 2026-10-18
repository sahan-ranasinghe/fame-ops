// New drivers and PINs: what the Fame Driver sign-in needs.

export interface DriverFields {
  name: string;
  code: string;
  phone: string;
  username: string;
  pin: string;
}

export const emptyDriver = (): DriverFields => ({ name: "", code: "", phone: "", username: "", pin: "" });

export const USERNAME_RULE = /^[A-Za-z0-9._-]{3,40}$/;
export const isPin = (pin: string) => /^\d{6}$/.test(pin);

export function validateNewDriver(f: DriverFields): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.name) || !t(f.code) || !t(f.username)) return { error: "Add the name, code and username." };
  if (!USERNAME_RULE.test(t(f.username))) return { error: "The username needs 3–40 letters, numbers, dots, dashes or underscores." };
  if (!isPin(t(f.pin))) return { error: "The PIN must be exactly 6 digits." };
  // Part 3b (G): every driver has a mobile number (the server checks it is a Sri Lankan number).
  if (!t(f.phone)) return { error: "Add the driver's mobile number." };
  return { input: { name: t(f.name), code: t(f.code), username: t(f.username), pin: t(f.pin), phone: t(f.phone) } };
}

/** A random 6-digit PIN. */
export function randomPin(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}
