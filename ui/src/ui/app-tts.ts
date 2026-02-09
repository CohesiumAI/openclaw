/** Strip markdown syntax so TTS reads clean text instead of raw formatting. */
function stripMarkdownForSpeech(text: string): string {
  return (
    text
      // Fenced code blocks → just the content
      .replace(/```[\s\S]*?```/g, (m) =>
        m
          .replace(/```\w*\n?/g, "")
          .replace(/```/g, "")
          .trim(),
      )
      // Inline code
      .replace(/`([^`]+)`/g, "$1")
      // Images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Links [text](url)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Bold/italic (order matters: *** before ** before *)
      .replace(/\*{3}(.+?)\*{3}/g, "$1")
      .replace(/\*{2}(.+?)\*{2}/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_{3}(.+?)_{3}/g, "$1")
      .replace(/_{2}(.+?)_{2}/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Strikethrough
      .replace(/~~(.+?)~~/g, "$1")
      // Headings
      .replace(/^#{1,6}\s+/gm, "")
      // Blockquotes
      .replace(/^>\s?/gm, "")
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Unordered list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      // Ordered list markers
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** State for the currently playing TTS audio. */
let activeAudio: HTMLAudioElement | null = null;
let activeAbort: AbortController | null = null;
let usingBrowserTts = false;

/** Callback set by the host to be notified when TTS playing state changes. */
let onPlayingChange: ((playing: boolean) => void) | null = null;

type TtsConvertResult = {
  audioUrl?: string;
  audioPath?: string;
  provider?: string;
  outputFormat?: string;
};

type TtsHost = {
  client: { request: <T>(method: string, params?: unknown) => Promise<T> } | null;
  connected: boolean;
};

/** Register a callback for TTS playing state changes (true = started, false = stopped). */
export function onTtsPlayingChange(cb: (playing: boolean) => void): void {
  onPlayingChange = cb;
}

function setPlaying(playing: boolean): void {
  onPlayingChange?.(playing);
}

/**
 * Read text aloud via gateway TTS (ElevenLabs/OpenAI/Edge).
 * Falls back to browser speechSynthesis if gateway is unavailable.
 * If TTS is already playing, stops it instead (toggle behavior).
 */
export async function readAloud(host: TtsHost, text: string): Promise<void> {
  // Toggle: if already playing, stop immediately
  if (isReading()) {
    stopReading();
    return;
  }

  stopReading();

  if (!text.trim()) {
    return;
  }

  // Strip markdown so TTS reads clean prose, not raw formatting markers
  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    return;
  }

  // Try gateway TTS first
  if (host.client && host.connected) {
    const abort = new AbortController();
    activeAbort = abort;

    try {
      const result = await host.client.request<TtsConvertResult>("tts.convert", {
        text: cleanText,
        channel: "web",
        lang: navigator.language || "en-US",
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result?.audioUrl) {
        const audioUrl = `${window.location.origin}${result.audioUrl}`;

        const audio = new Audio(audioUrl);
        activeAudio = audio;
        setPlaying(true);

        audio.addEventListener("ended", () => {
          if (activeAudio === audio) {
            activeAudio = null;
            activeAbort = null;
            setPlaying(false);
          }
        });
        audio.addEventListener("error", () => {
          if (activeAudio === audio) {
            activeAudio = null;
            activeAbort = null;
            setPlaying(false);
          }
          fallbackBrowserTts(cleanText);
        });

        await audio.play();
        return;
      }
    } catch {
      if (abort.signal.aborted) {
        return;
      }
    }
  }

  // Fallback: browser speechSynthesis
  fallbackBrowserTts(cleanText);
}

/** Stop any in-progress TTS playback. */
export function stopReading(): void {
  const wasActive = activeAudio !== null || usingBrowserTts;
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  usingBrowserTts = false;
  if (wasActive) {
    setPlaying(false);
  }
}

/** Whether TTS is currently playing (audio element or browser speech). */
export function isReading(): boolean {
  if (activeAudio !== null && !activeAudio.paused) {
    return true;
  }
  if (usingBrowserTts && "speechSynthesis" in window && window.speechSynthesis.speaking) {
    return true;
  }
  return false;
}

/** Browser-native TTS fallback. */
function fallbackBrowserTts(text: string): void {
  if (!("speechSynthesis" in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en-US";
  usingBrowserTts = true;
  setPlaying(true);
  utterance.addEventListener("end", () => {
    usingBrowserTts = false;
    setPlaying(false);
  });
  utterance.addEventListener("error", () => {
    usingBrowserTts = false;
    setPlaying(false);
  });
  window.speechSynthesis.speak(utterance);
}
