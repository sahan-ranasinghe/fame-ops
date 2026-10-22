// Round 4–7 (§33.2, §33.13: "a feature switched off hides its part"): the fill-up reminder ("I'll fill up on the way",
// armed for 30 minutes after the start) follows the switch fuel_card. Turned off by the office while one is armed: it is
// cancelled and taken out of the tray, so it never fires with the switch off (the card and the task screen's line already
// follow the switch). The answer and its memo stay; a reminder is armed again only by a new answer with the switch on.

import { useEffect } from 'react';

import { disarmFuelReminder } from './notifications';

export function useFuelReminderSwitch(on: boolean): void {
  useEffect(() => {
    if (!on) void disarmFuelReminder();
  }, [on]);
}
