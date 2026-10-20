// The mobile website's first page: the sign-in, else Office mode. A phone sent here from a desktop page (?from=/requests/<id>)
// lands on that page's own screen once signed in (the app's link map, office/nav.ts routeForUrl, by permission), else Home.
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { keepFrom, takeFrom } from '@/lib/viewChoice';
import { routeForUrl } from '@/office/nav';
import { useOfficeMe } from '@/office/store';

export default function WebIndex() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const me = useOfficeMe();
  // The kept page is read once, when signed in (it is forgotten as it is read): a second render must not lose it, and a
  // person sent to the sign-in finds it here again afterwards (the web root waits for the session before this page).
  const [kept] = useState(() => {
    keepFrom(from);
    return me ? takeFrom() : null;
  });
  const target = me ? routeForUrl(kept ?? undefined, me.permissions) ?? '/office' : '/login';
  return <Redirect href={target as never} />;
}
