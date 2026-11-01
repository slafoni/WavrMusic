import { useEffect, useRef, useState } from 'react';
import type { LyricsDocument, Track } from '../../../shared/models';
import { mergeLyricsExtras, pickBestLyrics } from '../../../shared/lyrics';
import { useSettings } from '../state';
import {
  addMachineLyricsExtras,
  clearLyricaCacheFor,
  fetchLrcmuxLyrics,
  fetchLyricaLyrics,
  fetchServerLyricsDocument,
  resolveLyricaBaseUrl,
} from '../services/lyricsService';

export function useLyrics(track: Track | null, retryKey = 0): {
  lyrics: LyricsDocument | null;
  loading: boolean;
  onlineLoading: boolean;
  onlineFailed: boolean;
  failed: boolean;
  translationRequested: boolean;
  translationAvailable: boolean;
  romanizationRequested: boolean;
  romanizationAvailable: boolean;
} {
  const settings = useSettings();
  const [lyrics, setLyrics] = useState<LyricsDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineFailed, setOnlineFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const lyricaBaseUrl = resolveLyricaBaseUrl(
    settings.lyricaInstanceMode,
    settings.lyricaInstanceUrl,
  );
  const translationRequested = !!settings.lyricsTranslation;
  const romanizationRequested = !!settings.lyricsRomanization;
  const language = settings.lyricsLanguage || 'en';

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!track) {
      setLyrics(null);
      setLoading(false);
      setOnlineLoading(false);
      setOnlineFailed(false);
      setFailed(false);
      return;
    }

    if (retryKey > 0) clearLyricaCacheFor(track);

    let serverLyrics: LyricsDocument | null = null;
    const onlineDocs: Array<LyricsDocument | null> = [];
    let serverDone = false;
    let onlineDone = 0;
    let augmentedKey = '';
    let currentDocumentKey = '';
    const augmentedDocuments = new Map<string, LyricsDocument>();

    setLyrics(null);
    setLoading(true);
    setOnlineLoading(true);
    setOnlineFailed(false);
    setFailed(false);

    const bestOnline = () =>
      onlineDocs.reduce<LyricsDocument | null>(
        (best, document) => pickBestLyrics(best, document),
        null,
      );

    const maybeAugment = (document: LyricsDocument | null) => {
      if (!document) return;
      const needsTranslation =
        translationRequested &&
        !document.lines.some((line) => !!line.translation) &&
        !document.translatedPlain;
      const needsRomanization =
        romanizationRequested &&
        !document.lines.some((line) => !!line.romanization) &&
        !document.romanizedPlain;
      if (!needsTranslation && !needsRomanization) return;
      const documentKey = `${document.plain}\u0000${document.lines.map((line) => line.text).join('\n')}`;
      const key = `${documentKey}|${needsTranslation ? 't' : ''}|${needsRomanization ? 'r' : ''}`;
      if (augmentedKey === key) return;
      augmentedKey = key;
      addMachineLyricsExtras(document, {
        translate: needsTranslation,
        romanize: needsRomanization,
        language,
      })
        .then((augmented) => {
          augmentedDocuments.set(documentKey, augmented);
          if (requestRef.current === requestId && currentDocumentKey === documentKey) {
            setLyrics(augmented);
          }
        })
        .catch(() => {
          /* extras are optional */
        });
    };

    const applyBest = () => {
      if (requestRef.current !== requestId) return null;
      const best = pickBestLyrics(serverLyrics, bestOnline());
      const merged = mergeLyricsExtras(best, onlineDocs);
      if (merged) {
        currentDocumentKey = `${merged.plain}\u0000${merged.lines.map((line) => line.text).join('\n')}`;
        const resolved = augmentedDocuments.get(currentDocumentKey) || merged;
        setLyrics(resolved);
        setLoading(false);
        maybeAugment(merged);
      }
      return merged;
    };

    const finalize = () => {
      if (requestRef.current !== requestId) return;
      const best = applyBest();
      setLoading(false);
      setOnlineLoading(false);
      setOnlineFailed(!bestOnline());
      setFailed(!best);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (onlineDone >= 2) return;
      if (serverLyrics) applyBest();
    }, 2200);

    const startOnline = (promise: Promise<LyricsDocument | null>) => {
      promise
        .then((result) => {
          if (requestRef.current !== requestId) return;
          onlineDocs.push(result);
          if (result) applyBest();
        })
        .finally(() => {
          if (requestRef.current !== requestId) return;
          onlineDone += 1;
          if (onlineDone >= 2) {
            window.clearTimeout(fallbackTimer);
            setOnlineLoading(false);
            setOnlineFailed(!bestOnline());
            if (serverDone) finalize();
          }
        });
    };

    startOnline(
      fetchLyricaLyrics(track, {
        baseUrl: lyricaBaseUrl,
        translate: translationRequested,
        romanize: romanizationRequested,
        language,
      }),
    );
    startOnline(fetchLrcmuxLyrics(track));

    fetchServerLyricsDocument(track)
      .then((result) => {
        if (requestRef.current !== requestId) return;
        serverLyrics = result;
        if (onlineDone >= 2) finalize();
      })
      .finally(() => {
        if (requestRef.current !== requestId) return;
        serverDone = true;
        if (onlineDone >= 2) finalize();
        else if (bestOnline()) applyBest();
      });

    return () => {
      window.clearTimeout(fallbackTimer);
      requestRef.current += 1;
    };
  }, [track?.id, retryKey, lyricaBaseUrl, translationRequested, romanizationRequested, language]);

  const translationAvailable = !!lyrics?.lines.some((line) => !!line.translation) || !!lyrics?.translatedPlain;
  const romanizationAvailable = !!lyrics?.lines.some((line) => !!line.romanization) || !!lyrics?.romanizedPlain;

  return {
    lyrics,
    loading,
    onlineLoading,
    onlineFailed,
    failed,
    translationRequested,
    translationAvailable,
    romanizationRequested,
    romanizationAvailable,
  };
}
