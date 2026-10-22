// Review of Round 4–7 (docs/phase8-plan.md §33.13: "a feature switched off hides its part"), Office mode and /m/ through the
// router with the design pages' sample answers (src/design/sampleOffice.ts) and get_settings saying which switches are off
// (office/switches.ts reads it once for every screen):
//   - the trip on the way with passengers, vehicle_check, holder_contact and fuel_card off: no riders (their count, names,
//     rows, Call, WhatsApp, Share trip), no vehicle check, no holder's Call / WhatsApp, no fuel card; the trip's row still says
//     who made it ("Made by",
//     lost while on the way before); the same page with the switches on keeps all of it;
//   - the bar never holds ⋯ More alone (a finished task the person may only see the route of: the route on the bar);
//   - the request with passengers off: no "who rides" and no people in the facts; the distance through its key;
//   - Review with vehicle_check off: no "✓ Checked";
//   - the holder's line and strip, a vehicle's checks: nothing with their switch off.
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import TaskDetailScreen from '@/app/office/task/[id]';
import ApproveRequest from '@/app/office/request/[id]';
import TripReview from '@/app/office/trip/review';
import { HolderLine, HolderStrip } from '@/components/office/HolderParts';
import { VehicleChecksSection } from '@/components/office/VehicleChecks';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { officeDesignValue, requestAnswers, reviewAnswers, reviewDraft, tripAnswers } from '@/design/sampleOffice';
import { OfficeValueProvider } from '@/office/state';
import { forgetSwitches } from '@/office/switches';
import { setDraft } from '@/office/trip/draft';
import type { Holder, TaskDetail } from '@/office/types';

const t = require('./fakeOffice').mockUseApp().t as (k: string, v?: Record<string, string | number>) => string;

type Answers = Record<string, (args: Record<string, unknown>) => unknown>;
const OFF = { settings: { passengers: false, vehicle_check: false, holder_contact: false, fuel_card: false, tasks_need_approval: false, self_drive_allowed: true } };
const ON = { settings: { passengers: true, vehicle_check: true, holder_contact: true, fuel_card: true, tasks_need_approval: false, self_drive_allowed: true } };

/** The trip on the way, with who made it, and the task changed by `edit`. */
function trip(settings: unknown, edit: (task: TaskDetail['task']) => TaskDetail['task'] = (x) => x): Answers {
  const answers = tripAnswers();
  const detail = answers.task_detail({}) as TaskDetail;
  return { ...answers, get_settings: () => settings, task_detail: () => ({ ...detail, task: edit({ ...detail.task, created_by: 'Nimal Perera' }) }) };
}

const page = (name: string) => () => <Text>{`page ${name}`}</Text>;
function routesFor(answers: Answers) {
  const value = officeDesignValue(answers);
  return {
    _layout: () => <Stack screenOptions={{ headerShown: false }} />,
    'office/task/[id]': () => <OfficeValueProvider value={value}><TaskDetailScreen /></OfficeValueProvider>,
    'office/request/[id]': () => <OfficeValueProvider value={value}><ApproveRequest /></OfficeValueProvider>,
    'office/trip/review': function Review() {
      useState(() => {
        setDraft(reviewDraft());
        return true;
      });
      return <OfficeValueProvider value={value}><TripReview /></OfficeValueProvider>;
    },
    'office/(tabs)/live': page('live'),
    'office/task/[id]/route': page('route'),
    'office/task/[id]/time': page('change the task'),
    'office/holder-asks': page('asks'),
  };
}

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  forgetSwitches();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

describe('the trip on the way', () => {
  it('passengers, vehicle_check and holder_contact off: none of their parts; the trip still says who made it', async () => {
    renderRouter(routesFor(trip(OFF)), { initialUrl: '/office/task/t-design-4' });
    await screen.findByTestId('task-banner', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('task-passengers')).toBeNull());
    expect(screen.queryByTestId('passenger-call')).toBeNull();
    expect(screen.queryByTestId('passenger-whatsapp')).toBeNull();
    expect(screen.queryByTestId('passenger-share')).toBeNull();
    expect(screen.queryByText(t('office.checks.title'))).toBeNull();
    expect(screen.queryByTestId('task-checks')).toBeNull();
    expect(screen.queryByTestId('task-holder-call')).toBeNull();
    expect(screen.queryByTestId('task-holder-whatsapp')).toBeNull();
    expect(screen.getByTestId('task-holder-row')).toHaveTextContent(t('office.task.madeBy', { name: 'Nimal Perera' }), { exact: false });
    expect(screen.queryByTestId('fuel-card')).toBeNull();
    // What is not switched off stays: the driver, the stops, the bar.
    expect(screen.getByTestId('task-driver-call')).toBeTruthy();
    expect(screen.getByTestId('task-stops')).toBeTruthy();
    expect(screen.getByTestId('task-change-time')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('the switches on: who rides, the check and the holder with Call and WhatsApp', async () => {
    renderRouter(routesFor(trip(ON)), { initialUrl: '/office/task/t-design-4' });
    expect(await screen.findByTestId('task-passengers', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId('passenger-call')).toBeTruthy();
    expect(screen.getByText(t('office.checks.title'))).toBeTruthy();
    expect(screen.getByTestId('task-holder-call')).toBeTruthy();
    expect(screen.getByTestId('task-holder-row')).toHaveTextContent(t('office.ui3.assignedBy', { name: 'Palitha Fernando · Fleet admin' }), { exact: false });
    expect(screen.getByTestId('fuel-card')).toBeTruthy();
  });

  it('no holder sent (an older server): "Made by" on the trip\'s row while on the way', async () => {
    renderRouter(routesFor(trip(ON, (x) => ({ ...x, holder: undefined }))), { initialUrl: '/office/task/t-design-4' });
    expect(await screen.findByTestId('task-holder-row', {}, { timeout: 5000 })).toHaveTextContent(t('office.task.madeBy', { name: 'Nimal Perera' }), { exact: false });
  });

  it('a bar never holds ⋯ More alone: a finished trip the person may only see the route of shows it on the bar', async () => {
    renderRouter(routesFor(trip(ON, (x) => ({ ...x, status: 'completed', completed: '14:30' }) as TaskDetail['task'])), { initialUrl: '/office/task/t-design-4' });
    expect(await screen.findByTestId('task-route', {}, { timeout: 5000 })).toHaveTextContent(t('office.history.showDrivenRoute'));
    expect(screen.queryByTestId('task-more')).toBeNull();
    fireEvent.press(screen.getByTestId('task-route'));
    expect(await screen.findByText('page route')).toBeTruthy();
  });
});

describe('the request', () => {
  it('passengers off: no "who rides" and no people in the facts; the distance in its words', async () => {
    const answers = requestAnswers();
    const card = (answers.list_requests({}) as { requests: Record<string, unknown>[] }).requests[0];
    const withRiders = { ...card, passengers_list: [{ name: 'Achini Perera', registered: true }] };
    renderRouter(routesFor({ ...answers, list_requests: () => ({ requests: [withRiders], count: 1 }), get_settings: () => OFF }), { initialUrl: '/office/request/r-design-1' });
    expect(await screen.findByTestId('request-facts', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText(`${t('office.trip.kmN', { km: 173 })} ${t('office.ui3.factDistance')}`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(`5 ${t('office.ui3.factPeople')}`)).toBeNull());
    expect(screen.queryByText(t('office.passengers.title'))).toBeNull();
    expect(screen.queryByText('Achini Perera')).toBeNull();
  });

  it('passengers on: who rides and the people counted', async () => {
    const answers = requestAnswers();
    const card = (answers.list_requests({}) as { requests: Record<string, unknown>[] }).requests[0];
    const withRiders = { ...card, passengers_list: [{ name: 'Achini Perera', registered: true }] };
    renderRouter(routesFor({ ...answers, list_requests: () => ({ requests: [withRiders], count: 1 }), get_settings: () => ON }), { initialUrl: '/office/request/r-design-1' });
    expect(await screen.findByLabelText(`5 ${t('office.ui3.factPeople')}`, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('Achini Perera')).toBeTruthy();
  });
});

describe('Review', () => {
  it('vehicle_check off: no "✓ Checked" beside the vehicle', async () => {
    renderRouter(routesFor({ ...reviewAnswers(), get_settings: () => OFF }), { initialUrl: '/office/trip/review' });
    expect(await screen.findByTestId('review-driver', {}, { timeout: 5000 })).toBeTruthy();
    await act(async () => undefined);
    expect(screen.queryByText(t('office.ui3.checked'))).toBeNull();
  });

  it('vehicle_check on: "✓ Checked" as before', async () => {
    renderRouter(routesFor({ ...reviewAnswers(), get_settings: () => ON }), { initialUrl: '/office/trip/review' });
    expect(await screen.findByText(t('office.ui3.checked'), {}, { timeout: 5000 })).toBeTruthy();
  });
});

describe('the parts themselves', () => {
  const holder = { task_id: 't-9', name: 'Palitha Fernando', label: 'Fleet admin', by: 'assigned', window: '08:00–11:00', from: '08:00', to: '11:00', call: 'tel:+94771111111', whatsapp: 'https://wa.me/94771111111' } as unknown as Holder;
  const draw = (settings: unknown) => {
    const value = officeDesignValue({ get_settings: () => settings, vehicle_checks: () => ({ checks: [] }) });
    renderRouter({
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      parts: () => (
        <OfficeValueProvider value={value}>
          <View>
            <HolderLine holder={holder} resource="vehicle" what="CAP-2207" />
            <HolderStrip holder={holder} resource="vehicle" what="CAP-2207" />
            <VehicleChecksSection plate="CAP-2207" />
          </View>
        </OfficeValueProvider>
      ),
    }, { initialUrl: '/parts' });
  };

  it('holder_contact and vehicle_check off: no holder, no checks', async () => {
    draw(OFF);
    await waitFor(() => expect(screen.queryByTestId('holder-line')).toBeNull());
    expect(screen.queryByTestId('holder-strip')).toBeNull();
    expect(screen.queryByTestId('check-today')).toBeNull();
  });

  it('on: the holder\'s line and strip, the vehicle\'s checks', async () => {
    draw(ON);
    expect(await screen.findByTestId('holder-line')).toBeTruthy();
    expect(screen.getByTestId('holder-strip')).toBeTruthy();
    expect(screen.getByTestId('check-today')).toHaveTextContent(t('office.checks.noneToday'));
  });
});
