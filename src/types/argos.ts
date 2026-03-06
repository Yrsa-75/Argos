// ============================================================
// ARGOS — Types TypeScript partagés
// Utilisés par le frontend ET le worker Railway
// ============================================================

// ----------------------------------------------------------------
// Formats & Langues supportées
// ----------------------------------------------------------------

export type VideoFormat = '9:16' | '1:1' | '16:9';

export const SUPPORTED_LANGUAGES = {
  'de': 'Allemand',
  'en': 'Anglais',
  'ar': 'Arabe',
  'zh-hant': 'Chinois traditionnel',
  'zh-hans': 'Chinois simplifié',
  'ko': 'Coréen',
  'es': 'Espagnol',
  'fr': 'Français',
  'ja': 'Japonais',
  'nl': 'Néerlandais',
  'pl': 'Polonais',
  'pt': 'Portugais',
  'ro': 'Roumain',
  'ru': 'Russe',
  'vi': 'Vietnamien',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const LANGUAGE_FLAGS: Record<LanguageCode, string> = {
  'de': '🇩🇪',
  'en': '🇬🇧',
  'ar': '🇸🇦',
  'zh-hant': '🇹🇼',
  'zh-hans': '🇨🇳',
  'ko': '🇰🇷',
  'es': '🇪🇸',
  'fr': '🇫🇷',
  'ja': '🇯🇵',
  'nl': '🇳🇱',
  'pl': '🇵🇱',
  'pt': '🇵🇹',
  'ro': '🇷🇴',
  'ru': '🇷🇺',
  'vi': '🇻🇳',
};

// ----------------------------------------------------------------
// Jobs
// ----------------------------------------------------------------

export type JobStatus =
  | 'pending'
  | 'uploading'
  | 'transcribing'
  | 'analyzing'
  | 'cutting'
  | 'translating'
  | 'rendering'
  | 'done'
  | 'error';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'En attente',
  uploading: 'Upload en cours...',
  transcribing: 'Transcription audio...',
  analyzing: "Analyse IA (détection viralité)...",
  cutting: 'Découpe des clips...',
  translating: 'Traduction 14 langues...',
  rendering: 'Rendu sous-titres HD...',
  done: 'Terminé',
  error: 'Erreur',
};

export const JOB_STATUS_PROGRESS: Record<JobStatus, number> = {
  pending: 0,
  uploading: 10,
  transcribing: 25,
  analyzing: 40,
  cutting: 55,
  translating: 70,
  rendering: 85,
  done: 100,
  error: 0,
};

export interface JobConfig {
  format: VideoFormat;
  languages: LanguageCode[];
}

export interface Job {
  id: string;
  user_id: string;
  title: string;
  source_url: string | null;
  status: JobStatus;
  progress: number;
  config: JobConfig;
  error_message: string | null;
  duration: number | null;
  created_at: string;
  updated_at: string;
  // Relations (populated via join)
  clips?: Clip[];
  chapters?: Chapter[];
}

// ----------------------------------------------------------------
// Clips
// ----------------------------------------------------------------

export interface Clip {
  id: string;
  job_id: string;
  title: string | null;
  start_time: number;
  end_time: number;
  viral_score: number | null;   // 1-10
  viral_reason: string | null;
  export_url: string | null;   // Avec sous-titres animés
  raw_url: string | null;      // Sans sous-titres
  thumbnail_url: string | null;
  created_at: string;
  // Relations
  subtitles?: Subtitle[];
}

// ----------------------------------------------------------------
// Subtitles
// ----------------------------------------------------------------

export interface WordTimestamp {
  word: string;
  start: number;   // En secondes
  end: number;     // En secondes
  translated?: string;  // Mot traduit (si différent du mot source)
}

export interface Subtitle {
  id: string;
  clip_id: string;
  language: LanguageCode;
  srt_url: string | null;
  content: WordTimestamp[] | null;
  created_at: string;
}

// ----------------------------------------------------------------
// Chapters
// ----------------------------------------------------------------

export interface Chapter {
  id: string;
  job_id: string;
  title: string;
  start_time: number;
  end_time: number;
  created_at: string;
}

// ----------------------------------------------------------------
// Worker — Résultats de transcription OpenAI Whisper
// ----------------------------------------------------------------

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

export interface TranscriptionResult {
  text: string;          // Transcription complète
  language: string;      // Langue détectée automatiquement
  duration: number;      // Durée totale en secondes
  words: WhisperWord[];  // Timestamps mot par mot
  segments: WhisperSegment[];
}

// ----------------------------------------------------------------
// Worker — Résultats de l'analyse Claude
// ----------------------------------------------------------------

export interface ClaudeAnalysisResult {
  clips: Array<{
    title: string;
    start_time: number;
    end_time: number;
    viral_score: number;
    viral_reason: string;
  }>;
  chapters: Array<{
    title: string;
    start_time: number;
    end_time: number;
  }>;
  video_summary: string;   // Résumé global pour contexte traduction
  detected_topics: string[];
}

// ----------------------------------------------------------------
// Utilitaires
// ----------------------------------------------------------------

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getClipDuration(clip: Clip): number {
  return clip.end_time - clip.start_time;
}
