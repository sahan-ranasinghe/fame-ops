// Part 3b (G): a driver_profile answer for the tests: the full one (users or vehicles) and the one others get.
import type { DriverProfile } from "../../data/types";

export const FULL_PROFILE: DriverProfile = {
  driver: {
    name: "Kamal Perera",
    code: "D-07",
    username: "kamal.p",
    active: true,
    language: "si",
    phone: "+94771112222",
    phone_display: "077 111 2222",
    whatsapp: "+94779998888",
    whatsapp_display: "077 999 8888",
    links: { phone: "+94771112222", phone_display: "077 111 2222", call: "tel:+94771112222", whatsapp: "https://wa.me/94779998888" },
    current_vehicle: "WP CAB-4521",
    app_version: "1.2.0+abc123",
    licence_chip: { chip: "orange", expiry: "2026-11-10", days: 23 },
  },
  emergency: {
    name: "Nimali Perera",
    relation: "wife",
    phone: "+94712223333",
    phone_display: "071 222 3333",
    links: { phone: "+94712223333", phone_display: "071 222 3333", call: "tel:+94712223333", whatsapp: "https://wa.me/94712223333" },
  },
  licence: { number: "B1234567", expiry: "2026-11-10", chip: "orange", front_url: "https://files.test/front.jpg" },
  this_month: { month: "2026-10", tasks: 12, km: 840.4 },
  not_available: [{
    id: "u2",
    driver: "Kamal Perera",
    from: "2026-10-22 08:00",
    to: "2026-10-22 13:00",
    day: "2026-10-22",
    last_day: "2026-10-22",
    end_time: "13:00",
    part: "morning",
    reason: "half_day",
    reason_text: "Half day",
    text: "Not available · half day, back 13:00",
    added_by: "Kamal Perera (the driver)",
    added: "2026-10-18 10:00",
  }],
  missing: ["emergency contact"],
  changes: [
    { field: "phone", what: "Phone", from: "077 000 0000", to: "077 111 2222", by: "changed by the driver", by_driver: true, at: "2026-10-18 09:12" },
    { field: "licence_front_photo", what: "Licence (front)", to: "a new photo", by: "changed by Palitha", at: "2026-10-17 15:00" },
  ],
};

/** What someone without users or vehicles gets: no emergency contact, no licence, no changes. */
export const LIMITED_PROFILE: DriverProfile = {
  driver: { ...FULL_PROFILE.driver },
  this_month: FULL_PROFILE.this_month,
  not_available: [],
  missing: ["licence expiry"],
  private_hidden: "The emergency contact and the licence are shown to people with users or vehicles.",
};
