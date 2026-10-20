// The mobile website's first page: Office mode when signed in, else the sign-in.
import { Redirect } from 'expo-router';

import { useOfficeMe } from '@/office/store';

export default function WebIndex() {
  return <Redirect href={useOfficeMe() ? '/office' : '/login'} />;
}
