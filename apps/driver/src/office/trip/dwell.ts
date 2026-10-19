// Office mode (Phase 8, O2): the time at a stop when the person typed none (the site's DwellPicker.tsx DwellFallback).

export interface DwellFallback {
  min: number;
  /**
   * place = the place's usual time ("usual here"); default = the type's default; either = not known yet (a request's
   * From and To: the usual time there when the place has one, else the default).
   */
  source: 'place' | 'default' | 'either';
}
