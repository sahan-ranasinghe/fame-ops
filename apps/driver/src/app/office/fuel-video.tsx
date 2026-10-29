// Release 1.4.0 (docs/release-1.4.0.md item 2): one fill's fuel video played in the app (expo-video, the native controls),
// as the site's /fuel/:id plays it: the pieces one after another, the steps as bookmarks, the pieces to pick when the
// recording was interrupted, and "Open in the browser" (the way 1.3.0 played it). Opened from Reports → Fuel and from a
// task's fuel fills (office/fuelPlayer.ts hands the fill over in memory).

import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Chips } from '@/components/office/Controls';
import { ListEmpty } from '@/components/patterns/ListState';
import { Txt } from '@/components/ui';
import { markChips, pieceAt, playerFill, playerPieces } from '@/office/fuelPlayer';
import { clockOf, megabytes } from '@/office/manageLogic';
import { BackHeader, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function FuelVideo() {
  const { t } = useApp();
  const [fill] = useState(playerFill);
  const pieces = useMemo(() => (fill ? playerPieces(fill.video) : []), [fill]);
  const [piece, setPiece] = useState(fill?.start ?? 0);
  /** The second to open once the next piece is ready (a bookmark in another piece). */
  const seek = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(pieces[piece]?.url ?? null, (p) => {
    p.play();
  });
  // Another piece: the player loads it (and plays it: one after another, or the one picked).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const url = pieces[piece]?.url;
    if (!url) return;
    setFailed(false);
    void player.replaceAsync(url).then(() => player.play()).catch(() => setFailed(true));
  }, [piece, pieces, player]);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') setFailed(true);
    if (status === 'readyToPlay' && seek.current !== null) {
      player.currentTime = seek.current;
      seek.current = null;
      player.play();
    }
  }, [status, player]);
  // The pieces play one after another.
  useEventListener(player, 'playToEnd', () => {
    if (piece + 1 < pieces.length) setPiece(piece + 1);
  });

  if (!fill || pieces.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <BackHeader title={t('office.video.title')} />
        <ListEmpty text={t('office.video.gone')} />
      </View>
    );
  }
  const v = fill.video;
  const marks = markChips(v);
  function goTo(atS: number) {
    const target = pieceAt(atS, pieces);
    if (target.piece === piece) {
      player.currentTime = target.offset;
      player.play();
      return;
    }
    seek.current = target.offset;
    setPiece(target.piece);
  }
  const openBrowser = () => void Linking.openURL(pieces[piece].url).catch(() => setFailed(true));

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={fill.title} subtitle={fill.sub} />
      <Screen>
        <View testID="fuel-player" style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink }}>
          <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', aspectRatio: 16 / 9 }} />
        </View>
        {failed ? <Txt variant="small" color={colors.red}>{t('office.video.failed')}</Txt> : null}
        {marks.length > 0 && (
          <View style={{ gap: 6 }} testID="fuel-marks">
            <Txt variant="label">{t('office.video.steps')}</Txt>
            <Chips small options={marks.map((m) => ({ key: m.key, label: m.label }))} value=""
              onChange={(k) => goTo(marks.find((m) => m.key === k)!.mark.at_s)} />
          </View>
        )}
        {pieces.length > 1 && (
          <View style={{ gap: 6 }} testID="fuel-pieces">
            <Pill text={t('office.video.interrupted', { n: pieces.length })} tone="amber" size={12} />
            <Txt variant="small">{t('office.video.interruptedLine')}</Txt>
            <Chips small value={String(piece)}
              options={pieces.map((p, i) => ({ key: String(i), label: [t('office.video.piece', { n: i + 1 }), p.duration_s != null ? clockOf(p.duration_s) : ''].filter(Boolean).join(' · ') }))}
              onChange={(k) => {
                seek.current = null;
                setPiece(Number(k));
              }} />
          </View>
        )}
        <Txt variant="small">{[v.duration_s != null ? clockOf(v.duration_s) : '', v.bytes ? megabytes(v.bytes) : '', t('office.video.linkHour')].filter(Boolean).join(' · ')}</Txt>
        <Pressable accessibilityRole="link" onPress={openBrowser} testID="fuel-video-browser" style={({ pressed }) => [{ alignSelf: 'flex-start', paddingVertical: 8 }, pressed && { opacity: 0.8 }]}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('office.video.openBrowser')}</Txt>
        </Pressable>
      </Screen>
    </View>
  );
}
