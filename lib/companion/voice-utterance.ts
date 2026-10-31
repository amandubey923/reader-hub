/**
 * Turns the stream of Web Speech API result events from one recognition session into exactly one utterance.
 *
 * Some browsers (notably Chrome on Android) fire `onresult` many times per utterance with a growing transcript
 * ("Open", "Open kam", "Open kamayani…"), even with interimResults off, and may also mark early results final.
 * Sending each event would start one assistant request per fragment, so the session is only delivered once,
 * when recognition ends, using the latest complete transcript.
 */

export interface SpeechAlternativeLike {
  transcript: string;
}

export interface SpeechResultLike {
  isFinal?: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
}

export interface SpeechResultListLike {
  length: number;
  [index: number]: SpeechResultLike;
}

/**
 * Joins result fragments, treating a fragment that restates or extends the text so far as a replacement
 * ("Open" then "Open kamayani" → "Open kamayani"), so repeated partial results never stack up.
 */
export function joinTranscripts(parts: string[]): string {
  let acc = "";
  for (const raw of parts) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const a = acc.toLowerCase();
    const l = t.toLowerCase();
    if (!acc || l.startsWith(a)) acc = t;
    else if (a.startsWith(l) || a.endsWith(l)) continue;
    else acc = `${acc} ${t}`;
  }
  return acc;
}

export function createUtteranceCollector() {
  let finalText = "";
  let interimText = "";
  let delivered = false;
  let cancelled = false;

  return {
    /** Records one `onresult` event. Each event carries the full result list of the session so far. */
    addResults(results: SpeechResultListLike | undefined | null) {
      if (!results || delivered || cancelled) return;
      const finals: string[] = [];
      const interims: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const text = results[i]?.[0]?.transcript;
        if (typeof text !== "string" || !text.trim()) continue;
        // Browsers that omit isFinal only ever report final results
        (results[i].isFinal === false ? interims : finals).push(text.trim());
      }
      const nextFinal = joinTranscripts(finals);
      // A later event restates the whole utterance, so the newest non-empty transcript wins
      if (nextFinal) finalText = nextFinal;
      interimText = joinTranscripts(interims);
    },

    /** The utterance to send when recognition ends, or null (nothing heard, aborted, or already delivered). */
    finish(): string | null {
      if (delivered || cancelled) return null;
      delivered = true;
      // If recognition ended before confirming a final result, use what was heard last
      const text = finalText || interimText;
      return text ? text : null;
    },

    /** Discards the session (e.g. a new recognition started); nothing will be delivered. */
    cancel() {
      cancelled = true;
    },
  };
}
