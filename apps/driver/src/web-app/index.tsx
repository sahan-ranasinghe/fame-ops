// The mobile website's first page: the sign-in, else Office mode. A phone sent here from a desktop page (?from=/requests/<id>)
// lands on that page's own screen once signed in (the app's link map, office/nav.ts routeForUrl, by permission), else Home.
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { keepFrom, takeFrom } from '@/lib/viewChoice';
import { routeForUrl } from '@/office/nav';
import { useOfficeMe } from '@/office/store';

export default function WebIndex() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const me = useOfficeMe();
  const target = useMemo(() => {
    keepFrom(from);
    if (!me) return '/login';
    return routeForUrl(takeFrom() ?? undefined, me.permissions) ?? '/office';
  }, [from, me]);
  return <Redirect href={target as never} />;
}
