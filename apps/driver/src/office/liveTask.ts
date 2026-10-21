// A task page that follows the trip live (Round 2, 21 October 2026): a Realtime channel on the task's stops and on the
// task itself while the page is open; any change (the driver slid Arrived or Left, the office moved a time) asks
// task_detail again, once a second at most, so the timeline's arrived / left / late and the re-estimated stops show
// without a reload. Office people read tasks and task_stops through RLS (the office roles); for anyone else nothing
// arrives and the page's own 30-second refresh stays. The same in Office mode and on /m/ (supabase-js in the browser).

import { useEffect, useRef } from 'react';

import { supabase } from '../lib/supabase';

/** How long changes are gathered before one refetch. */
export const LIVE_TASK_DEBOUNCE_MS = 1000;

export function useLiveTask(taskId: string | undefined, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!taskId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), LIVE_TASK_DEBOUNCE_MS);
    };
    const channel = supabase
      .channel(`office-task-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_stops', filter: `task_id=eq.${taskId}` }, fire)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` }, fire)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [taskId]);
}
